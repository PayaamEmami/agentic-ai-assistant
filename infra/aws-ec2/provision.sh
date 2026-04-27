#!/usr/bin/env bash
set -euo pipefail

AWS_REGION="${AWS_REGION:-us-west-1}"
AWS_PROFILE="${AWS_PROFILE:-default}"
AAA_RESOURCE_PREFIX="${AAA_RESOURCE_PREFIX:-aaa}"
ENVIRONMENT="${ENVIRONMENT:-prod}"
INSTANCE_TYPE="${INSTANCE_TYPE:-t4g.small}"
KEY_NAME="${KEY_NAME:-}"
SSH_CIDR="${SSH_CIDR:-}"
DATA_VOLUME_SIZE_GB="${DATA_VOLUME_SIZE_GB:-30}"
ROOT_VOLUME_SIZE_GB="${ROOT_VOLUME_SIZE_GB:-24}"
AMI_ID="${AMI_ID:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USER_DATA_FILE="${SCRIPT_DIR}/user-data.sh"

if command -v cygpath >/dev/null 2>&1; then
  USER_DATA_FILE="$(cygpath -m "${USER_DATA_FILE}")"
fi

NAME_PREFIX="${AAA_RESOURCE_PREFIX}-${ENVIRONMENT}"
APP_TAG_VALUE="${AAA_RESOURCE_PREFIX}-agentic-ai-assistant"
SECURITY_GROUP_NAME="${NAME_PREFIX}-sg"
ROLE_NAME="${NAME_PREFIX}-ec2-role"
INSTANCE_PROFILE_NAME="${NAME_PREFIX}-instance-profile"
INSTANCE_NAME="${NAME_PREFIX}-app"

aws_cli() {
  aws --profile "${AWS_PROFILE}" --region "${AWS_REGION}" "$@"
}

account_id="$(aws --profile "${AWS_PROFILE}" sts get-caller-identity --query Account --output text)"
bucket_name="${S3_BUCKET:-${AAA_RESOURCE_PREFIX}-uploads-${ENVIRONMENT}-${account_id}-${AWS_REGION}}"

vpc_id="$(aws_cli ec2 describe-vpcs \
  --filters Name=isDefault,Values=true \
  --query 'Vpcs[0].VpcId' \
  --output text)"

if [[ "${vpc_id}" == "None" || -z "${vpc_id}" ]]; then
  echo "No default VPC found in ${AWS_REGION}. Create one or set up networking before running this script." >&2
  exit 1
fi

subnet_id="$(aws_cli ec2 describe-subnets \
  --filters Name=vpc-id,Values="${vpc_id}" Name=default-for-az,Values=true \
  --query 'Subnets[0].SubnetId' \
  --output text)"

if [[ "${subnet_id}" == "None" || -z "${subnet_id}" ]]; then
  echo "No default subnet found in ${vpc_id}." >&2
  exit 1
fi

security_group_id="$(aws_cli ec2 describe-security-groups \
  --filters Name=vpc-id,Values="${vpc_id}" Name=group-name,Values="${SECURITY_GROUP_NAME}" \
  --query 'SecurityGroups[0].GroupId' \
  --output text)"

if [[ "${security_group_id}" == "None" || -z "${security_group_id}" ]]; then
  security_group_id="$(aws_cli ec2 create-security-group \
    --group-name "${SECURITY_GROUP_NAME}" \
    --description "Agentic AI Assistant web access" \
    --vpc-id "${vpc_id}" \
    --tag-specifications "ResourceType=security-group,Tags=[{Key=Name,Value=${SECURITY_GROUP_NAME}},{Key=Application,Value=${APP_TAG_VALUE}}]" \
    --query GroupId \
    --output text)"
fi

for port in 80 443; do
  aws_cli ec2 authorize-security-group-ingress \
    --group-id "${security_group_id}" \
    --ip-permissions "IpProtocol=tcp,FromPort=${port},ToPort=${port},IpRanges=[{CidrIp=0.0.0.0/0,Description=public-web}]" \
    >/dev/null 2>&1 || true
done

if [[ -n "${SSH_CIDR}" ]]; then
  aws_cli ec2 authorize-security-group-ingress \
    --group-id "${security_group_id}" \
    --ip-permissions "IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=${SSH_CIDR},Description=admin-ssh}]" \
    >/dev/null 2>&1 || true
fi

if ! aws --profile "${AWS_PROFILE}" iam get-role --role-name "${ROLE_NAME}" >/dev/null 2>&1; then
  aws --profile "${AWS_PROFILE}" iam create-role \
    --role-name "${ROLE_NAME}" \
    --assume-role-policy-document '{
      "Version": "2012-10-17",
      "Statement": [{
        "Effect": "Allow",
        "Principal": { "Service": "ec2.amazonaws.com" },
        "Action": "sts:AssumeRole"
      }]
    }' >/dev/null
fi

aws --profile "${AWS_PROFILE}" iam attach-role-policy \
  --role-name "${ROLE_NAME}" \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore >/dev/null 2>&1 || true

if ! aws --profile "${AWS_PROFILE}" iam get-instance-profile --instance-profile-name "${INSTANCE_PROFILE_NAME}" >/dev/null 2>&1; then
  aws --profile "${AWS_PROFILE}" iam create-instance-profile \
    --instance-profile-name "${INSTANCE_PROFILE_NAME}" >/dev/null
fi

aws --profile "${AWS_PROFILE}" iam add-role-to-instance-profile \
  --instance-profile-name "${INSTANCE_PROFILE_NAME}" \
  --role-name "${ROLE_NAME}" >/dev/null 2>&1 || true

