#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DOCKER_START_TIMEOUT_SECONDS="${DOCKER_START_TIMEOUT_SECONDS:-60}"

check_port_available() {
  local port="$1"
  local label="$2"

  if ! node -e "const net = require('node:net'); const server = net.createServer(); server.once('error', () => process.exit(1)); server.once('listening', () => server.close(() => process.exit(0))); server.listen(${port}, '0.0.0.0');" >/dev/null 2>&1; then
    cat <<EOF
Cannot start local app stack because ${label} port ${port} is already in use.

Update the matching port in \`.env\` and re-run \`pnpm dev:local\`.
- Web uses \`3000\`
- API uses \`API_PORT\`
- Worker observability uses \`WORKER_OBSERVABILITY_PORT\`
EOF
    exit 1
  fi
}

wait_for_docker() {
  local timeout="${1:-60}"
  local elapsed=0

  while (( elapsed < timeout )); do
    if docker info >/dev/null 2>&1; then
      return 0
    fi

    sleep 2
    elapsed=$((elapsed + 2))
  done

  return 1
}

start_docker_engine() {
  if docker info >/dev/null 2>&1; then
    return 0
  fi

  if command -v colima >/dev/null 2>&1; then
    echo "Docker daemon is not running. Starting Colima..."
    colima start
    return 0
  fi

  if [[ "$(uname -s)" == "Darwin" ]]; then
    if [[ -d "/Applications/OrbStack.app" ]]; then
      echo "Docker daemon is not running. Starting OrbStack..."
      open -a OrbStack
      return 0
    fi

    if [[ -d "/Applications/Docker.app" ]]; then
      echo "Docker daemon is not running. Starting Docker Desktop..."
      open -a Docker
      return 0
    fi
  fi

  return 1
}

print_docker_help() {
  cat <<'EOF'
Cannot connect to the Docker daemon.

`pnpm dev:local` uses Docker Compose to start local PostgreSQL and Redis, so the
Docker engine must already be running before this command can succeed.

`pnpm dev:local` will try to start a supported local Docker runtime first, but
if that doesn't work you can start one of the following yourself and re-run it:
- Docker Desktop
- OrbStack
- Colima (`colima start`)
EOF
}

if [[ ! -f ".env" ]]; then
  echo "Missing .env file. Copy .env.example to .env first."
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required for local postgres/redis."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  if start_docker_engine && wait_for_docker "$DOCKER_START_TIMEOUT_SECONDS"; then
    echo "Docker daemon is ready."
  else
    print_docker_help
    exit 1
  fi
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required. Install it, then re-run this command."
  exit 1
fi

set -a
source .env
set +a

API_PORT="${API_PORT:-3001}"
WORKER_OBSERVABILITY_PORT="${WORKER_OBSERVABILITY_PORT:-9464}"

if [[ ! -d node_modules ]]; then
  echo "Installing dependencies..."
  pnpm install
fi

echo "Starting local infrastructure..."
docker compose -f docker/docker-compose.yml up -d \
  postgres \
  redis \
  prometheus \
  loki \
  tempo \
  otel-collector \
  promtail \
  grafana

echo "Running database migrations..."
pnpm --filter @aaa/db migrate:up

check_port_available 3000 "web"
check_port_available "$API_PORT" "api"
check_port_available "$WORKER_OBSERVABILITY_PORT" "worker observability"

echo "Starting local app stack..."
echo "Web:  http://localhost:3000"
echo "API:  http://localhost:3001"
echo "Health: http://localhost:3001/health"
echo "Worker metrics: http://localhost:${WORKER_OBSERVABILITY_PORT}/metrics"
echo "Grafana: http://localhost:3005"
echo "Prometheus: http://localhost:9090"
echo

pnpm dev
