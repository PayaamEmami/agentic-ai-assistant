# CONTEXT

This file is a quick working guide for coding agents in this repository. Use `README.md` for full setup and infrastructure details; use this file for where code lives, how to verify changes, and the guardrails that matter during implementation.

If your change makes any part of this file inaccurate, incomplete, or misleading, update `CONTEXT.md` in the same work.

## Project Summary

Agentic AI Assistant is a pnpm monorepo for a multi-surface AI assistant with:

- `apps/web`: Next.js web app
- `apps/api`: Fastify API and WebSocket backend
- `apps/worker`: BullMQ background processing
- `packages/*`: shared logic for AI orchestration, retrieval, DB, observability, config, and tool providers

Primary stack:

- Node.js 20+
- TypeScript
- pnpm workspaces
- Next.js 15 + React 19
- Fastify 5
- PostgreSQL 16 + pgvector
- Redis 7 + BullMQ

## Repo Shape

Main apps:

- `apps/web`: UI, routes, chat and voice client flows
- `apps/api`: HTTP endpoints, auth, uploads, WebSocket flows
- `apps/worker`: queues, background jobs, async processing

Shared packages:

- `packages/shared`: shared types, DTOs, schemas, enums
- `packages/ai`: prompts, model gateway, orchestration logic
- `packages/tool-providers`: native tool provider implementations
- `packages/retrieval`: chunking, embeddings, indexing, search
- `packages/knowledge-sources`: external source integrations and credential helpers
- `packages/memory`: personalization and memory logic
- `packages/db`: schema, migrations, repositories
- `packages/config`: environment parsing and constants
- `packages/observability`: logging, tracing, metrics, sanitization

Useful infrastructure folders:

- `docker/`: local and production Docker assets
- `scripts/`: local startup and AWS helper scripts
- `.github/workflows/`: CI and CD definitions

## Change Routing Guide

When deciding where a change belongs:

- UI, app routes, client interactions: start in `apps/web`
- HTTP endpoints, auth, uploads, WebSocket flows: start in `apps/api`
- Async jobs and queue consumers: start in `apps/worker`
- Shared contracts between apps: check `packages/shared`
- DB schema or persistence changes: check `packages/db`
- Model or tool orchestration behavior: check `packages/ai`
- Native tool provider behavior: check `packages/tool-providers`
- Retrieval, indexing, embeddings, search: check `packages/retrieval`
- External source integrations: check `packages/knowledge-sources`
- Logging, tracing, sanitization, metrics: check `packages/observability`

## Local Workflow

Primary local entrypoint:

```bash
pnpm dev:local
```

What it does:

1. Requires a real `.env` in the repo root
2. Starts PostgreSQL, Redis, and the local observability stack from `docker/docker-compose.yml`
3. Runs DB migrations with `pnpm --filter @aaa/db migrate:up`
4. Starts all app dev servers with `pnpm dev`

Windows note:

- `pnpm dev:local` runs `bash ./scripts/dev-local.sh`
- Use WSL or Git Bash for that workflow

Useful local URLs:

- Web: `http://localhost:3000`
- API: `http://localhost:3001`
- API health: `http://localhost:3001/health`

## Agent Verification Checklist

Before handing work back, run the narrowest useful checks during iteration, then run the broader checks needed to prove the final change is safe.

Standard repo-level verification:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

Use `pnpm build` when the change can affect runtime packaging, production behavior, or cross-workspace integration:

```bash
pnpm build
```

Notes:

- CI currently runs `pnpm lint`, `pnpm typecheck`, and `pnpm test`
- Do not claim format verification; `pnpm format:check` is not a real script in this repo
- For quick iteration, workspace-scoped commands are fine, for example `pnpm --filter @aaa/api test`
- Before handoff, prefer repo-level checks when a change crosses app or package boundaries
- If you change DB schema, migrations, or persistence flows, also run the relevant `packages/db` migration or integration steps needed to prove the change works
- If you cannot run a needed check because of missing credentials, services, or environment, say so explicitly

## Common Commands

Install dependencies:

```bash
pnpm install
```

Run all apps in dev mode:

```bash
pnpm dev
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

Common local requirements:

- `DATABASE_URL`
- `REDIS_URL`
- `OPENAI_API_KEY`
- `JWT_SECRET`
- `APP_CREDENTIALS_SECRET`

Sometimes needed depending on the feature area:

- `LOCAL_POSTGRES_PORT` when `5432` is already in use
- `LOCAL_REDIS_PORT` when `6379` is already in use
- GitHub OAuth values
- Google OAuth values
- S3 or MinIO settings
- `LOG_FORMAT`

See `.env.example` for the full template.

## Logging Notes

- Local logs may be written under `.logs/`
- During `pnpm dev:local`, API and worker logging is redirected for the local observability stack
- Do not intentionally log bearer tokens, OAuth codes, credentials, prompts, transcripts, uploaded file contents, or other secret-bearing payloads

## Production Notes

- Production uses Docker-based deployment from `.github/workflows/cd.yml`
- CI validation lives in `.github/workflows/ci.yml`
- Use `README.md` for deeper deploy and infrastructure details

## Maintenance

Coding agents should update this file as part of the same change whenever any of the following become stale:

- Repo shape or package ownership
- Local startup workflow
- Required environment variables
- Verification commands or CI expectations
- Major product capabilities that affect how agents should reason about changes
