#!/usr/bin/env bash
set -euo pipefail

AAA_APP_DIR="${AAA_APP_DIR:-/opt/aaa/app}"
AAA_DATA_DIR="${AAA_DATA_DIR:-/opt/aaa/data}"
AAA_SWAP_FILE="${AAA_SWAP_FILE:-/swapfile}"
AAA_SWAP_SIZE_MB="${AAA_SWAP_SIZE_MB:-2048}"

dnf update -y
dnf install -y docker git awscli amazon-ssm-agent

systemctl enable --now docker
systemctl enable --now amazon-ssm-agent
usermod -aG docker ec2-user

if ! docker compose version >/dev/null 2>&1; then
  compose_arch="$(uname -m)"
  mkdir -p /usr/local/lib/docker/cli-plugins
  curl -fsSL "https://github.com/docker/compose/releases/download/v2.29.7/docker-compose-linux-${compose_arch}" \
    -o /usr/local/lib/docker/cli-plugins/docker-compose
  chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
fi

mkdir -p /etc/docker
cat >/etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "5"
  }
}
JSON
systemctl restart docker

mkdir -p "${AAA_APP_DIR}" "${AAA_DATA_DIR}/postgres" "${AAA_DATA_DIR}/redis" "${AAA_DATA_DIR}/backups"
chown -R ec2-user:ec2-user /opt/aaa

DATA_DEVICE=""
for candidate in /dev/nvme1n1 /dev/xvdf /dev/sdf; do
  if [[ -b "${candidate}" ]]; then
    DATA_DEVICE="${candidate}"
    break
  fi
done
if [[ -n "${DATA_DEVICE}" ]]; then
  if ! blkid "${DATA_DEVICE}" >/dev/null 2>&1; then
    mkfs.ext4 -F "${DATA_DEVICE}"
  fi

  DEVICE_UUID="$(blkid -s UUID -o value "${DATA_DEVICE}")"
  if ! grep -q "${DEVICE_UUID}" /etc/fstab; then
    echo "UUID=${DEVICE_UUID} ${AAA_DATA_DIR} ext4 defaults,nofail 0 2" >>/etc/fstab
  fi

  mount "${AAA_DATA_DIR}" || mount -a
  mkdir -p "${AAA_DATA_DIR}/postgres" "${AAA_DATA_DIR}/redis" "${AAA_DATA_DIR}/backups"
  chown -R ec2-user:ec2-user "${AAA_DATA_DIR}"
fi

if [[ ! -f "${AAA_SWAP_FILE}" ]]; then
  dd if=/dev/zero of="${AAA_SWAP_FILE}" bs=1M count="${AAA_SWAP_SIZE_MB}"
  chmod 600 "${AAA_SWAP_FILE}"
  mkswap "${AAA_SWAP_FILE}"
  swapon "${AAA_SWAP_FILE}"
  echo "${AAA_SWAP_FILE} none swap sw 0 0" >>/etc/fstab
fi
