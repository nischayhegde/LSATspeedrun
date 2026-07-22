# AWS sandbox deployment

The stack serves the Vite/React frontend from Nginx on Spot EC2 and runs Flask
behind the same CloudFront HTTPS origin. PostgreSQL on private RDS replaces the
instance-local SQLite database. Slow TrueFoundry work is persisted in
`ai_jobs`, sent through SQS, and processed by Lambda in private subnets.

The Lambda worker handles post-answer coaching. The browser transparently polls `/v1/jobs/<id>`, so the
web worker is not held open during a model request. SQS delivery is idempotent,
has three bounded attempts, and moves exhausted messages to a DLQ.

## Build the Lambda artifact

The deployment zip must contain Linux Python 3.11 wheels even when it is built
from Windows. The provided script performs that cross-platform installation:

```powershell
.\deploy\ec2\build-lambda.ps1
```

Upload `deploy/ec2/dist/ai-worker.zip` to an S3 bucket in `us-east-1`. Pass that
bucket and key as `LambdaCodeS3Bucket` and `LambdaCodeS3Key`. A deployment must
also provide `TrueFoundryUrl`, `TrueFoundryApiKey`, `GoogleClientId`, a full
`GitCommit`, and (in the intern sandbox) the boundary ARN
`arn:aws:iam::<account-id>:policy/InternSandboxBoundary`. IAM resource creation
requires `CAPABILITY_IAM`.

The stack creates a NAT gateway because a VPC-connected Lambda needs private
RDS access and outbound HTTPS access to TrueFoundry. Delete the ephemeral stack
when it is not in use; NAT and RDS accrue cost even when no jobs run.

## Existing SQLite data

For a deployment that already has user data, migrate before replacing the EC2
instance:

1. Create and migrate the PostgreSQL target while the old web instance remains
   available.
2. On a host that can reach both databases, set `SQLITE_DATABASE_URL` to the
   old SQLite file and `DATABASE_URL` to the new PostgreSQL database.
3. Run a dry check, then the copy:

```powershell
python backend\scripts\migrate_sqlite_to_postgres.py --dry-run
python backend\scripts\migrate_sqlite_to_postgres.py
```

The copier only accepts an empty migrated target and never merges, truncates,
or overwrites rows. For the current ephemeral sandbox, a fresh database can be
initialized directly with `flask db upgrade`; the EC2 bootstrap does this.

## Operations

- SSH remains closed; use Systems Manager Session Manager.
- RDS is private and accepts port 5432 only from the web and worker security
  groups. Its generated password stays in Secrets Manager.
- The root EBS volume and RDS storage are encrypted.
- Lambda concurrency is capped at two to protect the small database and model
  endpoint.
- Check `/v1/health`; `async_jobs.ready` should be `true`.
- Inspect the worker log group and DLQ output when a job reaches `failed`.
- Add the CloudFront application URL as an authorized JavaScript origin on the
  Google OAuth web client.
- Run `flask seed` as a deployment task after migrations so the RDS database
  contains the Hugging Face LR and RC records.