aws --profile "${AWS_PROFILE}" iam wait instance-profile-exists \
  --instance-profile-name "${INSTANCE_PROFILE_NAME}"

if ! aws --profile "${AWS_PROFILE}" s3api head-bucket --bucket "${bucket_name}" >/dev/null 2>&1; then
  aws --profile "${AWS_PROFILE}" s3api create-bucket \
    --bucket "${bucket_name}" \
    --region "${AWS_REGION}" \
    --create-bucket-configuration LocationConstraint="${AWS_REGION}" >/dev/null
fi

aws --profile "${AWS_PROFILE}" s3api put-public-access-block \
  --bucket "${bucket_name}" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

aws --profile "${AWS_PROFILE}" s3api put-bucket-encryption \
  --bucket "${bucket_name}" \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

aws --profile "${AWS_PROFILE}" iam put-role-policy \
  --role-name "${ROLE_NAME}" \
  --policy-name "${NAME_PREFIX}-s3-access" \
  --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [{
      \"Effect\": \"Allow\",
      \"Action\": [\"s3:ListBucket\"],
      \"Resource\": \"arn:aws:s3:::${bucket_name}\"
    }, {
      \"Effect\": \"Allow\",
      \"Action\": [\"s3:GetObject\", \"s3:PutObject\", \"s3:DeleteObject\"],
      \"Resource\": \"arn:aws:s3:::${bucket_name}/*\"
    }]
  }"

if [[ -z "${AMI_ID}" ]]; then
  AMI_ID="$(aws_cli ssm get-parameter \
    --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64 \
    --query 'Parameter.Value' \
    --output text 2>/dev/null || true)"
fi

if [[ -z "${AMI_ID}" || "${AMI_ID}" == "None" ]]; then
  AMI_ID="$(aws_cli ec2 describe-images \
    --owners amazon \
    --filters Name=name,Values='al2023-ami-2023*-kernel-*-arm64' Name=state,Values=available Name=architecture,Values=arm64 \
    --query 'sort_by(Images,&CreationDate)[-1].ImageId' \
    --output text)"
fi

existing_instance_id="$(aws_cli ec2 describe-instances \
  --filters Name=tag:Name,Values="${INSTANCE_NAME}" Name=instance-state-name,Values=pending,running,stopping,stopped \
  --query 'Reservations[0].Instances[0].InstanceId' \
  --output text)"

if [[ "${existing_instance_id}" != "None" && -n "${existing_instance_id}" ]]; then
  instance_id="${existing_instance_id}"
else
  key_args=()
  if [[ -n "${KEY_NAME}" ]]; then
    key_args=(--key-name "${KEY_NAME}")
  fi

  instance_id="$(aws_cli ec2 run-instances \
    --image-id "${AMI_ID}" \
    --instance-type "${INSTANCE_TYPE}" \
    --subnet-id "${subnet_id}" \
    --security-group-ids "${security_group_id}" \
    --iam-instance-profile Name="${INSTANCE_PROFILE_NAME}" \
    --metadata-options HttpTokens=required,HttpEndpoint=enabled \
    --block-device-mappings "[{\"DeviceName\":\"/dev/xvda\",\"Ebs\":{\"VolumeSize\":${ROOT_VOLUME_SIZE_GB},\"VolumeType\":\"gp3\",\"Encrypted\":true,\"DeleteOnTermination\":true}},{\"DeviceName\":\"/dev/sdf\",\"Ebs\":{\"VolumeSize\":${DATA_VOLUME_SIZE_GB},\"VolumeType\":\"gp3\",\"Encrypted\":true,\"DeleteOnTermination\":false}}]" \
    --user-data "file://${USER_DATA_FILE}" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=${INSTANCE_NAME}},{Key=Application,Value=${APP_TAG_VALUE}}]" "ResourceType=volume,Tags=[{Key=Name,Value=${NAME_PREFIX}-volume},{Key=Application,Value=${APP_TAG_VALUE}}]" \
    "${key_args[@]}" \
    --query 'Instances[0].InstanceId' \
    --output text)"
fi

instance_state="$(aws_cli ec2 describe-instances \
  --instance-ids "${instance_id}" \
  --query 'Reservations[0].Instances[0].State.Name' \
  --output text)"

if [[ "${instance_state}" == "stopping" ]]; then
  aws_cli ec2 wait instance-stopped --instance-ids "${instance_id}"
  instance_state="stopped"
fi

if [[ "${instance_state}" == "stopped" ]]; then
  aws_cli ec2 start-instances --instance-ids "${instance_id}" >/dev/null
fi

aws_cli ec2 wait instance-running --instance-ids "${instance_id}"

public_ip="$(aws_cli ec2 describe-instances \
  --instance-ids "${instance_id}" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' \
  --output text)"

public_dns="$(aws_cli ec2 describe-instances \
  --instance-ids "${instance_id}" \
  --query 'Reservations[0].Instances[0].PublicDnsName' \
  --output text)"

cat <<EOF
Provisioned AWS resources.

Region: ${AWS_REGION}
Resource prefix: ${AAA_RESOURCE_PREFIX}-
Instance: ${instance_id}
Public IP: ${public_ip}
Public DNS: ${public_dns}
Security group: ${security_group_id}
Instance profile: ${INSTANCE_PROFILE_NAME}
S3 bucket: ${bucket_name}

Set S3_BUCKET=${bucket_name} locally before running scripts/deploy-aws.sh.
Default app URL: http://${public_dns}
EOF
