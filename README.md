# Agentic AI Assistant

A web-based personal AI assistant with chat, voice, multimodal input, RAG over personal data sources, MCP-based tool integration, and multi-agent orchestration. Built on OpenAI foundation models, running on AWS.

## Repository Structure

```
├── apps/
│   ├── web/                  # Next.js frontend (App Router, React, Tailwind)
│   ├── api/                  # Fastify backend (REST + WebSocket)
│   └── worker/               # Background job processor (BullMQ)
├── packages/
│   ├── shared/               # Domain types, DTOs, event schemas, enums
│   ├── ai/                   # Model gateway, prompts, agent orchestration
│   ├── mcp/                  # MCP client adapter and tool registry
│   ├── retrieval/            # Chunking, embeddings, indexing, search
│   ├── connectors/           # GitHub, Google Drive/Docs, Proton email
│   ├── memory/               # Preferences, personalization, memory
│   ├── db/                   # Database schema, migrations, repositories
│   └── config/               # Environment parsing, constants
├── infra/
│   ├── terraform/            # AWS infrastructure (VPC, RDS, ElastiCache, S3)
│   └── kubernetes/           # K8s manifests (deployments, services, ingress)
├── docker/                   # Dockerfiles and docker-compose for local dev
├── .env.example              # Environment variable template
├── pnpm-workspace.yaml       # pnpm workspace definition
└── tsconfig.base.json        # Shared TypeScript configuration
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS |
| Backend | Node.js, TypeScript, Fastify 5 |
| Database | PostgreSQL 16 with pgvector |
| Cache/Queue | Redis 7, BullMQ |
| Storage | AWS S3 |
| AI | OpenAI API (GPT-4o, text-embedding-3-small) |
| Tools | MCP (Model Context Protocol) |
| Infrastructure | AWS, Terraform, Docker, Kubernetes |
| Monorepo | pnpm workspaces |

## Prerequisites

- **Node.js** >= 20
- **pnpm** >= 9 (`corepack enable && corepack prepare pnpm@9.15.4 --activate`)
- **Docker** and **Docker Compose** (for local services)
- **OpenAI API key**

## Local Development Setup

### 1. Clone and install

```bash
git clone https://github.com/your-org/agentic-ai-assistant.git
cd agentic-ai-assistant
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY
pnpm install
```

### 2. Start local services (PostgreSQL + Redis)

```bash
docker compose -f docker/docker-compose.yml up -d postgres redis
```

This starts:
- PostgreSQL 16 with pgvector on port 5432
- Redis 7 on port 6379

### 3. Run database migrations

```bash
cd packages/db
pnpm migrate:up
cd ../..
```

### 4. Build packages

```bash
pnpm build
```

### 5. Start development servers

```bash
pnpm dev
```

This starts the API server (port 3001), the worker, and the Next.js frontend (port 3000) concurrently.

Alternatively, start services individually:

```bash
# Terminal 1: API
pnpm --filter @aaa/api dev

# Terminal 2: Worker
pnpm --filter @aaa/worker dev

# Terminal 3: Web
pnpm --filter @aaa/web dev
```

## Running with Docker Compose

To run the full stack in containers:

```bash
# Set your OpenAI API key
export OPENAI_API_KEY=sk-your-key-here

# Build and start everything
docker compose -f docker/docker-compose.yml up --build
```

Services:
- **Web**: http://localhost:3000
- **API**: http://localhost:3001
- **PostgreSQL**: localhost:5432
- **Redis**: localhost:6379

## Required Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `OPENAI_API_KEY` | Yes | OpenAI API key |
| `REDIS_URL` | No | Redis connection string (default: `redis://localhost:6379`) |
| `API_HOST` | No | API bind host (default: `0.0.0.0`) |
| `API_PORT` | No | API port (default: `3001`) |
| `S3_BUCKET` | No | S3 bucket name (default: `aaa-uploads`) |
| `S3_REGION` | No | AWS region (default: `us-east-1`) |
| `S3_ENDPOINT` | No | S3 endpoint override (for local MinIO) |
| `OPENAI_MODEL` | No | Chat model (default: `gpt-4o`) |
| `OPENAI_EMBEDDING_MODEL` | No | Embedding model (default: `text-embedding-3-small`) |
| `MCP_SERVERS_CONFIG_PATH` | No | Path to MCP server config JSON |
| `GITHUB_TOKEN` | No | GitHub personal access token |
| `GOOGLE_CLIENT_ID` | No | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | No | Google OAuth client secret |

See `.env.example` for the full template.

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

## Architecture Overview

### Multi-Agent System

The assistant uses a small multi-agent architecture:

- **Orchestrator** — Routes requests, decides which agents to delegate to
- **Research Agent** — Handles RAG queries, searches personal data sources
- **Action Agent** — Executes tools (native and MCP), handles external actions
- **Verifier Agent** — Validates outputs, checks approval requirements

### Connectors

Initial data source connectors:

- **GitHub** — Repository and code access
- **Google Drive / Docs** — Document access and search
- **Proton Mail** — Email abstraction (custom integration boundary)

### Tool System

Tools are unified through a single registry that handles both:

- **Native tools** — Built-in functions with direct handlers
- **MCP tools** — External tools accessed via the Model Context Protocol

Tools requiring user confirmation go through an approval flow before execution.

### Voice Support

Voice is architected into the system from the start:

1. Client requests a voice session from the API
2. API bootstraps an ephemeral OpenAI Realtime session token
3. Client connects directly to OpenAI Realtime
4. Transcript events flow back into the conversation timeline

## Deferred Implementation

The following areas are scaffolded with interfaces and placeholders but not yet fully implemented:

- **Authentication** — Placeholder middleware reads `x-user-id` header; no real auth flow yet
- **OpenAI integration** — Provider interface defined; actual API calls not wired
- **RAG pipeline** — Chunking, embedding, and search interfaces exist; implementation deferred
- **MCP protocol** — Client adapter and registry structured; protocol handling not implemented
- **Connector auth flows** — OAuth/token flows not implemented
- **Voice session** — Route and types exist; ephemeral token creation not implemented
- **Agent orchestration** — Multi-agent loop structured; prompt engineering and tool routing deferred
- **Background jobs** — Job handlers registered; processing logic not implemented
- **Real-time streaming** — WebSocket endpoint exists; event broadcasting not wired

## License

See [LICENSE](./LICENSE).
