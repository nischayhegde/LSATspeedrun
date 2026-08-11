#!/usr/bin/env bash
#
# The performance harness's own backend, on its own throwaway database.
#
# `POST /v1/auth/dev` is the first-party way to give a harness a session, and
# the reason nobody used it is that it writes rows to whatever database the API
# is pointed at — which, on this machine, is the one the live demo is showing.
# The endpoint is not the problem; the shared database is. So this runs a second
# API on a port nobody else holds, against a SQLite file under `.harness/` that
# exists to be deleted.
#
#   tools/perf/harness-backend.sh --reset   rebuild the database, then serve
#   tools/perf/harness-backend.sh           serve (builds the database if absent)
#
# Ports in use on this machine when this was written: 5000, 5001, 5091, 5273,
# 5333, 4173, 5173, 5180, 5181, 5185, 5291, 5373, 5474. 5810 is clear.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HARNESS_DIR="$ROOT/.harness"
DB_FILE="$HARNESS_DIR/harness.db"
PORT="${LSAT_HARNESS_PORT:-5810}"
EMAIL="${LSAT_HARNESS_EMAIL:-harness@localhost.test}"
PY="${LSAT_PY:-/Users/alan/LSATspeedrun/.venv/bin/python}"

export DATABASE_URL="sqlite:///$DB_FILE"
export DEV_AUTH_ENABLED=true
export AUTO_SEED=false
export FLASK_ENV=development
# The explanation grader is a frontier-model call. A harness never answers a
# question, and "local" would put a background thread in the process being
# measured against, so it is off here.
export AI_JOBS_MODE=sync
export PORT="$PORT"

mkdir -p "$HARNESS_DIR"
cd "$ROOT/backend"

if [ "${1:-}" = "--reset" ]; then
  rm -f "$DB_FILE" "$DB_FILE-wal" "$DB_FILE-shm"
fi

if [ ! -f "$DB_FILE" ]; then
  echo "building $DB_FILE (migrate, seed the question bank, install the demo account)"
  "$PY" -m flask --app app:create_app db upgrade
  "$PY" -m flask --app app:create_app seed
  # The lived-in account. A bare dev-login user has no game profile, so `/firm`
  # is an empty shell, `/progress` has nothing to chart and `/cases/:id` cannot
  # exist — measuring those would understate every one of them. `--no-backup`
  # because this machine is at 99% disk and the file is 19 MB.
  "$PY" scripts/seed_demo.py --email "$EMAIL" --apply --no-backup >"$HARNESS_DIR/seed_demo.log" 2>&1
  echo "demo account installed as $EMAIL (report in .harness/seed_demo.log)"
fi

echo "harness API on http://127.0.0.1:$PORT against $DB_FILE"
exec "$PY" run.py
