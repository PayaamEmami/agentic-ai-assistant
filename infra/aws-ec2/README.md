# AWS EC2 Deployment

This is the AWS deployment path for running Agentic AI Assistant as a single-user app.

It intentionally avoids Kubernetes, RDS, ElastiCache, NAT gateways, and load balancers. The stack runs on one EC2 instance with Docker Compose, a persistent EBS data volume, a private S3 bucket, and basic Docker JSON logs with rotation.

## Resource Naming

All AWS resources created by this path default to the `aaa-` prefix and `us-west-1`.

Default names:

- EC2 instance: `aaa-prod-app`
- Security group: `aaa-prod-sg`
- IAM role: `aaa-prod-ec2-role`
- Instance profile: `aaa-prod-instance-profile`
- S3 bucket: `aaa-uploads-prod-<account-id>-us-west-1`
- Tags: `Application=aaa-agentic-ai-assistant`

Override with environment variables only when needed:

```bash
export AWS_PROFILE=default
export AWS_REGION=us-west-1
export AAA_RESOURCE_PREFIX=aaa
export ENVIRONMENT=prod
```

## Provision AWS Resources

Prerequisites:

- AWS CLI authenticated to the target account.
- A default VPC in `us-west-1`.

Run:

```bash
bash infra/aws-ec2/provision.sh
```

Optional settings:

```bash
export INSTANCE_TYPE=t4g.small
export DATA_VOLUME_SIZE_GB=30
export ROOT_VOLUME_SIZE_GB=24
export SSH_CIDR="$(curl -s https://checkip.amazonaws.com)/32"
export KEY_NAME=your-existing-ec2-keypair
bash infra/aws-ec2/provision.sh
```

The script prints the EC2 public DNS name, default app URL, and S3 bucket. A custom domain is optional; by default the app is served over HTTP on the EC2 public DNS name.

## Configure Secrets

Use the local `.env` file as the deployment secret source. The deploy script transforms it into `/opt/aaa/app/.env.production` on the EC2 instance and adjusts container-only values such as `DATABASE_URL`, `REDIS_URL`, `WEB_BASE_URL`, and `NEXT_PUBLIC_API_URL`.

Minimum required values:

- `POSTGRES_PASSWORD`: local container database password. If omitted, the deploy script tries to derive it from `DATABASE_URL`.
- `S3_BUCKET`: bucket printed by `provision.sh`.
- `OPENAI_API_KEY`: OpenAI API key.
- `JWT_SECRET`, `INTERNAL_SERVICE_SECRET`, `APP_CREDENTIALS_SECRET`: strong random secrets.

Generate strong secrets locally:

```bash
openssl rand -hex 32
```

Keep `.env` and `/opt/aaa/app/.env.production` out of git. This deployment path stores secrets on the instance; moving them to SSM Parameter Store or Secrets Manager is a later upgrade, not required for v1.

## Deploy

The deploy script uploads a source bundle to S3 and runs the deployment through AWS Systems Manager, so SSH is not required.

```bash
export S3_BUCKET=aaa-uploads-prod-<account-id>-us-west-1
bash scripts/deploy-aws.sh
```

By default the public app URL is `http://<ec2-public-dns>`. To use a custom domain later, set:

```bash
export PUBLIC_BASE_URL=https://assistant.example.com
export CADDY_SITE_ADDRESS=assistant.example.com
bash scripts/deploy-aws.sh
```

Remote deploy steps:

1. Download the source bundle to `/opt/aaa/app/releases`.
2. Update `/opt/aaa/app/current`.
3. Build production Docker images from [docker/docker-compose.prod.yml](../../docker/docker-compose.prod.yml).
4. Run database migrations with the `migrate` Compose profile.
5. Start `proxy`, `web`, `api`, `worker`, `postgres`, and `redis`.
6. Prune old Docker images.

Verify:

```bash
curl -fsS http://<ec2-public-dns>/health
```

Also check the web app, WebSocket-backed chat or voice behavior, worker-driven jobs, and any S3-backed upload flows you use.

## Rollback

On the EC2 instance, point `current` at a previous release and restart:

```bash
sudo ln -sfn /opt/aaa/app/releases/<previous-release> /opt/aaa/app/current
cd /opt/aaa/app/current
sudo docker compose --env-file /opt/aaa/app/.env.production -f docker/docker-compose.prod.yml up -d
```

If a migration changed the database, restore from a backup instead of only rolling back the container release.

## Logging

The production Compose file sets `LOG_FORMAT=json` and disables local `.logs` files. Docker keeps structured container logs with rotation:

```bash
sudo docker logs aaa-api --since 1h
sudo docker logs aaa-worker --since 1h
sudo docker logs aaa-web --since 1h
sudo docker compose --env-file /opt/aaa/app/.env.production -f /opt/aaa/app/current/docker/docker-compose.prod.yml ps
```

Skip Prometheus, Grafana, Loki, Tempo, and alerts for the first deployment. Add CloudWatch Logs later if reading logs through SSM or Docker becomes inconvenient.

## Backups

Create an on-demand Postgres backup and upload it to S3:

```bash
export S3_BUCKET=aaa-uploads-prod-<account-id>-us-west-1
bash scripts/backup-aws-db.sh
```

Restore from a backup:

```bash
export BACKUP_S3_URI=s3://aaa-uploads-prod-<account-id>-us-west-1/db-backups/aaa-postgres-20260101T000000Z.dump.gz
bash scripts/restore-aws-db.sh
```

For ongoing maintenance, schedule the backup script from your local machine, GitHub Actions, or an EventBridge Scheduler target that invokes an SSM command. Periodically test a restore before you rely on the backups.

To install a daily backup timer on the EC2 instance:

```bash
export S3_BUCKET=aaa-uploads-prod-<account-id>-us-west-1
pnpm aws:backup:timer
```

The timer runs `/usr/local/bin/aaa-backup-db` daily at `03:15` UTC by default. Override with `BACKUP_ON_CALENDAR=04:30` before installing.
