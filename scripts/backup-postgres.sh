#!/usr/bin/env bash
# Dump the production Postgres database to the existing S3 bucket and keep
# seven days of copies. Runs on the EC2 host from /etc/cron.d/aaa-postgres-backup.
set -euo pipefail

ENV_FILE="${AAA_ENV_FILE:-/opt/aaa/app/current/.env.production}"
CONTAINER="${AAA_POSTGRES_CONTAINER:-aaa-postgres}"
RETENTION_DAYS="${AAA_BACKUP_RETENTION_DAYS:-7}"
PREFIX="${AAA_BACKUP_PREFIX:-backups/postgres}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Env file not found: ${ENV_FILE}" >&2
  exit 1
fi

read_env_value() {
  local key="$1"
  local line
  line="$(grep -E "^${key}=" "${ENV_FILE}" | tail -n 1 || true)"
  printf '%s' "${line#"${key}"=}"
}

S3_BUCKET="$(read_env_value S3_BUCKET)"
S3_REGION="$(read_env_value S3_REGION)"
POSTGRES_USER="$(read_env_value POSTGRES_USER)"
POSTGRES_DB="$(read_env_value POSTGRES_DB)"
POSTGRES_PASSWORD="$(read_env_value POSTGRES_PASSWORD)"

if [[ -z "${S3_BUCKET}" ]]; then
  echo "S3_BUCKET is missing from ${ENV_FILE}" >&2
  exit 1
fi

if [[ -z "${POSTGRES_PASSWORD}" ]]; then
  echo "POSTGRES_PASSWORD is missing from ${ENV_FILE}" >&2
  exit 1
fi

POSTGRES_USER="${POSTGRES_USER:-aaa}"
POSTGRES_DB="${POSTGRES_DB:-aaa}"

if [[ -n "${S3_REGION}" ]]; then
  export AWS_DEFAULT_REGION="${S3_REGION}"
  export AWS_REGION="${S3_REGION}"
fi

dump_path="$(mktemp)"
trap 'rm -f "${dump_path}"' EXIT

docker exec -e PGPASSWORD="${POSTGRES_PASSWORD}" "${CONTAINER}" \
  pg_dump \
  --username "${POSTGRES_USER}" \
  --dbname "${POSTGRES_DB}" \
  --format=custom \
  --no-owner \
  --no-acl \
  --file=- \
  > "${dump_path}"

if [[ ! -s "${dump_path}" ]]; then
  echo "pg_dump produced an empty file" >&2
  exit 1
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
key="${PREFIX}/${stamp}.dump"
aws s3 cp "${dump_path}" "s3://${S3_BUCKET}/${key}" --only-show-errors
echo "Uploaded s3://${S3_BUCKET}/${key}"

cutoff="$(date -u -d "${RETENTION_DAYS} days ago" +%Y-%m-%dT%H:%M:%SZ)"
keys="$(aws s3api list-objects-v2 \
  --bucket "${S3_BUCKET}" \
  --prefix "${PREFIX}/" \
  --query "Contents[?LastModified<='${cutoff}'].Key" \
  --output text)"

if [[ -n "${keys}" && "${keys}" != "None" ]]; then
  for object_key in ${keys}; do
    aws s3 rm "s3://${S3_BUCKET}/${object_key}" --only-show-errors
  done
fi
