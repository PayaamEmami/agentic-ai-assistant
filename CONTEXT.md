# CONTEXT

This file is a quick orientation guide for AI coding agents working in this repository. It complements `README.md` with practical project context, common workflows, and a few guardrails for making safe changes.

## Project Summary

Agentic AI Assistant is a pnpm monorepo for a personal AI assistant with:

- Web chat and voice UX
- Fastify API and WebSocket backend
- Background workers for async processing
- Retrieval / RAG over connected data sources
- MCP-based tool integration
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
- `packages/mcp`: MCP client adapter and tool registry
- `packages/retrieval`: chunking, embeddings, indexing, search
- `packages/connectors`: external data source connectors
- `packages/memory`: personalization and memory logic
- `packages/db`: schema, migrations, repositories
- `packages/config`: environment parsing and constants

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
2. Starts PostgreSQL and Redis with `docker/docker-compose.yml`
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
pnpm format:check
```

Build everything:

```bash
pnpm build
```

## Environment Notes

Important local dependencies and secrets:

- `DATABASE_URL`
- `REDIS_URL`
- `OPENAI_API_KEY`
- `JWT_SECRET`
- `CONNECTOR_CREDENTIALS_SECRET`

Optional but useful depending on the feature area:

- GitHub OAuth values
- Google OAuth values
- `MCP_SERVERS_CONFIG_PATH`
- S3 / MinIO settings
- `LOG_FORMAT` (`pretty` for local readability, `json` when you want machine-friendly output)

See `.env.example` for the full template.

## Logging Notes

The repo uses a shared observability layer with structured logs across API, worker, connector HTTP calls, MCP, retrieval, OpenAI boundaries, and selected browser failures.

Local logging defaults:

- Console output is pretty-printed in development
- NDJSON log files are written under `.logs/`
- API logs go to `.logs/api.ndjson`
- Worker logs go to `.logs/worker.ndjson`

Useful fields to grep for:

- `requestId`: one HTTP request
- `correlationId`: one cross-boundary flow across API, queues, worker, and package calls
- `voiceSessionId`: live voice session lifecycle
- `connectorConfigId`, `connectorKind`, `conversationId`, `toolExecutionId`, `jobId`
- `event`, `component`, `outcome`

Important safety rule:

- Logs are structured and sanitized by default. Do not intentionally add raw bearer tokens, OAuth codes, connector credentials, prompts, transcripts, uploaded file contents, or other secret-bearing payloads to log objects.

## Change Routing Guide

When deciding where a change belongs:

- UI, app routes, client interactions: start in `apps/web`
- HTTP endpoints, auth, uploads, WebSocket flows: start in `apps/api`
- Async jobs and queue consumers: start in `apps/worker`
- Shared contracts between apps: check `packages/shared`
- DB schema or persistence changes: check `packages/db`
- Model/tool orchestration behavior: check `packages/ai` and `packages/mcp`
- Retrieval, indexing, embeddings, search: check `packages/retrieval`
- External source integrations: check `packages/connectors`

## Guardrails For AI Agents

- Read the existing package boundary before moving logic across apps/packages.
- Prefer updating shared contracts in `packages/shared` instead of duplicating types.
- If an API request or response changes, verify whether `apps/web`, `apps/api`, and shared DTOs all need updates.
- If a database shape changes, make sure the migration, repositories, and any dependent API/worker code stay aligned.
- If a feature touches retrieval, connectors, or tools, check for downstream effects in orchestration code.
- Prefer minimal, targeted changes over broad refactors unless the task clearly calls for one.
- Run at least relevant validation (`pnpm lint`, `pnpm typecheck`, or a focused package command) after edits when feasible.

## Current Product Context

At a high level, the assistant currently supports:

- Chat-first interaction
- Live voice sessions using OpenAI Realtime
- RAG over connected sources
- MCP and native tool execution with approval flow
- GitHub and Google Docs connectors
- A small multi-agent pattern with orchestrator, research, action, and verifier roles

## Maintenance

Update this file when any of the following change:

- Core architecture or package ownership
- Local startup workflow
- Required environment variables
- Key commands used for verification
- Major product capabilities that affect how agents should reason about changes
