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
| `OPENAI_MODEL` | No | Chat model (default: `gpt-5-mini`) |
| `OPENAI_EMBEDDING_MODEL` | No | Embedding model (default: `text-embedding-3-small`) |
| `OPENAI_TRANSCRIPTION_MODEL` | No | Speech-to-text model for voice input (default: `gpt-4o-mini-transcribe`) |
| `OPENAI_TTS_MODEL` | No | Text-to-speech model for assistant playback (default: `gpt-4o-mini-tts`) |
| `OPENAI_TTS_VOICE` | No | Voice preset for assistant playback (default: `marin`) |
| `MCP_SERVERS_CONFIG_PATH` | No | Path to MCP server config JSON |
| `WEB_BASE_URL` | No | Frontend base URL for OAuth callback redirects (default: `http://localhost:3000`) |
| `CONNECTOR_CREDENTIALS_SECRET` | No | Secret used to encrypt persisted connector credentials |
| `GITHUB_CLIENT_ID` | No | GitHub OAuth app client ID |
| `GITHUB_CLIENT_SECRET` | No | GitHub OAuth app client secret |
| `GITHUB_REDIRECT_URI` | No | GitHub OAuth callback URL |
| `GOOGLE_CLIENT_ID` | No | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | No | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | No | Google OAuth callback URL |

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
- **Google Docs** — Native Google Docs indexing for RAG
- **Proton Mail** — Email abstraction (custom integration boundary)

Current connector behavior:

- **Google Docs** — RAG enabled
- **GitHub** — RAG enabled, with user-selected repositories
- **Proton Mail** — Tooling only, not indexed for RAG

### Tool System

Tools are unified through a single registry that handles both:

- **Native tools** — Built-in functions with direct handlers
- **MCP tools** — External tools accessed via the Model Context Protocol

Tools requiring user confirmation go through an approval flow before execution.

### Voice Support

Voice mode supports a push-to-talk flow on top of the existing agent pipeline:

1. Client records microphone audio in the browser
2. API transcribes that audio with OpenAI speech-to-text
3. The transcript is sent through the existing chat and tool orchestration path
4. API synthesizes the assistant's final text reply into audio for playback

## License

See [LICENSE](./LICENSE).
