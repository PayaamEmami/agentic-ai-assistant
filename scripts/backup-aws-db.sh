#!/usr/bin/env bash
set -euo pipefail

AWS_REGION="${AWS_REGION:-us-west-1}"
AWS_PROFILE="${AWS_PROFILE:-default}"
AAA_RESOURCE_PREFIX="${AAA_RESOURCE_PREFIX:-aaa}"
ENVIRONMENT="${ENVIRONMENT:-prod}"
INSTANCE_NAME="${INSTANCE_NAME:-${AAA_RESOURCE_PREFIX}-${ENVIRONMENT}-app}"
BACKUP_PREFIX="${BACKUP_PREFIX:-db-backups}"

aws_cli() {
  aws --profile "${AWS_PROFILE}" --region "${AWS_REGION}" "$@"
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

ssm_params="$(mktemp -t aaa-backup-params.XXXXXX.json)"
trap 'rm -f "${ssm_params}"' EXIT

python - "$ssm_params" "$BACKUP_PREFIX" <<'PY'
import base64
import json
import sys

path, backup_prefix = sys.argv[1:]
env_file = "/opt/aaa/app/current/.env.production"
remote_script = f"""
set -euo pipefail
set -a
source {env_file}
set +a
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="/opt/aaa/data/backups/aaa-postgres-${{timestamp}}.dump.gz"
docker exec -e PGPASSWORD="${{POSTGRES_PASSWORD}}" aaa-postgres pg_dump -Fc -U "${{POSTGRES_USER:-aaa}}" -d "${{POSTGRES_DB:-aaa}}" | gzip > "${{backup_file}}"
aws s3 cp "${{backup_file}}" "s3://${{S3_BUCKET}}/{backup_prefix}/$(basename "${{backup_file}}")"
find /opt/aaa/data/backups -name 'aaa-postgres-*.dump.gz' -mtime +14 -delete
echo "Created ${{backup_file}} and uploaded it to s3://${{S3_BUCKET}}/{backup_prefix}/"
"""
encoded_script = base64.b64encode(remote_script.encode("utf-8")).decode("ascii")

with open(path, "w", encoding="utf-8") as fh:
    json.dump({"commands": [f"printf '%s' '{encoded_script}' | base64 -d | sudo bash"]}, fh)
PY

command_id="$(aws_cli ssm send-command \
  --instance-ids "${instance_id}" \
  --document-name AWS-RunShellScript \
  --comment "Backup Agentic AI Assistant Postgres" \
  --parameters "$(aws_file_uri "${ssm_params}")" \
  --query 'Command.CommandId' \
  --output text)"

echo "Started backup ${command_id} on ${instance_id}. Waiting for SSM command to finish..."
aws_cli ssm wait command-executed --command-id "${command_id}" --instance-id "${instance_id}"

aws_cli ssm get-command-invocation \
  --command-id "${command_id}" \
  --instance-id "${instance_id}" \
  --query '{Status:Status,Stdout:StandardOutputContent,Stderr:StandardErrorContent}' \
  --output text
