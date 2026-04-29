#!/usr/bin/env bash
set -euo pipefail

AWS_REGION="${AWS_REGION:-us-west-1}"
AWS_PROFILE="${AWS_PROFILE-default}"
if [[ -z "${AWS_PROFILE}" ]]; then
  unset AWS_PROFILE
fi
AAA_RESOURCE_PREFIX="${AAA_RESOURCE_PREFIX:-aaa}"
ENVIRONMENT="${ENVIRONMENT:-prod}"
DEPLOY_BUCKET="${DEPLOY_BUCKET:-${S3_BUCKET:-}}"
ENV_SOURCE="${ENV_SOURCE:-.env}"
INSTANCE_NAME="${INSTANCE_NAME:-${AAA_RESOURCE_PREFIX}-${ENVIRONMENT}-app}"

if [[ -z "${DEPLOY_BUCKET}" ]]; then
  echo "Set DEPLOY_BUCKET or S3_BUCKET to the deployment bucket created by infra/aws-ec2/provision.sh." >&2
  exit 1
fi

aws_cli() {
  if [[ -n "${AWS_PROFILE-}" ]]; then
    aws --profile "${AWS_PROFILE}" --region "${AWS_REGION}" "$@"
  else
    aws --region "${AWS_REGION}" "$@"
  fi
}

aws_file_uri() {
  local path="$1"
  if command -v cygpath >/dev/null 2>&1; then
    path="$(cygpath -m "${path}")"
  fi
  printf 'file://%s' "${path}"
}

instance_id="$(aws_cli ec2 describe-instances \
  --filters Name=tag:Name,Values="${INSTANCE_NAME}" Name=instance-state-name,Values=running \
  --query 'Reservations[0].Instances[0].InstanceId' \
  --output text)"

if [[ "${instance_id}" == "None" || -z "${instance_id}" ]]; then
  echo "No running EC2 instance found with Name=${INSTANCE_NAME} in ${AWS_REGION}." >&2
  exit 1
fi

if [[ ! -f "${ENV_SOURCE}" ]]; then
  echo "No ${ENV_SOURCE} file found. Copy .env.example to .env and add your real secrets before deploying." >&2
  exit 1
fi

public_dns="$(aws_cli ec2 describe-instances \
  --instance-ids "${instance_id}" \
  --query 'Reservations[0].Instances[0].PublicDnsName' \
  --output text)"

if [[ "${public_dns}" == "None" || -z "${public_dns}" ]]; then
  echo "The EC2 instance does not have a public DNS name yet." >&2
  exit 1
fi

public_base_url="${PUBLIC_BASE_URL:-http://${public_dns}}"
caddy_site_address="${CADDY_SITE_ADDRESS:-:80}"

revision="$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)"
deployment_id="${revision}-$(date -u +%Y%m%d%H%M%S)"
bundle_name="aaa-${deployment_id}.tar.gz"
bundle_path="$(mktemp -t "${bundle_name}.XXXXXX")"
env_bundle_name="aaa-env-${deployment_id}.env"
env_bundle_path="$(mktemp -t "${env_bundle_name}.XXXXXX")"
ssm_params="$(mktemp -t aaa-ssm-params.XXXXXX.json)"

cleanup() {
  rm -f "${bundle_path}" "${env_bundle_path}" "${ssm_params}"
}
trap cleanup EXIT

python - "$ENV_SOURCE" "$env_bundle_path" "$AWS_REGION" "$DEPLOY_BUCKET" "$public_base_url" "$caddy_site_address" <<'PY'
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

source, output, aws_region, deploy_bucket, public_base_url, caddy_site_address = sys.argv[1:]
source_path = Path(source)
raw = source_path.read_text(encoding="utf-8")

values: dict[str, str] = {}
for line in raw.splitlines():
    match = re.match(r"^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$", line)
    if not match:
        continue
    key, value = match.groups()
    value = value.strip()
    if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
        value = value[1:-1]
    values[key] = value

postgres_user = values.get("POSTGRES_USER") or "aaa"
postgres_db = values.get("POSTGRES_DB") or "aaa"
postgres_password = values.get("POSTGRES_PASSWORD") or ""

database_url = values.get("DATABASE_URL") or ""
if database_url and not postgres_password:
    parsed = urlparse(database_url)
    postgres_user = parsed.username or postgres_user
    postgres_password = parsed.password or postgres_password
    if parsed.path and parsed.path != "/":
        postgres_db = parsed.path.lstrip("/")

if not postgres_password:
    raise SystemExit("POSTGRES_PASSWORD is missing and could not be derived from DATABASE_URL.")

required_keys = [
    "OPENAI_API_KEY",
    "JWT_SECRET",
    "INTERNAL_SERVICE_SECRET",
    "APP_CREDENTIALS_SECRET",
]
missing = [key for key in required_keys if not values.get(key)]
if missing:
    raise SystemExit(f"Missing required deployment values: {', '.join(missing)}")

