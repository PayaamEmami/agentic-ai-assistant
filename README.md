# Agentic AI Assistant

A web-based personal AI assistant with chat, voice, multimodal input, RAG over personal data sources, native tool execution, per-user MCP integrations, and multi-agent orchestration. Built on OpenAI foundation models, running on AWS.

## Tech Stack

| Layer          | Technology                                     |
| -------------- | ---------------------------------------------- |
| Frontend       | Next.js 15, React 19, TypeScript, Tailwind CSS |
| Backend        | Node.js, TypeScript, Fastify 5                 |
| Database       | PostgreSQL 16 with pgvector                    |
| Cache/Queue    | Redis 7, BullMQ                                |
| Storage        | AWS S3                                         |
| AI             | OpenAI API                                     |
| Tools          | Native tool handlers, per-user MCP integrations |
| Infrastructure | AWS, Terraform, Docker, Kubernetes             |
| Monorepo       | pnpm workspaces                                |

## Architecture Overview

### Multi-Agent System

The assistant uses a small multi-agent architecture:

- **Orchestrator** — Routes requests, decides which agents to delegate to
- **Research Agent** — Handles RAG queries, searches personal data sources
- **Tool Agent** — Executes tools (native and per-user MCP), handles external operations
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
- A single provider app can power both capabilities without reconnecting twice

### Tool System

The assistant exposes a unified tool surface that can include both:

- **Native tools** — Built-in functions with direct handlers; this is the primary tool path today
- **MCP tools** — First-party per-user integrations managed by the app, starting with Playwright browser automation

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
- Native tools, approvals, per-user MCP tools, and retrieval stay available in text chat

## Infrastructure

### Terraform (`infra/terraform/`)

AWS infrastructure definitions using modular Terraform:

- **networking** — VPC with public/private subnets across two AZs
- **database** — RDS PostgreSQL 16 with encryption
- **cache** — ElastiCache Redis 7
- **storage** — S3 bucket with versioning and encryption

To plan infrastructure:

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your values
terraform init
terraform plan
```

### Kubernetes (`infra/kubernetes/`)

Deployment manifests for:

- API (2 replicas, health probes)
- Web frontend (2 replicas)
- Worker (1 replica)
- ConfigMap for non-sensitive configuration
- Secrets template (use sealed-secrets or external-secrets-operator in production)
- Nginx ingress routing

Apply to a cluster:

```bash
kubectl apply -f infra/kubernetes/namespace.yaml
kubectl apply -f infra/kubernetes/
```

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
│   ├── mcp/                  # Per-user MCP runtime and built-in integrations
│   ├── retrieval/            # Chunking, embeddings, indexing, search
│   ├── knowledge-sources/    # Retrieval-oriented knowledge sources and credential helpers
│   ├── memory/               # Preferences, personalization, memory
│   ├── db/                   # Database schema, migrations, repositories
│   ├── config/               # Environment parsing, constants
│   └── observability/        # Logging, tracing, metrics, sanitization
├── infra/
│   ├── terraform/            # AWS infrastructure (VPC, RDS, ElastiCache, S3)
│   └── kubernetes/           # K8s manifests (deployments, services, ingress)
├── docker/                   # Dockerfiles and docker-compose for local dev
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
