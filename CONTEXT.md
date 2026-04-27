# CONTEXT

This file is a quick orientation guide for AI coding agents working in this repository. It complements `README.md` with practical project context, common workflows, and a few guardrails for making safe changes.

## Project Summary

Agentic AI Assistant is a pnpm monorepo for an AI assistant with:

- Web chat and voice UX
- Fastify API and WebSocket backend
- Background workers for async processing
- Retrieval / RAG over connected data sources
- Native tool execution with approvals
- Multi-agent orchestration on top of OpenAI models

Primary stack:

- Node.js 20+
- TypeScript
- pnpm workspaces
- Next.js 15 + React 19
- Fastify 5
- PostgreSQL 16 + pgvector
- Redis 7 + BullMQ
- Docker Compose for local infra

## Repo Shape

Top-level apps:

- `apps/web`: Next.js frontend
- `apps/api`: Fastify API server
- `apps/worker`: BullMQ-based background worker

Shared packages:

- `packages/shared`: shared types, DTOs, schemas, enums
- `packages/ai`: prompts, model gateway, orchestration logic
- `packages/tool-providers`: native tool providers used by tool execution
- `packages/retrieval`: chunking, embeddings, indexing, search
- `packages/knowledge-sources`: retrieval-oriented external source integrations and credential helpers
- `packages/memory`: personalization and memory logic
- `packages/db`: schema, migrations, repositories
- `packages/config`: environment parsing and constants
- `packages/observability`: logging, tracing, metrics, sanitization

Operational/infrastructure folders:

- `docker/`: local Dockerfiles and `docker-compose.yml`
- `infra/terraform`: AWS infrastructure
- `infra/kubernetes`: deployment manifests
- `scripts/dev-local.sh`: local startup helper

## How Local Dev Works

The main local entrypoint is:

```bash
pnpm dev:local
```

What it does:

1. Requires a real `.env` file in the repo root
2. Starts PostgreSQL, Redis, and the local observability stack with `docker/docker-compose.yml`
3. Runs DB migrations via `pnpm --filter @aaa/db migrate:up`
4. Starts all app dev servers with `pnpm dev`

Important note for Windows:

- `pnpm dev:local` runs `bash ./scripts/dev-local.sh`
- WSL or Git Bash is recommended for that workflow

Local URLs:

- Web: `http://localhost:3000`
- API: `http://localhost:3001`
- API health: `http://localhost:3001/health`

## Common Commands

Install dependencies:

```bash
pnpm install
```

Run all apps in dev mode:

```bash
pnpm dev
```

Run quality checks:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
```

Run tests:

```bash
pnpm test
pnpm test:watch
pnpm test:coverage
```

Run tests for one workspace:

```bash
pnpm --filter @aaa/shared test
pnpm --filter @aaa/api test
```

Build everything:

```bash
pnpm build
```

## Environment Notes

Important local dependencies and secrets:

- `DATABASE_URL`
- `LOCAL_POSTGRES_PORT` when `5432` is already in use
- `REDIS_URL`
- `LOCAL_REDIS_PORT` when `6379` is already in use
- `OPENAI_API_KEY`
- `JWT_SECRET`
- `APP_CREDENTIALS_SECRET`

Optional but useful depending on the feature area:

- GitHub OAuth values
- Google OAuth values
- S3 / MinIO settings
- `LOG_FORMAT` (`pretty` for local readability, `json` when you want machine-friendly output)

See `.env.example` for the full template.

## Logging Notes

The repo uses a shared observability layer with structured logs across API, worker, knowledge-source HTTP calls, retrieval, native tool execution, and OpenAI boundaries.

Local logging defaults:

- Console output is pretty-printed in development
- NDJSON log files are written under `.logs/`
- API logs go to `.logs/api.ndjson`
- Worker logs go to `.logs/worker.ndjson`

During `pnpm dev:local`, the script disables file logging and points logs at local Loki instead so local observability works without Docker bind mounts on the host filesystem.

Useful fields to grep for:

- `requestId`: one HTTP request
- `correlationId`: one cross-boundary flow across API, queues, worker, and package calls
- `voiceSessionId`: live voice session lifecycle
- `appCapabilityConfigId`, `appKind`, `conversationId`, `toolExecutionId`, `jobId`
- `event`, `component`, `outcome`

Important safety rule:

- Logs are structured and sanitized by default. Do not intentionally add raw bearer tokens, OAuth codes, app credentials, prompts, transcripts, uploaded file contents, or other secret-bearing payloads to log objects.

## Change Routing Guide

When deciding where a change belongs:

- UI, app routes, client interactions: start in `apps/web`
- HTTP endpoints, auth, uploads, WebSocket flows: start in `apps/api`
- Async jobs and queue consumers: start in `apps/worker`
- Shared contracts between apps: check `packages/shared`
- DB schema or persistence changes: check `packages/db`
- Model/tool orchestration behavior: check `packages/ai`
- Native tool provider behavior: check `packages/tool-providers`
- Retrieval, indexing, embeddings, search: check `packages/retrieval`
- External source integrations: check `packages/knowledge-sources`
- Logging, tracing, sanitization, metrics: check `packages/observability`

## Maintenance

Update this file when any of the following change:

- Core architecture or package ownership
- Local startup workflow
- Required environment variables
- Key commands used for verification
- Major product capabilities that affect how agents should reason about changes
