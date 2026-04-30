# Agentic AI Assistant

A web-based AI assistant with chat, voice, multimodal input, RAG over connected data sources, native tool execution, and multi-agent orchestration. Built on OpenAI foundation models, running on AWS.

## Tech Stack

| Layer          | Technology                                     |
| -------------- | ---------------------------------------------- |
| Frontend       | Next.js 15, React 19, TypeScript, Tailwind CSS |
| Backend        | Node.js, TypeScript, Fastify 5                 |
| Database       | PostgreSQL 16 with pgvector                    |
| Cache/Queue    | Redis 7, BullMQ                                |
| Storage        | AWS S3                                         |
| AI             | OpenAI API                                     |
| Tools          | Native tool handlers, provider tools           |
| Infrastructure | AWS EC2, Docker Compose, CloudFront            |
| Monorepo       | pnpm workspaces                                |

## Architecture Overview

### Multi-Agent System

The assistant uses a small multi-agent architecture:

- **Orchestrator** — Routes requests, decides which agents to delegate to
- **Research Agent** — Handles RAG queries and searches connected data sources
- **Tool Agent** — Executes tools, handles external operations
- **Verifier Agent** — Validates outputs, checks approval requirements

### Apps

Provider apps connect once per external provider and expose two internal capabilities:

- **Knowledge** — Used for sync, indexing, and retrieval
- **Tools** — Used for live tool access and side-effectful operations

Those capabilities stay separate internally even when they share the same provider credentials.

Current behavior:

- GitHub and Google are the user-facing provider apps
- Knowledge backs RAG over connected sources
- Tools back native tools for live reads and writes

### Tool System

The assistant exposes a unified tool surface that can include both:

- **Native tools** — Built-in functions with direct handlers; this is the primary tool path today
- **Provider tools** — GitHub and Google tools backed by connected provider apps

Tools requiring user confirmation go through an approval flow before execution.

### Voice Support

Voice mode supports an inline live conversation flow inside chat:

1. Client opens a live voice session from the chat input
2. Browser streams microphone audio to OpenAI Realtime over WebRTC
3. OpenAI streams spoken audio and captions back in the same live session
4. Finalized user and assistant turns are persisted into the existing conversation history

Current live voice behavior:

- Automatic turn detection and interruption are enabled
- Live voice is conversational-only in v1
- Native tools, provider tools, approvals, and retrieval stay available in text chat

## Infrastructure

Production runs on a single AWS EC2 instance (in the `aaa-prod-app` Name tag) with everything containerised via [`docker/docker-compose.prod.yml`](docker/docker-compose.prod.yml):

- **Caddy** — reverse proxy on port 80
- **Postgres** (with `pgvector`) and **Redis** — stateful services with their data on a dedicated EBS volume
- **api**, **web**, **worker** — application containers built from the Dockerfiles in [`docker/`](docker/)
- **CloudFront** sits in front of the EC2 public DNS as the origin and terminates TLS
- **S3** holds user uploads and the deploy artifacts produced by the deploy script

### One-time provisioning (`infra/aws-ec2/`)

```bash
pnpm aws:provision
```

See [`infra/aws-ec2/README.md`](infra/aws-ec2/README.md) for what this creates (EC2 + EIP + EBS + S3 bucket), required environment variables, logging, backups, rollback, and restore steps.

### Manual deploys

```bash
pnpm aws:deploy
```

This builds and pushes the three production images to ECR (locally — manual deploys assume Docker is installed and authenticated to your registry), uploads only the rendered `.env.production`, `docker-compose.prod.yml`, and `Caddyfile.prod` to the S3 deploy bucket, and uses SSM Run Command to pull the images, run DB migrations, and restart containers on the EC2 instance. In practice, manual deploys are rarely needed — pushing to `main` runs the same flow on GitHub Actions.

### Continuous deployment

Pushes to `main` automatically deploy via [`.github/workflows/cd.yml`](.github/workflows/cd.yml):

1. Reuse the [`ci.yml`](.github/workflows/ci.yml) gates (format, lint, typecheck, test)
2. Assume an IAM role in AWS via GitHub OIDC (no long-lived AWS keys in GitHub)
3. Build the `aaa-api`, `aaa-worker`, and `aaa-web` ARM64 images in parallel on `ubuntu-24.04-arm` runners with buildx + GitHub Actions layer cache, and push them to ECR tagged with the commit SHA
4. Run `scripts/deploy-aws.sh`, which uploads the deployment manifest (`.env.production`, compose file, Caddyfile) to S3 and triggers an SSM Run Command on the EC2 instance to `docker pull`, run migrations, and `docker compose up -d`
5. Invalidate the CloudFront cache so the new web bundle is served immediately

Deploys are serialised by a `concurrency: deploy-prod` group so two pushes can't race.

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

## Local Development Setup

### Prerequisites

- **Node.js** >= 20
- **pnpm** >= 9
- **Docker** and **Docker Compose** (for local services)
- **OpenAI API key**
- **WSL or Git Bash on Windows** recommended for local app startup

### Clone The Repository

```bash
git clone https://github.com/your-org/agentic-ai-assistant.git
cd agentic-ai-assistant
```

### Configure The Environment

```bash
cp .env.example .env
# Edit .env and add your real values
```

See `.env.example` for the full template.

### Install Dependencies

```bash
pnpm install
```

### Start The App

```bash
pnpm dev:local
```

That command handles the local startup flow for you.

### Verify It’s Working

- Open `http://localhost:3000`
- Check API health at `http://localhost:3001/health`
- Use development login from the home page when `NODE_ENV` is not `production`

### Local Observability

`pnpm dev:local` also starts the local observability stack. Once it is up, you can inspect it here:

- App UI: `http://localhost:3000`
- API: `http://localhost:3001`
- API health: `http://localhost:3001/health`
- API liveness: `http://localhost:3001/health/live`
- API readiness: `http://localhost:3001/health/ready`
- API metrics: `http://localhost:3001/metrics`
- Worker liveness: `http://localhost:9464/health/live`
- Worker readiness: `http://localhost:9464/health/ready`
- Worker metrics: `http://localhost:9464/metrics`
- Grafana dashboards: `http://localhost:3005`
- Prometheus: `http://localhost:9090`
- Loki: `http://localhost:3100`
- Tempo: `http://localhost:3200`

Grafana is provisioned with the local Prometheus, Loki, and Tempo datasources plus the repo dashboards under `docker/observability/grafana/dashboards/`.

When you start the stack via `pnpm dev:local`, the observability containers use baked-in config images instead of host bind mounts, and the host-run API/worker processes push logs directly to Loki on `http://localhost:3100`.

## License

See [LICENSE](./LICENSE).
