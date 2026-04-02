import { createCorrelationId } from './client-observability';

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const TOKEN_STORAGE_KEY = 'aaa_auth_token';

let cachedToken: string | null = null;

function canUseBrowserStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function getStoredAuthToken(): string | null {
  if (cachedToken) {
    return cachedToken;
  }

  if (canUseBrowserStorage()) {
    const stored = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    if (stored) {
      cachedToken = stored;
      return stored;
    }
  }

  return null;
}

export function setStoredAuthToken(token: string): void {
  cachedToken = token;
  if (canUseBrowserStorage()) {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  }
}

export function clearStoredAuthToken(): void {
  cachedToken = null;
  if (canUseBrowserStorage()) {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

async function getAuthToken(): Promise<string> {
  const token = getStoredAuthToken();
  if (!token) {
    throw new ApiError(401, 'Authentication required', 'AUTH_REQUIRED');
  }
  return token;
}

function buildHeaders(options?: RequestInit, authToken?: string): Headers {
  const headers = new Headers(options?.headers);

  if (authToken) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }

  if (
    options?.body != null &&
    !(options.body instanceof FormData) &&
    !headers.has('Content-Type')
  ) {
    headers.set('Content-Type', 'application/json');
  }

  return headers;
}

async function requestPublic<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const correlationId = createCorrelationId('http');
  const headers = buildHeaders(options);
  headers.set('x-correlation-id', correlationId);
  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      res.status,
      body?.error?.message ?? 'Request failed',
      body?.error?.code,
      res.headers.get('x-request-id') ?? undefined,
      res.headers.get('x-correlation-id') ?? correlationId,
    );
  }

  return res.json() as Promise<T>;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = await getAuthToken();
  const url = `${API_BASE}${path}`;
  const correlationId = createCorrelationId('http');
  const headers = buildHeaders(options, token);
  headers.set('x-correlation-id', correlationId);
  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      res.status,
      body?.error?.message ?? 'Request failed',
      body?.error?.code,
      res.headers.get('x-request-id') ?? undefined,
      res.headers.get('x-correlation-id') ?? correlationId,
    );
  }

  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public requestId?: string,
    public correlationId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface AuthPayload {
  token: string;
  user: {
    id: string;
    email: string;
    displayName: string;
  };
}

export interface ConnectorSummary {
  id: string;
  kind: 'github' | 'google_docs' | 'github_actions' | 'google_drive_actions';
  status: 'pending' | 'connected' | 'failed';
  lastSyncAt: string | null;
  lastSyncStatus: 'pending' | 'running' | 'completed' | 'failed' | null;
  lastError: string | null;
  hasCredentials: boolean;
  selectedRepoCount?: number;
  totalSourceCount: number;
  searchableSourceCount: number;
  recentSyncRuns: ConnectorSyncRunSummary[];
  recentSources: ConnectorSourceSummary[];
}

