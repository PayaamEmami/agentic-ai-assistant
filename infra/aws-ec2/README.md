# AWS EC2 Deployment

This is the production deployment path for Agentic AI Assistant.

The stack intentionally stays small: one EC2 instance, Docker Compose, a persistent EBS data volume, a private S3 bucket, and Docker JSON logs with rotation. It does not use Kubernetes, RDS, ElastiCache, NAT gateways, or load balancers.

## Resource Naming

Defaults:

- Region: `us-west-1`
- Resource prefix: `aaa`
- EC2 instance: `aaa-prod-app`
- Security group: `aaa-prod-sg`
- IAM role/profile: `aaa-prod-ec2-role` / `aaa-prod-instance-profile`
- S3 bucket: `aaa-uploads-prod-<account-id>-us-west-1`
- Tags: `Application=aaa-agentic-ai-assistant`

Override defaults only when needed:

```bash
export AWS_PROFILE=default
export AWS_REGION=us-west-1
export AAA_RESOURCE_PREFIX=aaa
export ENVIRONMENT=prod
```

## Provision

Prerequisites:

- AWS CLI authenticated to the target account
- A default VPC in `us-west-1`

Create the EC2 instance, security group, IAM role/profile, EBS volume, and S3 bucket:

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

The script prints the EC2 public DNS name, default app URL, and S3 bucket. For a stable custom-domain setup, associate an Elastic IP with the instance before configuring DNS.

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

Keep `.env` and `/opt/aaa/app/.env.production` out of git. This deployment path stores secrets on the instance; SSM Parameter Store or Secrets Manager can replace that later.

## Container Registry (ECR)

The three application images (`aaa-api`, `aaa-worker`, `aaa-web`) are built in GitHub Actions and stored in ECR. Create the repositories once:

```bash
bash infra/aws-ec2/ecr-setup.sh
```

The script is idempotent and prints the registry URI. Set that value as `ECR_REGISTRY` locally and as a GitHub repository variable for CD.

## Deploy

The deploy script renders `.env.production`, uploads the deployment manifest to S3, and runs the remote deployment through AWS Systems Manager. SSH is not required.

```bash
export S3_BUCKET=aaa-uploads-prod-<account-id>-us-west-1
export ECR_REGISTRY=<account-id>.dkr.ecr.us-west-1.amazonaws.com
export IMAGE_TAG="$(git rev-parse HEAD)"
bash scripts/deploy-aws.sh
```

For manual deploys, push the three images before running the script. In normal use, push to `main` and let GitHub Actions build, push, deploy, and invalidate CloudFront.

To deploy with a custom domain and Caddy-managed TLS:

```bash
export PUBLIC_BASE_URL=https://assistant.example.com
export CADDY_SITE_ADDRESS=assistant.example.com
bash scripts/deploy-aws.sh
```

Verify:

```bash
curl -fsS http://<ec2-public-dns>/health
```

## Public HTTPS

The EC2 public hostname (`*.compute.amazonaws.com`) cannot get a publicly trusted TLS certificate. Use one of these:

1. **Custom domain + Caddy + Let's Encrypt.** Point an A record at the instance Elastic IP, then deploy with `PUBLIC_BASE_URL` and `CADDY_SITE_ADDRESS`.

2. **CloudFront in front of EC2.** Create a CloudFront distribution with the EC2 public DNS as a custom HTTP origin, then redeploy with the CloudFront URL:

   ```bash
   export PUBLIC_BASE_URL=https://<id>.cloudfront.net
   bash scripts/deploy-aws.sh
   ```

For CloudFront, use the `CachingDisabled` and `AllViewer` AWS-managed policies, allow all HTTP methods, and confirm WebSocket-backed chat/voice still work. Optionally restrict EC2 port 80 to AWS's `com.amazonaws.global.cloudfront.origin-facing` managed prefix list.

## Rollback

On the EC2 instance, point `current` at a previous release and restart:

```bash
sudo ln -sfn /opt/aaa/app/releases/<previous-release> /opt/aaa/app/current
cd /opt/aaa/app/current
sudo docker compose --env-file /opt/aaa/app/.env.production -f docker/docker-compose.prod.yml up -d
```

If a migration changed the database, restore from a backup instead of only rolling back the container release.

## Logging

Production uses Docker JSON logs with rotation:

```bash
sudo docker logs aaa-api --since 1h
sudo docker logs aaa-worker --since 1h
sudo docker logs aaa-web --since 1h
sudo docker compose --env-file /opt/aaa/app/.env.production -f /opt/aaa/app/current/docker/docker-compose.prod.yml ps
```

CloudWatch Logs can be added later if Docker logs through SSM become inconvenient.

## Backups

Create an on-demand Postgres backup:

```bash
export S3_BUCKET=aaa-uploads-prod-<account-id>-us-west-1
bash scripts/backup-aws-db.sh
```

Restore:

```bash
export BACKUP_S3_URI=s3://aaa-uploads-prod-<account-id>-us-west-1/db-backups/aaa-postgres-20260101T000000Z.dump.gz
bash scripts/restore-aws-db.sh
```

Install a daily backup timer on the EC2 instance:

```bash
export S3_BUCKET=aaa-uploads-prod-<account-id>-us-west-1
pnpm aws:backup:timer
```

The timer runs `/usr/local/bin/aaa-backup-db` daily at `03:15` UTC by default. Override with `BACKUP_ON_CALENDAR=04:30` before installing. Periodically test restores before relying on backups.
