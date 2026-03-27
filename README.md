# Agentic AI Assistant

A web-based personal AI assistant with chat, voice, multimodal input, RAG over personal data sources, MCP-based tool integration, and multi-agent orchestration. Built on OpenAI foundation models, running on AWS.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS |
| Backend | Node.js, TypeScript, Fastify 5 |
| Database | PostgreSQL 16 with pgvector |
| Cache/Queue | Redis 7, BullMQ |
| Storage | AWS S3 |
| AI | OpenAI API |
| Tools | MCP (Model Context Protocol) |
| Infrastructure | AWS, Terraform, Docker, Kubernetes |
| Monorepo | pnpm workspaces |

## Architecture Overview

### Multi-Agent System

The assistant uses a small multi-agent architecture:

- **Orchestrator** — Routes requests, decides which agents to delegate to
- **Research Agent** — Handles RAG queries, searches personal data sources
- **Action Agent** — Executes tools (native and MCP), handles external actions
- **Verifier Agent** — Validates outputs, checks approval requirements

### Connectors

Current data source connectors:

- **GitHub** — Repository and code access
- **Google Docs** — Native Google Docs indexing for RAG

Current connector behavior:

- **Google Docs** — RAG enabled
- **GitHub** — RAG enabled, with user-selected repositories

### Tool System

Tools are unified through a single registry that handles both:

- **Native tools** — Built-in functions with direct handlers
- **MCP tools** — External tools accessed via the Model Context Protocol

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
- Tools, approvals, MCP actions, and retrieval stay available in text chat

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
│   ├── mcp/                  # MCP client adapter and tool registry
│   ├── retrieval/            # Chunking, embeddings, indexing, search
│   ├── connectors/           # GitHub and Google Docs connectors
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

## Local Development Setup

### Prerequisites

- **Node.js** >= 20
- **pnpm** >= 9 (`corepack enable && corepack prepare pnpm@9.15.4 --activate`)
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
corepack enable
corepack prepare pnpm@9.15.4 --activate
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

## License

See [LICENSE](./LICENSE).
