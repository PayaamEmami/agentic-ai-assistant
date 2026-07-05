# AGENTS.md

This file orients AI coding agents and human readers to this repository. It explains what the project is, how it is organized, and the guidance to follow when working here.

## Overview

Agentic AI Assistant is a pnpm monorepo for a multi-surface AI assistant with a Next.js web app, Fastify API, and BullMQ worker. Shared TypeScript packages handle orchestration, retrieval, tools, database access, and observability on top of PostgreSQL and Redis.

## Technology Stack

| Layer          | Technology                                          |
| -------------- | --------------------------------------------------- |
| Frontend       | Next.js 15, React 19, TypeScript, Tailwind CSS      |
| Backend        | Node.js, TypeScript, Fastify 5                      |
| Database       | PostgreSQL 16 with pgvector                         |
| Cache/Queue    | Redis 7, BullMQ                                     |
| Storage        | PostgreSQL attachments, AWS S3 for deployment assets |
| AI             | Model provider gateway, embeddings, realtime voice  |
| Tools          | Native tool handlers, provider tools                |
| Infrastructure | AWS EC2, Docker Compose, Caddy, optional CloudFront |
| Monorepo       | pnpm workspaces                                     |

## Infrastructure

Production runs on AWS with a containerized web, API, worker, Postgres, and Redis stack:

- **EC2 + Docker Compose** run the application containers and stateful services
- **Postgres with pgvector** stores app data, attachments, memory, and embeddings
- **Redis + BullMQ** handle background jobs and queues
- **S3** stores deployment artifacts
- **Caddy** reverse-proxies web and API traffic; custom-domain Caddy TLS or CloudFront can provide public HTTPS
- **GitHub Actions** runs CI and deploys changes from `main`

See [`infra/aws-ec2/README.md`](infra/aws-ec2/README.md) for provisioning, deployment, and rollback details.

## Repository Structure

```
├── apps/
│   ├── web/                  # Next.js frontend (App Router, React, Tailwind)
│   ├── api/                  # Fastify backend (REST + WebSocket)
│   └── worker/               # Background job processor (BullMQ)
├── packages/
│   ├── shared/               # Domain types, DTOs, event schemas, enums
│   ├── ai/                   # Model gateway, prompts, agent orchestration
│   ├── tool-providers/       # Native tool providers used by tool execution
│   ├── retrieval/            # Chunking, embeddings, indexing, search
│   ├── knowledge-sources/    # Retrieval-oriented knowledge sources and credential helpers
│   ├── memory/               # Preferences, personalization, memory
│   ├── db/                   # Database schema, migrations, repositories
│   ├── config/               # Environment parsing, constants
│   └── observability/        # Logging, tracing, metrics, sanitization
├── infra/
│   └── aws-ec2/              # EC2 provisioning script and cloud-init user-data
├── docker/                   # Dockerfiles and docker-compose for local dev and prod
├── .github/workflows/        # CI and CD GitHub Actions pipelines
├── .env.example              # Environment variable template
├── pnpm-workspace.yaml       # pnpm workspace definition
└── tsconfig.base.json        # Shared TypeScript configuration
```

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
- If Docker Desktop is closed, the script tries `docker desktop start` and then a PowerShell launch fallback before waiting for the daemon

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
- See the Infrastructure section above and [`infra/aws-ec2/README.md`](infra/aws-ec2/README.md) for deploy and rollback details

## Maintenance

Coding agents should update this file as part of the same change whenever any of the following become stale:

- Technology stack or infrastructure layout
- Repo shape or package ownership
- Local startup workflow
- Required environment variables
- Verification commands or CI expectations
- Major product capabilities that affect how agents should reason about changes
