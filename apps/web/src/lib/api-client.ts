const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const DEV_AUTH_EMAIL = process.env.NEXT_PUBLIC_DEV_AUTH_EMAIL ?? 'dev@localhost';
const TOKEN_STORAGE_KEY = 'aaa_auth_token';

let cachedToken: string | null = null;

function canUseBrowserStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

async function requestDevToken(): Promise<string> {
  const response = await fetch(`${API_BASE}/api/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: DEV_AUTH_EMAIL,
      displayName: 'Dev User',
    }),
  });

  if (!response.ok) {
    throw new ApiError(response.status, 'Failed to create development auth token');
  }

  const payload = (await response.json()) as { token?: string };
  if (!payload.token) {
    throw new ApiError(500, 'Auth token missing in dev-login response');
  }

  return payload.token;
}

async function getAuthToken(): Promise<string> {
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

  const token = await requestDevToken();
  cachedToken = token;

  if (canUseBrowserStorage()) {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  }

  return token;
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

export const api = {
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
    async uploadFile(file: File) {
      const token = await getAuthToken();
      const formData = new FormData();
      formData.append('file', file);
      const url = `${API_BASE}/api/upload`;
      const res = await fetch(url, {
        method: 'POST',
        body: formData,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) throw new ApiError(res.status, 'Upload failed');
      return res.json() as Promise<{ attachmentId: string; fileName: string; mimeType: string; sizeBytes: number }>;
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
