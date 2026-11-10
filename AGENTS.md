# AGENTS.md

## Overview

Agentic AI Assistant is a pnpm monorepo for a multi-surface AI assistant with a Next.js web app, Fastify API, and BullMQ worker. Shared TypeScript packages handle orchestration, retrieval, tools, database access, and observability on top of PostgreSQL and Redis. The web app includes text chat, speech-to-speech voice, and a silent Listener Mode for live transcription and insight explanations.

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

Production runs on AWS. See [`infra/aws-ec2/README.md`](infra/aws-ec2/README.md) for provisioning, deployment, and rollback.

Ops notes to keep in sync with that README:

- Prod Compose has no Prometheus/Grafana/Loki stack; observability is local-dev oriented.
- CD skips CloudFront invalidation when `CLOUDFRONT_DISTRIBUTION_ID` is unset; set `CADDY_SITE_ADDRESS` for origin TLS when not behind CloudFront.
- CI and Docker images pin the same pnpm version (`9.15.4`).
- S3 lifecycle (via `provision.sh`) expires `deployments/` after 14 days and `backups/` after 7 days. Deploy installs a daily `pg_dump` (`scripts/backup-postgres.sh`, systemd timer `aaa-postgres-backup.timer` at 08:15 UTC) that uploads to `backups/postgres/` and deletes dumps older than 7 days. Re-run `provision.sh` once so the lifecycle rule exists; the script enforces the same cap before that.
- Deploy waits for Docker `healthy` (API/worker `/health/ready`), not merely `running`.

## Repository Structure

