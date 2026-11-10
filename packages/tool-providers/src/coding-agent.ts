export type CodingAgentStatus = 'running' | 'finished' | 'error';

export interface CodingAgentRequest {
  repo: string;
  task: string;
  baseBranch?: string;
  /** Context when the task is about an existing pull request. Not a required result. */
  pullRequestUrl?: string;
}

export interface CodingAgentSnapshot {
  status: CodingAgentStatus;
  summary?: string;
  branch?: string;
  pullRequestUrl?: string;
}

export interface CodingAgent {
  readonly providerId: string;
  start(request: CodingAgentRequest): Promise<{ externalId: string }>;
  fetch(externalId: string): Promise<CodingAgentSnapshot>;
}

export class CodingAgentError extends Error {
  readonly userMessage: string;
  readonly isRetryable: boolean;

  constructor(
    message: string,
    options?: {
      userMessage?: string;
      isRetryable?: boolean;
    },
  ) {
    super(message);
    this.name = 'CodingAgentError';
    this.userMessage = options?.userMessage ?? 'The coding task could not start.';
    this.isRetryable = options?.isRetryable ?? false;
  }
}

export function codingAgentPrompt(task: string): string {
  return `${task.trim()}\n\nRun the repository's normal checks. Stop when the task is done.`;
}

export function repositoryUrl(repo: string): string {
  const trimmed = repo.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://github.com/${trimmed}`;
}
