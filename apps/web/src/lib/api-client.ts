const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
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

async function requestPublic<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body?.error?.message ?? 'Request failed', body?.error?.code);
  }

  return res.json() as Promise<T>;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = await getAuthToken();
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body?.error?.message ?? 'Request failed', body?.error?.code);
  }

  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
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

export function buildWebSocketUrl(token: string): string {
  const base = new URL(API_BASE);
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  base.pathname = '/ws/events';
  base.searchParams.set('token', token);
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
    send(content: string, conversationId?: string, attachmentIds?: string[]) {
      return request<{ conversationId: string; messageId: string }>('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ content, conversationId, attachmentIds }),
      });
    },
    listConversations() {
      return request<{ conversations: Array<{ id: string; title: string | null; createdAt: string; updatedAt: string }> }>('/api/conversations');
    },
    getConversation(id: string) {
      return request<{ id: string; title: string | null; messages: Array<{ id: string; role: string; content: unknown[]; createdAt: string }> }>(`/api/conversations/${id}`);
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
        },
      });
      if (!res.ok) throw new ApiError(res.status, 'Upload failed');
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
      return request<{ approvals: Array<{ id: string; description: string; status: string; createdAt: string }> }>('/api/approvals');
    },
    decide(id: string, status: 'approved' | 'rejected') {
      return request<{ ok: boolean }>(`/api/approvals/${id}/decide`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      });
    },
  },
  voice: {
    createSession(conversationId?: string) {
      return request<{ sessionId: string; ephemeralToken: string; expiresAt: string; conversationId: string }>('/api/voice/session', {
        method: 'POST',
        body: JSON.stringify({ conversationId }),
      });
    },
  },
};
