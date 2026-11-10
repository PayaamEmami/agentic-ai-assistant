import { requestJson } from './http.js';
import {
  CodingAgentError,
  codingAgentPrompt,
  repositoryUrl,
  type CodingAgent,
  type CodingAgentRequest,
  type CodingAgentSnapshot,
} from './coding-agent.js';

const API_BASE = 'https://api.cursor.com';

type RequestJson = <T>(input: string, init?: RequestInit) => Promise<T>;

interface CursorCreateResponse {
  agent?: { id?: string };
}

interface CursorAgentRecord {
  latestRunId?: string;
}

interface CursorRunRecord {
  status?: string;
  result?: string;
  git?: {
    branches?: Array<{ branch?: string; prUrl?: string }>;
  };
}

const ACTIVE_RUN_STATUSES = new Set(['CREATING', 'RUNNING', 'WAITING_FOR_BACKGROUND_WORK']);
const FAILED_RUN_STATUSES = new Set(['ERROR', 'CANCELLED', 'EXPIRED']);

export class CursorCodingAgent implements CodingAgent {
  readonly providerId = 'cursor';

  constructor(
    private readonly apiKey: string,
    private readonly request: RequestJson = requestJson,
  ) {}

  async start(request: CodingAgentRequest): Promise<{ externalId: string }> {
    const repo: { url: string; startingRef?: string; prUrl?: string } = {
      url: repositoryUrl(request.repo),
    };
    if (request.baseBranch) {
      repo.startingRef = request.baseBranch;
    }
    if (request.pullRequestUrl) {
      repo.prUrl = request.pullRequestUrl;
    }

    try {
      const created = await this.request<CursorCreateResponse>(`${API_BASE}/v1/agents`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          prompt: { text: codingAgentPrompt(request.task) },
          repos: [repo],
        }),
      });
      const externalId = created.agent?.id;
      if (!externalId) {
        throw new CodingAgentError('Coding agent did not return an id');
      }
      return { externalId };
    } catch (error) {
      throw asCodingAgentError(error);
    }
  }

  async fetch(externalId: string): Promise<CodingAgentSnapshot> {
    try {
      const agent = await this.request<CursorAgentRecord>(
        `${API_BASE}/v1/agents/${encodeURIComponent(externalId)}`,
        { headers: this.headers() },
      );
      if (!agent.latestRunId) {
        return { status: 'running' };
      }
      const run = await this.request<CursorRunRecord>(
        `${API_BASE}/v1/agents/${encodeURIComponent(externalId)}/runs/${encodeURIComponent(agent.latestRunId)}`,
        { headers: this.headers() },
      );
      return snapshotFromRun(run);
    } catch (error) {
      throw asCodingAgentError(error);
    }
  }

  private headers(): Record<string, string> {
    const token = Buffer.from(`${this.apiKey}:`).toString('base64');
    return {
      Authorization: `Basic ${token}`,
      'Content-Type': 'application/json',
    };
  }
}

export function snapshotFromRun(run: CursorRunRecord): CodingAgentSnapshot {
  const branch = run.git?.branches?.find((entry) => entry.branch || entry.prUrl);
  const links = {
    ...(branch?.branch ? { branch: branch.branch } : {}),
    ...(branch?.prUrl ? { pullRequestUrl: branch.prUrl } : {}),
  };
  const status = run.status ?? '';
  if (ACTIVE_RUN_STATUSES.has(status) || status.length === 0) {
    return { status: 'running', ...links };
  }
  if (status === 'FINISHED') {
    return {
      status: 'finished',
      summary: run.result?.trim() || 'The coding task finished.',
      ...links,
    };
  }
  if (FAILED_RUN_STATUSES.has(status)) {
    return {
      status: 'error',
      summary: run.result?.trim() || 'The coding task failed.',
      ...links,
    };
  }
  return { status: 'running', ...links };
}

function asCodingAgentError(error: unknown): CodingAgentError {
  if (error instanceof CodingAgentError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/HTTP (400|403|404)\b/.test(message) && /repo|repository|not found|permission/i.test(message)) {
    return new CodingAgentError(message, {
      userMessage: 'That repository is not available to the coding agent.',
    });
  }
  const retryable = /HTTP (408|429|5\d\d)\b/.test(message);
  return new CodingAgentError(message, { isRetryable: retryable });
}
