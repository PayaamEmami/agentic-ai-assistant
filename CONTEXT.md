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

- `docker/`: Dockerfiles, local `docker-compose.yml`, and the production `docker-compose.prod.yml` (Caddy + postgres + redis + api + web + worker)
- `infra/aws-ec2/`: provisioning script and cloud-init user-data for the single production EC2 host
- `scripts/`: local startup helper (`dev-local.sh`), AWS deploy/backup helpers (`deploy-aws.sh`, `backup-aws-db.sh`, `restore-aws-db.sh`, `install-aws-backup-timer.sh`)
- `.github/workflows/`: CI (`ci.yml`) and CD (`cd.yml`) pipelines

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

## Production Deploy

Production runs as a single AWS EC2 instance (Name tag `aaa-prod-app`) running everything via `docker/docker-compose.prod.yml`. CloudFront sits in front of the EC2 public DNS for HTTPS termination and caching. Postgres and Redis run as containers on the box; uploads go to S3. The three application images (`aaa-api`, `aaa-worker`, `aaa-web`) are built in CI and stored in ECR — the EC2 instance only pulls them, never builds.

Deploy flow on merge to `main` (`.github/workflows/cd.yml`):

1. Reuse `ci.yml` gates (format, lint, typecheck, test)
2. Assume an IAM role via GitHub OIDC (no long-lived AWS keys)
3. Build the three production images in parallel on `ubuntu-24.04-arm` runners with buildx + GHA layer cache, and push them to ECR tagged with `${github.sha}` and `latest`
4. Materialize `.env.production` from GitHub Secrets, then run `scripts/deploy-aws.sh`, which:
   - Uploads only `.env.production`, `docker-compose.prod.yml`, and `Caddyfile.prod` to the S3 deploy bucket under `deployments/<deployment_id>/`
   - Sends an SSM Run Command to the EC2 instance to swap the `current` symlink, `aws ecr get-login-password | docker login`, `docker compose pull`, run DB migrations, and `docker compose up -d`
5. Invalidate the CloudFront distribution so the new web bundle is served immediately

Manual deploys (`pnpm aws:deploy`) use the same script and are interchangeable with CD, but require pushing the images to ECR yourself first. In practice, almost all deploys go through CD.

Required GitHub configuration is documented in `README.md` under "Continuous deployment". Account-specific values (bucket name, instance name, role ARN, CloudFront distribution ID, region, public URL, ECR registry URI) live only in GitHub Variables/Secrets — never committed to this repo.

## AWS CLI Access

The AWS CLI is available in the local environment and can be used directly to interact with AWS resources. Credentials are configured via the default profile; no extra setup is needed.

## Maintenance

Update this file when any of the following change:

- Core architecture or package ownership
- Local startup workflow
- Required environment variables
- Key commands used for verification
- Major product capabilities that affect how agents should reason about changes
