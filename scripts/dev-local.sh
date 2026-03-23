#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f ".env" ]]; then
  echo "Missing .env file. Copy .env.example to .env first."
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required for local postgres/redis."
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required. Run:"
  echo "  corepack enable && corepack prepare pnpm@9.15.4 --activate"
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
