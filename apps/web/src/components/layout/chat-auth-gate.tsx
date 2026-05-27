'use client';

import Link from 'next/link';
import { useAuthContext } from '@/lib/auth-context';

export function ChatAuthGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isReady, user } = useAuthContext();

  if (!isReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <p className="text-sm text-foreground-muted">Checking your session...</p>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface p-8">
        <div className="w-full max-w-md rounded-3xl border border-border bg-surface-elevated p-8 text-center shadow-sm">
          <h1 className="text-2xl font-semibold text-foreground">Sign in required</h1>
          <p className="mt-3 text-sm leading-6 text-foreground-muted">
            Chat, API calls, and realtime updates now require an authenticated account.
          </p>
          <Link
            href="/"
            className="mt-6 inline-flex rounded-2xl bg-accent px-5 py-3 text-sm font-medium text-white transition hover:bg-accent-hover"
          >
            Go to sign in
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