```
├── apps/
│   ├── web/                  # Next.js frontend (App Router, React, Tailwind)
│   ├── api/                  # Fastify backend (REST + WebSocket)
│   └── worker/               # Background job processor (BullMQ)
├── packages/
│   ├── shared/               # Domain types, DTOs, event schemas, enums
│   ├── ai/                   # Model gateway, prompts, chat turn
│   ├── tool-providers/       # Native tool providers used by tool execution
│   ├── retrieval/            # Chunking and indexing. Workspace search ranking lives in the API retrieval bridge
│   ├── knowledge-sources/    # Retrieval-oriented knowledge sources and credential helpers
│   ├── memory/               # Preferences, personalization, memory
│   ├── db/                   # Database schema, migrations, repositories
│   ├── config/               # Environment parsing, constants
│   ├── mcp/                  # Streamable HTTP MCP client
│   ├── integrations/         # External integration helpers
│   ├── queues/               # Shared queue client utilities
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

The tree above is the default owner for a change. These paths are easier to miss:

- Remote MCP servers: check `packages/mcp` and `apps/api/src/services/tools/mcp.ts`. Hydration (URL, API key, tool prefixes, CRS timeout, legacy `tools` vs `task-board` filtering) lives in `packages/mcp/src/connections.ts` and is shared with the worker. The API keeps the Redis tool cache. Multiple servers are stored as separate `app_kind='mcp'` rows keyed by capability slug.
- Chat turns: `ChatService` is the HTTP and automation facade. Turn execution is `apps/api/src/services/chat/turn-runner.ts`, which calls `runModelTurn` in `packages/ai`. The model answers, uses hosted web search, and calls tools. `search_workspace` runs in the API against the retrieval bridge; other tools still go through approval and the worker. Conversation CRUD is `conversations.ts`. Resend (`POST /api/conversations/:id/messages/:messageId/resend`) rewrites that user message, deletes later rows, and starts a new turn. It does not keep a branch.
- Scheduled board automation: check `apps/api/src/services/automation/`, `apps/worker/src/lib/automation-scheduler.ts`, and `apps/web/src/app/chat/automation`
- Worker→browser live events (tool execution, automation runs): Postgres `NOTIFY` on `TOOL_EVENT_CHANNEL` / `AUTOMATION_EVENT_CHANNEL` (`packages/shared`), relayed by the API over conversation WebSockets. New LISTEN channels must use `apps/api/src/lib/pg-notify-relay.ts` so disconnect reconnect/backoff stays consistent.

## Model Providers

Chat completions, embeddings, and realtime speech are three separate seams. The in-app picker switches Luna and Sol inside the chat seam. `conversations.chat_model` stores those OpenAI model ids.

- `ModelProvider` (`packages/ai/src/model-provider.ts`) is the full interface (chat, streaming, embeddings, transcription). `OpenAIProvider` is the only implementation today.
- Callers depend on narrow seams, not on `OpenAIProvider`:
  - `ChatProvider` = `complete` + `streamComplete` (used by the chat turn, `ChatService`, and listener insight explanations)
  - `EmbeddingProvider` = `embed` (used by `RetrievalBridge`, `UploadService`, and the worker embedding job)
  - `RealtimeProvider` = `connectVoice` + `connectListener` + `toolName` (used by `VoiceService` and `ListenerService`). The browser keeps the WebRTC connection. The provider turns the SDP offer and session description into the answer SDP.
- Construct providers through the factory in `packages/ai/src/provider-factory.ts`. Unknown names throw.
  - `createChatProvider(apiKey, modelConfig, provider)` selects from `LLM_CHAT_PROVIDER`.
  - `createEmbeddingProvider(apiKey, modelConfig, provider)` selects from `LLM_EMBEDDING_PROVIDER`.
  - `createRealtimeProvider(apiKey, provider)` selects from `REALTIME_PROVIDER`.
- Only `openai` is registered on each seam. To add a provider: implement the interface, register it in the matching factory, and widen that enum in `packages/config/src/env.ts`. Callers stay on the interface.
- The OpenAI realtime implementation builds the voice and listener session documents and posts the SDP offer. It sends `OpenAI-Safety-Identifier` as a sha256 of the user id. `toolName` is how voice maps a tool call back to the name it sent.

Constraints that stay with a provider swap:

- The `embeddings.vector` column is `vector(1536)` (matches `text-embedding-3-small`). A provider with a different width needs a migration and a re-embedding.
- Hosted web search stays on the chat request. Every text chat turn sets `hostedWebSearch` on the completion; the model chooses whether to search (`tool_choice: auto`). The OpenAI chat provider turns that flag into the Responses API `web_search` tool. Voice and Listener do not get it. The chat UI stage for a search that runs is `searching`. Workspace search is the `search_workspace` function: the API runs it against pgvector during the turn and feeds the excerpts back. Other function tools still return to the app for approval and worker execution.
- Chat PDF attachments are sent as Responses API `input_file` parts built from the stored bytes, including on calls that would otherwise use Chat Completions, and they are not indexed for retrieval.
- Listener Mode (`apps/api/src/services/listener/*`, `apps/web/src/lib/listener/*`, `/chat/listen`) calls `RealtimeProvider.connectListener`. The OpenAI implementation opens a transcription-only session. `OPENAI_TRANSCRIPTION_STREAMING_MODEL` selects its model and defaults to `gpt-live-transcribe`; `OPENAI_TRANSCRIPTION_STANDARD_MODEL` configures file and conversational-voice transcription. Insight explanations reuse the configured chat provider.
- Cost estimation is provider-neutral: use `estimateModelCost` (`packages/observability`); `estimateOpenAiCost` remains as a deprecated alias. Pricing overrides read `LLM_PRICING_OVERRIDES_JSON`.
- Interactive chat stores the model on `conversations.chat_model` and the composer can switch it before any later message in that thread. The picker offers `gpt-6.1-sol` and `gpt-6-luna`. New threads start on `gpt-6-luna`. Existing threads, including hidden automation conversations, were backfilled to `gpt-5.6-luna` and stay there until changed. Voice, Listener, embeddings, and scheduled automation do not use the picker. A chat turn passes that stored model to the model call. Text chat always sets hosted web search, so the turn uses the Responses API. `gpt-6.1-sol` function tools use `reasoning.effort` `low`, because Sol rejects `none` and cannot call functions on Chat Completions. `gpt-6-luna` and `gpt-5.6-luna` use `none` on that Responses request. A completion request that does not set hosted web search still uses Chat Completions for those two models.

## Coding agents

Repository tasks use a separate seam from the chat model. `github.coding_task` resolves the repo through the connected GitHub tools, then hands the task to `CodingAgent` (`packages/tool-providers/src/coding-agent.ts`). Callers depend on that interface (`start` and `fetch`), not on a particular client.

- `createCodingAgent` reads `CODING_AGENT_PROVIDER` and throws on an unknown value. The only implementation today is the Cursor cloud agent (`CursorCodingAgent`), authenticated with `CURSOR_API_KEY`. The model is omitted so the account default is used. The create call does not set `autoCreatePR`. The task text decides whether the run changes code, merges, opens a pull request, or reports that nothing was needed. A branch or pull request URL is stored only when the provider returns one.
- The worker records a `coding_runs` row and returns without finishing the tool execution. A poller calls `fetch` until the snapshot is terminal, or until the run has been open for 2 hours. The first `UPDATE … WHERE status = 'running'` wins. That completion writes the summary onto the tool execution, publishes `tool.done`, and enqueues the existing chat continuation. While the run is open, the poller refreshes the parent automation run heartbeat.
- To add a provider: implement `CodingAgent`, register it in `createCodingAgent`, and widen the `CODING_AGENT_PROVIDER` enum in `packages/config/src/env.ts`. The tool handler, poller, and chat card do not change.

## Scheduled prompts

A schedule is a prompt plus a cadence. When it fires, the API runs that prompt through the same chat turn as a normal message, so connected tools and MCP servers are available. Settings live at `/chat/automation`.

- MCP credentials live in `app_capability_configs` with `app_kind = 'mcp'` (server URL and tool prefixes in `settings`, API key in `encrypted_credentials`). One row per server. The capability slug comes from the server name (`tools`, `crs`, …). Chat and scheduled prompts load tools from every connected server. A server that exposes several tool prefixes is routed by the prefixes saved at connect time; an exact capability match still wins, so an older `task-board` row keeps receiving `tasks_*` calls.
- Every MCP request resolves the saved URL, rejects it when any address is non-public, and pins the connection to the address it checked. Redirects are refused. Do not replace that with a hostname-only string check.
- Schedules and run history live in `automation_schedules` (`prompt`, cron, timezone), `automation_runs`, and append-only `automation_run_events`.
- The worker ticks due schedules in `apps/worker/src/lib/automation-scheduler.ts` (1-minute interval + Redis lock, cron-parser for `next_run_at`) and enqueues `automation` jobs. The API consumes those jobs and calls `ChatService.runScheduledPrompt`. Stuck queued runs are failed after 15 minutes from enqueue; stuck running runs are failed after 90 minutes without a heartbeat. API shutdown marks the in-flight run failed immediately. A hard kill still waits for that 90-minute heartbeat bound. Each prompt turn and tool execution refreshes the heartbeat. At most one in-flight run is allowed per schedule.
- `maxRunsPerDay` counts completed and skipped runs with `trigger = 'schedule'` only, so Run now does not consume the slot. When the cap blocks a fire, the scheduler sets `next_run_at` to the next cron instant and does not insert a run. A schedule that already has a run in progress stays due and retries on a later tick. If `claimDue` succeeds but inserting the run hits the active-run unique constraint, restore the previous `next_run_at` so that slot is not dropped.
- Scheduled turns execute tools without the interactive approval click, because the saved prompt is the authorization. Interactive chat still asks for approval.
- Interactive MCP tools skip approval only when the first action token is a known read-only verb (`list`, `get`, `read`, `search`, …) and no later token is mutating (`create`, `delete`, `replace`, …). Rejected approvals enqueue chat continuation, same as completed or failed tool jobs.
- Approval decisions for interactive chat use an atomic `UPDATE … WHERE status = 'pending' RETURNING *` so concurrent approve/reject cannot double-enqueue tool execution.
- Duplicate `clientRunId` values are rejected while that run is still in the registry; a second start must not replace the in-flight AbortController.
- Each run creates a hidden `conversations.is_automation` row so activity can stream over the existing WebSocket without appearing in the sidebar.

## Local Workflow

Primary local entrypoint:

```bash
pnpm dev:local
```

What it does:

1. Requires a real `.env` in the repo root
2. Refuses to continue unless `DATABASE_URL` and `REDIS_URL` hosts are `localhost`, `127.0.0.1`, `::1`, or the Compose hostnames `postgres` and `redis`. API startup repeats that check when `NODE_ENV` is `development`, before any query
3. Starts PostgreSQL, Redis, and the local observability stack from `docker/docker-compose.yml`
4. Runs DB migrations with `pnpm --filter @aaa/db migrate:up`
5. Seeds `dev@localhost` (no password) and a Welcome conversation when they are not already present. MCP, OAuth, and attachments stay empty
6. Starts all app dev servers with `pnpm dev`

`pnpm dev:local:reset` drops the Compose volumes, then migrates and seeds again.

The home page shows **Use development login** outside production builds. That route only creates or enters `dev@localhost`. Chat still calls the OpenAI key in `.env`. Connecting MCP, Google, or GitHub leaves the machine.

`pnpm dev:local` runs `bash ./scripts/dev-local.sh` (WSL or Git Bash on Windows).

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

## Logging Notes

- Do not intentionally log bearer tokens, OAuth codes, credentials, prompts, transcripts, uploaded file contents, or other secret-bearing payloads

## Maintenance

Coding agents should update this file as part of the same change whenever any of the following become stale:

- Technology stack or infrastructure layout
- Repo shape or package ownership
- Local startup workflow
- Required environment variables
- Verification commands or CI expectations
- Major product capabilities that affect how agents should reason about changes
