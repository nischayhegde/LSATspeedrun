"""RDS-managed database credentials that survive rotation.

The database is created with `ManageMasterUserPassword`, so RDS rotates the
master password in Secrets Manager on its own schedule — every seven days — and
tells nothing that is already running. Resolving the password once and building
it into the SQLAlchemy URL, which is what this used to do, means every
connection opened after a rotation is refused with `password authentication
failed` and the API stays down until the process happens to restart. That is
exactly how the sandbox went down: the password rotated at 03:27 UTC on
2026-08-05 while gunicorn was still holding the one it read on 2026-08-03.

Neither `pool_pre_ping` nor `pool_recycle` helps, because both reconnect with
the same stale URL.

So the password is supplied per connection instead. The secret is cached for the
life of the process, costing nothing in steady state, and re-read the moment a
connection is refused for bad credentials — which is precisely when it is stale.
A rotation therefore costs one refused connection rather than an outage.

One thing to know before testing this: Postgres never re-authenticates a
connection that is already open, so a rotation breaks nothing until the pool
turns over — `pool_recycle` above closes connections after five minutes. That is
why the original outage began hours after the 03:27 rotation, and why hitting
the health endpoint straight after a rotation proves nothing. To exercise this
code, terminate the app's backends first:

    SELECT pg_terminate_backend(pid) FROM pg_stat_activity
     WHERE usename = 'lsatapp' AND pid <> pg_backend_pid();

then watch for "re-reading the secret" in the log while requests keep returning
200. Verified that way against a live rotation on the sandbox.
"""

from __future__ import annotations

import json
import logging
import threading
from collections.abc import Callable

from sqlalchemy import event
from sqlalchemy.engine import URL

logger = logging.getLogger(__name__)

# 28P01 is invalid_password, 28000 invalid_authorization_specification. Matching
# on SQLSTATE rather than the message keeps this correct across driver versions
# and server locales; the substring check is only a fallback for errors that
# arrive without one.
AUTH_FAILURE_SQLSTATES = frozenset({"28P01", "28000"})


def is_auth_failure(error: BaseException) -> bool:
    """True when the database refused the credentials rather than the connection."""

    seen: set[int] = set()
    current: BaseException | None = error
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if getattr(current, "sqlstate", None) in AUTH_FAILURE_SQLSTATES:
            return True
        current = current.__cause__ or current.__context__
    return "password authentication failed" in str(error).lower()


class DatabaseSecret:
    """The RDS-managed credentials for the application database."""

    def __init__(
        self,
        secret_arn: str,
        *,
        host: str | None = None,
        port: str | int | None = None,
        name: str | None = None,
        loader: Callable[[], dict] | None = None,
    ) -> None:
        self.secret_arn = secret_arn
        self._host = host or None
        self._port = port or None
        self._name = name or None
        self._loader = loader or self._load_from_secrets_manager
        self._cached: dict | None = None
        # Gunicorn threads share the engine, so two connections racing after a
        # rotation must not both stampede Secrets Manager.
        self._lock = threading.Lock()

    def _load_from_secrets_manager(self) -> dict:
        import boto3

        arn_parts = self.secret_arn.split(":")
        secret_region = arn_parts[3] if len(arn_parts) > 3 and arn_parts[3] else None
        client = boto3.client("secretsmanager", region_name=secret_region)
        return json.loads(client.get_secret_value(SecretId=self.secret_arn)["SecretString"])

    def resolve(self, *, refresh: bool = False) -> dict:
        with self._lock:
            if refresh or self._cached is None:
                payload = self._loader()
                if not payload.get("username") or not payload.get("password"):
                    raise RuntimeError("The configured database secret is incomplete.")
                self._cached = payload
            return self._cached

    def password(self, *, refresh: bool = False) -> str:
        return str(self.resolve(refresh=refresh)["password"])

    def url(self) -> str:
        secret = self.resolve()
        host = self._host or secret.get("host")
        port = int(self._port or secret.get("port") or 5432)
        name = self._name or secret.get("dbname") or "lsatspeedrun"
        if not host:
            raise RuntimeError("The configured database secret is incomplete.")
        return URL.create(
            "postgresql+psycopg",
            username=str(secret["username"]),
            password=str(secret["password"]),
            host=str(host),
            port=port,
            database=str(name),
            query={"sslmode": "require"},
        ).render_as_string(hide_password=False)


def connect_with_current_password(secret: DatabaseSecret, dialect, cargs, cparams):
    """Connect with the cached password, re-reading the secret if it was rotated."""

    cparams["password"] = secret.password()
    try:
        return dialect.connect(*cargs, **cparams)
    except Exception as error:
        if not is_auth_failure(error):
            raise
        logger.warning("The database refused the cached credentials; re-reading the secret.")
        cparams["password"] = secret.password(refresh=True)
        return dialect.connect(*cargs, **cparams)


def attach_rotation_recovery(engine, secret: DatabaseSecret) -> None:
    """Supply the current password on every connect, re-reading it after a rotation."""

    @event.listens_for(engine, "do_connect")
    def _connect(dialect, _connection_record, cargs, cparams):
        return connect_with_current_password(secret, dialect, cargs, cparams)
