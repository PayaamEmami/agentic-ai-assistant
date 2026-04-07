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

export interface AppSyncRunSummary {
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

export interface AppSourceSummary {
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

export interface McpCatalogEntrySummary {
  kind: 'playwright';
  displayName: string;
  description: string;
  supportsMultipleProfiles: boolean;
  requiresDefaultProfile: boolean;
  authModes: Array<'embedded_browser' | 'stored_secret'>;
}

export interface McpProfileSummary {
  id: string;
  integrationKind: 'playwright';
  profileLabel: string;
  status: 'pending' | 'connected' | 'failed';
  hasCredentials: boolean;
  lastError: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AppCapabilitySummary {
  capability: 'knowledge' | 'tools';
  status: 'pending' | 'connected' | 'failed';
  lastSyncAt: string | null;
  lastSyncStatus: 'pending' | 'running' | 'completed' | 'failed' | null;
  lastError: string | null;
  hasCredentials: boolean;
  totalSourceCount: number;
  searchableSourceCount: number;
  recentSyncRuns: AppSyncRunSummary[];
  recentSources: AppSourceSummary[];
}

export interface AppSummary {
  kind: 'github' | 'google';
  displayName: string;
  status: 'pending' | 'connected' | 'failed';
  hasCredentials: boolean;
  lastError: string | null;
  selectedRepoCount?: number;
  knowledge: AppCapabilitySummary;
  tools: AppCapabilitySummary;
}

export interface BrowserPageSummary {
  id: string;
  url: string;
  title: string;
  isSelected: boolean;
}

export interface McpBrowserSessionSummary {
  id: string;
  userId: string;
  mcpProfileId: string;
  messageId: string | null;
  purpose: 'sign_in' | 'manual' | 'handoff';
  status: 'pending' | 'active' | 'completed' | 'cancelled' | 'failed' | 'expired' | 'crashed';
  conversationId: string | null;
  toolExecutionId: string | null;
  selectedPageId: string | null;
  metadata: Record<string, unknown>;
  lastClientSeenAt: string | null;
  lastFrameAt: string | null;
  expiresAt: string;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BrowserSessionListFilters {
  conversationId?: string;
  includeEnded?: boolean;
  limit?: number;
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

export function buildBrowserWebSocketUrl(
  token: string,
  correlationId = createCorrelationId('browser-ws'),
): string {
  const base = new URL(API_BASE);
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  base.pathname = '/ws/browser';
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
        approvals: Array<{
          id: string;
          toolExecutionId: string;
          description: string;
          status: string;
          createdAt: string;
        }>;
      }>('/api/approvals');
    },
    decide(id: string, status: 'approved' | 'rejected') {
      return request<{ ok: boolean }>(`/api/approvals/${id}/decide`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      });
    },
  },
  apps: {
    list() {
      return request<{ apps: AppSummary[] }>('/api/apps');
    },
    connect(kind: 'github' | 'google') {
      return request<{ authorizationUrl: string }>(`/api/apps/${kind}/connect`, {
        method: 'POST',
      });
    },
    sync(kind: 'github' | 'google') {
      return request<{ queued: boolean }>(`/api/apps/${kind}/sync`, {
        method: 'POST',
      });
    },
    disconnect(kind: 'github' | 'google') {
      return request<{ ok: boolean }>(`/api/apps/${kind}`, {
        method: 'DELETE',
      });
    },
    listGitHubRepositories() {
      return request<{ repositories: GitHubRepositorySummary[] }>(
        '/api/apps/github/repositories',
      );
    },
    saveGitHubRepositories(repositoryIds: number[]) {
      return request<{ ok: boolean }>('/api/apps/github/repositories', {
        method: 'PUT',
        body: JSON.stringify({ repositoryIds }),
      });
    },
  },
  mcp: {
    catalog() {
      return request<{ integrations: McpCatalogEntrySummary[] }>('/api/mcp/catalog');
    },
    listProfiles() {
      return request<{ profiles: McpProfileSummary[] }>('/api/mcp/profiles');
    },
    createProfile(input: {
      integrationKind: 'playwright';
      profileLabel: string;
      authMode?: 'embedded_browser' | 'stored_secret';
      secretProfile?: Record<string, unknown>;
    }) {
      return request<{ profile: McpProfileSummary }>('/api/mcp/profiles', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
    setDefaultProfile(id: string) {
      return request<{ ok: true; profile: McpProfileSummary }>(
        `/api/mcp/profiles/${id}/default`,
        {
          method: 'POST',
        },
      );
    },
    deleteProfile(id: string) {
      return request<{ ok: true }>(`/api/mcp/profiles/${id}`, {
        method: 'DELETE',
      });
    },
    listBrowserSessions(filters?: BrowserSessionListFilters) {
      const params = new URLSearchParams();
      if (filters?.conversationId) {
        params.set('conversationId', filters.conversationId);
      }
      if (filters?.includeEnded) {
        params.set('includeEnded', 'true');
      }
      if (typeof filters?.limit === 'number' && Number.isFinite(filters.limit)) {
        params.set('limit', String(filters.limit));
      }
      const search = params.toString();
      return request<{ sessions: McpBrowserSessionSummary[] }>(
        `/api/mcp/browser-sessions${search ? `?${search}` : ''}`,
      );
    },
    createBrowserSession(
      profileId: string,
      input: {
        purpose?: 'sign_in' | 'manual' | 'handoff';
        conversationId?: string;
        toolExecutionId?: string;
      },
    ) {
      return request<{
        session: McpBrowserSessionSummary;
        pages: BrowserPageSummary[];
      }>(`/api/mcp/profiles/${profileId}/browser-sessions`, {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
    getBrowserSession(id: string) {
      return request<{
        session: McpBrowserSessionSummary;
        pages: BrowserPageSummary[];
      }>(`/api/mcp/browser-sessions/${id}`);
    },
    persistBrowserSession(id: string, persistAsDefault = true) {
      return request<{
        session: McpBrowserSessionSummary;
        profile: McpProfileSummary;
        pages: BrowserPageSummary[];
      }>(`/api/mcp/browser-sessions/${id}/persist`, {
        method: 'POST',
        body: JSON.stringify({ persistAsDefault }),
      });
    },
    cancelBrowserSession(id: string) {
      return request<{ ok: true; session: McpBrowserSessionSummary }>(
        `/api/mcp/browser-sessions/${id}/cancel`,
        {
          method: 'POST',
        },
      );
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