export interface ConnectorSyncRunSummary {
  id: string;
  trigger: string;
  status: 'running' | 'completed' | 'failed';
  itemsDiscovered: number;
  itemsQueued: number;
  itemsDeleted: number;
  errorCount: number;
  errorSummary: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface ConnectorSourceSummary {
  id: string;
  kind: string;
  title: string;
  uri: string | null;
  mimeType: string | null;
  updatedAt: string;
}

export interface GitHubRepositorySummary {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  defaultBranch: string;
  private: boolean;
  selected: boolean;
}

export type PersonalizationMemoryKind =
  | 'fact'
  | 'preference'
  | 'relationship'
  | 'project'
  | 'person'
  | 'instruction';

export interface PersonalizationProfile {
  writingStyle: string | null;
  tonePreference: string | null;
}

export interface PersonalizationMemory {
  id: string;
  kind: PersonalizationMemoryKind;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationSummaryResponse {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export function buildWebSocketUrl(
  token: string,
  correlationId = createCorrelationId('ws'),
): string {
  const base = new URL(API_BASE);
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  base.pathname = '/ws/events';
  base.searchParams.set('token', token);
  base.searchParams.set('correlationId', correlationId);
  return base.toString();
}

export const api = {
  auth: {
    register(email: string, password: string, displayName: string) {
      return requestPublic<AuthPayload>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, displayName }),
      });
    },
    login(email: string, password: string) {
      return requestPublic<AuthPayload>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
    },
    me() {
      return request<{ user: { id: string; email: string; displayName: string } }>('/api/auth/me');
    },
    devLogin(email: string, displayName: string) {
      return requestPublic<AuthPayload>('/api/auth/dev-login', {
        method: 'POST',
        body: JSON.stringify({ email, displayName }),
      });
    },
  },
  chat: {
    send(content: string, conversationId?: string, attachmentIds?: string[], clientRunId?: string) {
      return request<{ conversationId: string; messageId: string }>('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ content, conversationId, attachmentIds, clientRunId }),
      });
    },
    interruptRun(runId: string) {
      return request<{
        ok: boolean;
        status: 'interrupting' | 'not_found';
        conversationId?: string;
      }>(`/api/chat/runs/${runId}/interrupt`, {
        method: 'POST',
      });
    },
    listConversations() {
      return request<{ conversations: ConversationSummaryResponse[] }>('/api/conversations');
    },
    getConversation(id: string) {
      return request<{
        id: string;
        title: string | null;
        messages: Array<{ id: string; role: string; content: unknown[]; createdAt: string }>;
      }>(`/api/conversations/${id}`);
    },
    updateConversation(id: string, title: string) {
      return request<{ conversation: ConversationSummaryResponse }>(`/api/conversations/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title }),
      });
    },
    deleteConversation(id: string) {
      return request<{ ok: boolean }>(`/api/conversations/${id}`, {
        method: 'DELETE',
      });
    },
  },
  upload: {
    async uploadFile(file: File, options?: { indexForRag?: boolean }) {
      const token = await getAuthToken();
      const formData = new FormData();
      formData.append('file', file);
      const url = new URL(`${API_BASE}/api/upload`);
      if (options?.indexForRag) {
        url.searchParams.set('indexForRag', 'true');
      }
      const res = await fetch(url, {
        method: 'POST',
        body: formData,
        headers: {
          Authorization: `Bearer ${token}`,
          'x-correlation-id': createCorrelationId('upload'),
        },
      });
      if (!res.ok) {
        throw new ApiError(
          res.status,
          'Upload failed',
          undefined,
          res.headers.get('x-request-id') ?? undefined,
          res.headers.get('x-correlation-id') ?? undefined,
        );
      }
      return res.json() as Promise<{
        attachmentId: string;
        fileName: string;
        mimeType: string;
        sizeBytes: number;
        kind: 'image' | 'document' | 'audio' | 'file';
        indexedForRag: boolean;
        documentId?: string | null;
      }>;
    },
  },
  approvals: {
    listPending() {
      return request<{
        approvals: Array<{ id: string; description: string; status: string; createdAt: string }>;
      }>('/api/approvals');
    },
    decide(id: string, status: 'approved' | 'rejected') {
      return request<{ ok: boolean }>(`/api/approvals/${id}/decide`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      });
    },
  },
  connectors: {
    list() {
      return request<{ connectors: ConnectorSummary[] }>('/api/connectors');
    },
    start(kind: 'github' | 'google_docs' | 'github_actions' | 'google_drive_actions') {
      return request<{ authorizationUrl: string }>(`/api/connectors/${kind}/start`, {
        method: 'POST',
      });
    },
    sync(kind: 'github' | 'google_docs' | 'github_actions' | 'google_drive_actions') {
      return request<{ queued: boolean }>(`/api/connectors/${kind}/sync`, {
        method: 'POST',
      });
    },
    disconnect(kind: 'github' | 'google_docs' | 'github_actions' | 'google_drive_actions') {
      return request<{ ok: boolean }>(`/api/connectors/${kind}`, {
        method: 'DELETE',
      });
    },
    listGitHubRepos() {
      return request<{ repositories: GitHubRepositorySummary[] }>('/api/connectors/github/repos');
    },
    saveGitHubRepos(repositoryIds: number[]) {
      return request<{ ok: boolean }>('/api/connectors/github/repos', {
        method: 'POST',
        body: JSON.stringify({ repositoryIds }),
      });
    },
  },
  voice: {
    createSession(conversationId?: string) {
      return request<{
        sessionId: string;
        clientSecret: string;
        expiresAt: string;
        conversationId: string;
        model: string;
        voice: string;
      }>('/api/voice/session', {
        method: 'POST',
        body: JSON.stringify({ conversationId }),
      });
    },
    persistTurn(
      conversationId: string | undefined,
      userTranscript: string,
      assistantTranscript: string,
    ) {
      return request<{
        conversationId: string;
        userMessageId: string;
        assistantMessageId: string;
      }>('/api/voice/turns', {
        method: 'POST',
        body: JSON.stringify({ conversationId, userTranscript, assistantTranscript }),
      });
    },
  },
  personalization: {
    get() {
      return request<{
        profile: PersonalizationProfile;
        memories: PersonalizationMemory[];
      }>('/api/personalization');
    },
    updateProfile(input: { writingStyle?: string | null; tonePreference?: string | null }) {
      return request<{ profile: PersonalizationProfile }>('/api/personalization/profile', {
        method: 'PUT',
        body: JSON.stringify(input),
      });
    },
    createMemory(input: { kind: PersonalizationMemoryKind; content: string }) {
      return request<{ memory: PersonalizationMemory }>('/api/personalization/memories', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
    updateMemory(memoryId: string, input: { content: string }) {
      return request<{ memory: PersonalizationMemory }>(
        `/api/personalization/memories/${memoryId}`,
        {
          method: 'PATCH',
          body: JSON.stringify(input),
        },
      );
    },
    deleteMemory(memoryId: string) {
      return request<{ ok: boolean }>(`/api/personalization/memories/${memoryId}`, {
        method: 'DELETE',
      });
    },
  },
};
