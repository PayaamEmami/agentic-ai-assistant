'use client';

import Link from 'next/link';
import { useAuthContext } from '@/lib/auth-context';

export function ChatAuthGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isReady, user } = useAuthContext();

  if (!isReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-500">Checking your session...</p>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-8">
        <div className="w-full max-w-md rounded-3xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-2xl font-semibold text-gray-950">Sign in required</h1>
          <p className="mt-3 text-sm leading-6 text-gray-600">
            Chat, API calls, and realtime updates now require an authenticated account.
          </p>
          <Link
            href="/"
            className="mt-6 inline-flex rounded-2xl bg-gray-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-gray-800"
          >
            Go to sign in
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
