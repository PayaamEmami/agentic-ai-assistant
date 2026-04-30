#!/usr/bin/env bash
set -euo pipefail

AWS_REGION="${AWS_REGION:-us-west-1}"
AWS_PROFILE="${AWS_PROFILE:-default}"
AAA_RESOURCE_PREFIX="${AAA_RESOURCE_PREFIX:-aaa}"

REPOS=(
  "${AAA_RESOURCE_PREFIX}-api"
  "${AAA_RESOURCE_PREFIX}-worker"
  "${AAA_RESOURCE_PREFIX}-web"
)

LIFECYCLE_POLICY='{
  "rules": [
    {
      "rulePriority": 1,
      "description": "Expire untagged images after 1 day",
      "selection": {
        "tagStatus": "untagged",
        "countType": "sinceImagePushed",
        "countUnit": "days",
        "countNumber": 1
      },
      "action": { "type": "expire" }
    },
    {
      "rulePriority": 2,
      "description": "Keep only the last 10 tagged images",
      "selection": {
        "tagStatus": "any",
        "countType": "imageCountMoreThan",
        "countNumber": 10
      },
      "action": { "type": "expire" }
    }
  ]
}'

aws_cli() {
  aws --profile "${AWS_PROFILE}" --region "${AWS_REGION}" "$@"
}

account_id="$(aws --profile "${AWS_PROFILE}" sts get-caller-identity --query Account --output text)"
registry_uri="${account_id}.dkr.ecr.${AWS_REGION}.amazonaws.com"

for repo in "${REPOS[@]}"; do
  if aws_cli ecr describe-repositories --repository-names "${repo}" >/dev/null 2>&1; then
    echo "ECR repo ${repo} already exists."
  else
    aws_cli ecr create-repository \
      --repository-name "${repo}" \
      --image-scanning-configuration scanOnPush=true \
      --image-tag-mutability MUTABLE \
      --encryption-configuration encryptionType=AES256 \
      >/dev/null
    echo "Created ECR repo ${repo}."
  fi

  aws_cli ecr put-lifecycle-policy \
    --repository-name "${repo}" \
    --lifecycle-policy-text "${LIFECYCLE_POLICY}" \
    >/dev/null
done

cat <<EOF

ECR setup complete.

Region: ${AWS_REGION}
Registry URI: ${registry_uri}

Repositories:
  - ${registry_uri}/${AAA_RESOURCE_PREFIX}-api
  - ${registry_uri}/${AAA_RESOURCE_PREFIX}-worker
  - ${registry_uri}/${AAA_RESOURCE_PREFIX}-web

Set ECR_REGISTRY in your GitHub repo Variables and locally before deploying:

  export ECR_REGISTRY=${registry_uri}

EOF
