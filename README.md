# Agentic AI Assistant

Agentic AI Assistant is a self-hosted personal AI workspace with chat, voice, retrieval over connected data sources, persistent memory, and native tool execution.

The main idea behind the project is to make the assistant’s intelligence portable. Personalization, memory, connected data, and tool workflows live in the application rather than inside a single model provider’s ecosystem. That means the assistant can adopt newer or better models over time without forcing the user to rebuild their context, preferences, or workflow history. By keeping that context in user-owned storage, the assistant can provide a more durable personal layer without depending on any one vendor to preserve it.

## Features

- Chat interface with persistent conversation history
- Voice mode with live transcription and spoken responses
- Retrieval-augmented answers over connected data sources
- Persistent personalization, preferences, and long-term memory
- Native tool execution with approval flow for sensitive actions
- Connected app model for separating knowledge access from tool access
- Multi-agent orchestration for routing, research, tool use, and verification
- Self-hosted deployment with an owned database and local observability

## Architecture Overview

### Multi-Agent System

The assistant uses a small multi-agent architecture around each assistant turn:

- **Orchestrator** — Routes requests and decides whether to answer directly or delegate
- **Research Agent** — Synthesizes answers from retrieved context
- **Tool Agent** — Prepares tool calls for live reads, writes, and external operations
- **Coding Agent** — Handles GitHub coding tasks through an isolated worker checkout
- **Verifier Agent** — Checks the final output for safety, grounding, and approval requirements

### Connected Apps

Provider apps connect once per external provider and expose separate internal capabilities:

- **Knowledge** — Used for sync, indexing, and retrieval
- **Tools** — Used for live tool access and side-effectful operations

### Tool Execution

The assistant exposes a unified native tool surface to the model:

- **Built-in tools** — Local handlers such as time, sum, echo, and simulated external operations
- **Provider-backed tools** — GitHub, Google Drive, Google Docs, and coding-task tools that execute through connected app credentials

### Live Voice

Voice mode supports an inline live conversation flow inside chat:

1. Client opens a live voice session from the chat input
2. Browser streams microphone audio to a realtime voice session over WebRTC
3. The voice session streams spoken audio and captions back to the browser
4. Finalized user and assistant turns are persisted into the existing conversation history

Current live voice behavior:

- Automatic turn detection and interruption are enabled
- Live voice can invoke available tools during a spoken session
- Tools that require approval pause until the user approves or rejects them in the UI
- Retrieval context is prepared per voice turn and citations are attached when used

## Tech Stack

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

## Local Development Setup

### Prerequisites

- **Node.js** >= 20
- **pnpm** >= 9
- **Docker** and **Docker Compose** (for local services)
- **Model provider API key**
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

`pnpm dev:local` also starts the local observability stack with Grafana, Prometheus, Loki, and Tempo. App, API, worker, metrics, and dashboard endpoints are exposed locally for debugging and development.

## License

See [LICENSE](./LICENSE).