deployment_values = {
    "AWS_REGION": aws_region,
    "S3_BUCKET": deploy_bucket,
    "S3_REGION": values.get("S3_REGION") or aws_region,
    "NODE_ENV": "production",
    "LOG_LEVEL": values.get("LOG_LEVEL") or "info",
    "LOG_FORMAT": "json",
    "LOG_FILE_ENABLED": "false",
    "AAA_DATA_DIR": values.get("AAA_DATA_DIR") or "/opt/aaa/data",
    "DOCKER_LOG_MAX_SIZE": values.get("DOCKER_LOG_MAX_SIZE") or "10m",
    "DOCKER_LOG_MAX_FILES": values.get("DOCKER_LOG_MAX_FILES") or "5",
    "POSTGRES_DB": postgres_db,
    "POSTGRES_USER": postgres_user,
    "POSTGRES_PASSWORD": postgres_password,
    "DATABASE_URL": f"postgresql://{postgres_user}:{postgres_password}@postgres:5432/{postgres_db}",
    "REDIS_URL": "redis://redis:6379",
    "WEB_BASE_URL": public_base_url,
    "NEXT_PUBLIC_API_URL": public_base_url,
    "INTERNAL_API_BASE_URL": "http://api:3001",
    "CADDY_SITE_ADDRESS": caddy_site_address,
}

passthrough_keys = [
    "OPENAI_API_KEY",
    "OPENAI_MODEL",
    "OPENAI_EMBEDDING_MODEL",
    "OPENAI_REALTIME_MODEL",
    "OPENAI_REALTIME_VOICE",
    "OPENAI_PRICING_OVERRIDES_JSON",
    "JWT_SECRET",
    "INTERNAL_SERVICE_SECRET",
    "APP_CREDENTIALS_SECRET",
    "GITHUB_TOKEN",
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
    "GITHUB_APP_REDIRECT_URI_BASE",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_APP_REDIRECT_URI_BASE",
    "OTEL_SERVICE_NAMESPACE",
    "OTEL_RESOURCE_ATTRIBUTES",
    "DISABLE_REGISTRATION",
    "NEXT_PUBLIC_DISABLE_REGISTRATION",
]
for key in passthrough_keys:
    value = values.get(key)
    if value:
        deployment_values[key] = value

with Path(output).open("w", encoding="utf-8") as fh:
    fh.write("# Generated by scripts/deploy-aws.sh. Do not commit this file.\n")
    for key, value in deployment_values.items():
        fh.write(f"{key}={value}\n")
PY

tar \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='.pnpm-store' \
  --exclude='.next' \
  --exclude='dist' \
  --exclude='.env' \
  --exclude='.env.*' \
  --exclude='.logs' \
  --exclude='coverage' \
  --exclude='tmp' \
  -czf "${bundle_path}" .

aws_cli s3 cp "${bundle_path}" "s3://${DEPLOY_BUCKET}/deployments/${bundle_name}"
aws_cli s3 cp "${env_bundle_path}" "s3://${DEPLOY_BUCKET}/deployments/${env_bundle_name}"

python - "$ssm_params" "$DEPLOY_BUCKET" "$bundle_name" "$env_bundle_name" <<'PY'
import base64
import json
import sys

path, bucket, bundle, env_bundle = sys.argv[1:]
app_dir = "/opt/aaa/app"
env_file = "/opt/aaa/app/.env.production"
remote_script = f"""
set -euo pipefail
mkdir -p {app_dir}/releases {app_dir}/shared
aws s3 cp s3://{bucket}/deployments/{bundle} /tmp/{bundle}
aws s3 cp s3://{bucket}/deployments/{env_bundle} {env_file}
chmod 0600 {env_file}
aws s3 rm s3://{bucket}/deployments/{env_bundle}
rm -rf {app_dir}/releases/{bundle}
mkdir -p {app_dir}/releases/{bundle}
tar -xzf /tmp/{bundle} -C {app_dir}/releases/{bundle}
ln -sfn {app_dir}/releases/{bundle} {app_dir}/current
cd {app_dir}/current
docker compose --env-file {env_file} -f docker/docker-compose.prod.yml build
docker compose --env-file {env_file} -f docker/docker-compose.prod.yml --profile tools run --rm migrate
docker compose --env-file {env_file} -f docker/docker-compose.prod.yml up -d --remove-orphans --force-recreate
docker image prune -f
"""
encoded_script = base64.b64encode(remote_script.encode("utf-8")).decode("ascii")

with open(path, "w", encoding="utf-8") as fh:
    json.dump({"commands": [f"printf '%s' '{encoded_script}' | base64 -d | sudo bash"]}, fh)
PY

command_id="$(aws_cli ssm send-command \
  --instance-ids "${instance_id}" \
  --document-name AWS-RunShellScript \
  --comment "Deploy Agentic AI Assistant ${deployment_id}" \
  --parameters "$(aws_file_uri "${ssm_params}")" \
  --query 'Command.CommandId' \
  --output text)"

echo "Started deployment ${command_id} on ${instance_id}. Waiting for SSM command to finish..."
aws_cli ssm wait command-executed --command-id "${command_id}" --instance-id "${instance_id}"

aws_cli ssm get-command-invocation \
  --command-id "${command_id}" \
  --instance-id "${instance_id}" \
  --query '{Status:Status,Stdout:StandardOutputContent,Stderr:StandardErrorContent}' \
  --output text

echo "App URL: ${public_base_url}"
