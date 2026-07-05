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

wait_for_postgres() {
  local timeout="${1:-60}"
  local elapsed=0

  while (( elapsed < timeout )); do
    if docker compose -f docker/docker-compose.yml exec -T postgres \
      pg_isready -U "${POSTGRES_USER:-aaa}" -d "${POSTGRES_DB:-aaa}" >/dev/null 2>&1; then
      return 0
    fi

    sleep 2
    elapsed=$((elapsed + 2))
  done

  return 1
}

is_windows() {
  case "$(uname -s)" in
    CYGWIN* | MINGW* | MSYS*) return 0 ;;
  esac

  [[ "${OS:-}" == Windows_NT ]]
}

start_docker_desktop_cli() {
  if ! docker desktop start >/dev/null 2>&1; then
    return 1
  fi

  echo "Docker daemon is not running. Starting Docker Desktop..."
  return 0
}

start_docker_desktop_windows() {
  if ! is_windows; then
    return 1
  fi

  if ! command -v powershell.exe >/dev/null 2>&1; then
    return 1
  fi

  echo "Docker daemon is not running. Starting Docker Desktop..."
  powershell.exe -NoProfile -Command '
    $candidates = @(
      (Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"),
      (Join-Path $env:LOCALAPPDATA "Docker\Docker Desktop.exe")
    )
    foreach ($candidate in $candidates) {
      if (Test-Path $candidate) {
        Start-Process $candidate
        exit 0
      }
    }
    exit 1
  ' >/dev/null 2>&1
}

start_docker_engine() {
  if docker info >/dev/null 2>&1; then
    return 0
  fi

  if start_docker_desktop_cli; then
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

  if start_docker_desktop_windows; then
    return 0
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
- Docker Desktop (`docker desktop start` on Windows/macOS when available)
- OrbStack
- Colima (`colima start`)

On Windows, the script also tries to launch Docker Desktop via PowerShell when
the CLI start command is unavailable. Docker Desktop can take a minute to become
ready; increase `DOCKER_START_TIMEOUT_SECONDS` if needed.
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
  if start_docker_engine; then
    echo "Waiting for Docker daemon (up to ${DOCKER_START_TIMEOUT_SECONDS}s)..."
    if wait_for_docker "$DOCKER_START_TIMEOUT_SECONDS"; then
      echo "Docker daemon is ready."
    else
      echo "Docker did not become ready within ${DOCKER_START_TIMEOUT_SECONDS}s."
      print_docker_help
      exit 1
    fi
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
docker compose -f docker/docker-compose.yml up -d --remove-orphans \
  postgres \
  redis \
  prometheus \
  loki \
  tempo \
  otel-collector \
  grafana

echo "Waiting for PostgreSQL..."
if ! wait_for_postgres "$DOCKER_START_TIMEOUT_SECONDS"; then
  echo "PostgreSQL did not become ready within ${DOCKER_START_TIMEOUT_SECONDS}s."
  exit 1
fi

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

export LOG_FILE_ENABLED="false"
export LOG_LOKI_ENDPOINT="${LOG_LOKI_ENDPOINT:-http://localhost:3100/loki/api/v1/push}"

pnpm dev
