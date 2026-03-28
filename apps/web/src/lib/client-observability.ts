'use client';

const SESSION_STORAGE_KEY = 'aaa_client_session_id';

function canUseSessionStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
}

export function getClientSessionId(): string {
  if (!canUseSessionStorage()) {
    return 'server-render';
  }

  const existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (existing) {
    return existing;
  }

  const value = crypto.randomUUID();
  window.sessionStorage.setItem(SESSION_STORAGE_KEY, value);
  return value;
}

export function createCorrelationId(prefix = 'web'): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
