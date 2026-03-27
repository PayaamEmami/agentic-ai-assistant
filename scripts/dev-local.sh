#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DOCKER_START_TIMEOUT_SECONDS="${DOCKER_START_TIMEOUT_SECONDS:-60}"

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

if [[ ! -d node_modules ]]; then
  echo "Installing dependencies..."
  pnpm install
fi

echo "Starting postgres and redis..."
docker compose -f docker/docker-compose.yml up -d postgres redis

echo "Running database migrations..."
pnpm --filter @aaa/db migrate:up

echo "Starting local app stack..."
echo "Web:  http://localhost:3000"
echo "API:  http://localhost:3001"
echo "Health: http://localhost:3001/health"
echo

pnpm dev
