'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuthContext } from '@/lib/auth-context';

type Mode = 'login' | 'register';

export default function Home() {
  const router = useRouter();
  const { isAuthenticated, isReady, login, register, devLogin } = useAuthContext();
  const [mode, setMode] = useState<Mode>('login');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isReady && isAuthenticated) {
      router.replace('/chat');
    }
  }, [isAuthenticated, isReady, router]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      if (mode === 'register') {
        await register(email, password, displayName);
      } else {
        await login(email, password);
      }
      router.replace('/chat');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Authentication failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDevLogin = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      await devLogin();
      router.replace('/chat');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Development login failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="grid w-full max-w-5xl gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-3xl border border-gray-200 bg-white p-10 shadow-sm">
          <p className="text-sm font-medium uppercase tracking-[0.24em] text-gray-500">
            Agentic AI Assistant
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-gray-950">
            Secure access for your personal AI workspace.
          </h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-gray-600">
            Sign in with a real account before opening chat, tools, and realtime events.
            The chat area is now protected behind authenticated API and WebSocket access.
          </p>
          <div className="mt-8 flex flex-wrap gap-3 text-sm text-gray-600">
            <span className="rounded-full bg-gray-100 px-4 py-2">Credential login</span>
            <span className="rounded-full bg-gray-100 px-4 py-2">JWT API access</span>
            <span className="rounded-full bg-gray-100 px-4 py-2">Authenticated sockets</span>
          </div>
        </section>

        <section className="rounded-3xl border border-gray-200 bg-white p-8 shadow-sm">
          <div className="flex rounded-full bg-gray-100 p-1 text-sm">
            <button
              type="button"
              onClick={() => setMode('login')}
              className={`flex-1 rounded-full px-4 py-2 transition-colors ${
                mode === 'login' ? 'bg-white text-gray-950 shadow-sm' : 'text-gray-600'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => setMode('register')}
              className={`flex-1 rounded-full px-4 py-2 transition-colors ${
                mode === 'register' ? 'bg-white text-gray-950 shadow-sm' : 'text-gray-600'
              }`}
            >
              Create Account
            </button>
          </div>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {mode === 'register' ? (
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-gray-700">Display name</span>
                <input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  className="w-full rounded-2xl border border-gray-300 px-4 py-3 outline-none transition focus:border-gray-600"
                  placeholder="Alex Morgan"
                  required
                />
              </label>
            ) : null}

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-gray-700">Email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-2xl border border-gray-300 px-4 py-3 outline-none transition focus:border-gray-600"
                placeholder="you@example.com"
                required
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-gray-700">Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-2xl border border-gray-300 px-4 py-3 outline-none transition focus:border-gray-600"
                placeholder="At least 8 characters"
                minLength={8}
                required
              />
            </label>

            {error ? (
              <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-2xl bg-gray-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting
                ? 'Working...'
                : mode === 'register'
                  ? 'Create account'
                  : 'Sign in'}
            </button>
          </form>

          {process.env.NODE_ENV !== 'production' ? (
            <button
              type="button"
              onClick={() => void handleDevLogin()}
              disabled={isSubmitting}
              className="mt-4 w-full rounded-2xl border border-dashed border-gray-300 px-4 py-3 text-sm font-medium text-gray-700 transition hover:border-gray-500 hover:text-gray-950 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Use development login
            </button>
          ) : null}

          <p className="mt-6 text-sm text-gray-500">
            Already authenticated?{' '}
            <Link href="/chat" className="font-medium text-gray-900 underline underline-offset-4">
              Open chat
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}
