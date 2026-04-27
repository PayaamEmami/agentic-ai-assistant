'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuthContext } from '@/lib/auth-context';

type Mode = 'login' | 'register';

const REGISTRATION_ENABLED =
  process.env.NEXT_PUBLIC_DISABLE_REGISTRATION !== 'true' &&
  process.env.NEXT_PUBLIC_DISABLE_REGISTRATION !== '1';

export default function Home() {
  const router = useRouter();
  const { isAuthenticated, isReady, login, register, devLogin } = useAuthContext();
  const [mode, setMode] = useState<Mode>('login');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const activeMode: Mode = REGISTRATION_ENABLED ? mode : 'login';

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
      if (activeMode === 'register') {
        await register(email, password, displayName);
      } else {
        await login(email, password);
      }
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
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Development login failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface p-8">
      <div className="grid w-full max-w-5xl gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-3xl border border-border bg-surface-elevated p-10 shadow-sm">
          <p className="text-sm font-medium uppercase tracking-[0.24em] text-foreground-muted">
            Agentic AI Assistant
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-foreground">Welcome</h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-foreground-muted">
            {REGISTRATION_ENABLED
              ? 'Sign in to your workspace, or create an account to start chatting, use tools, and get answers in real time. Everything here stays private to your account.'
              : 'Sign in to your workspace to start chatting, use tools, and get answers in real time. Everything here stays private to your account.'}
          </p>
          <div className="mt-8 flex flex-wrap gap-3 text-sm text-foreground-muted">
            <span className="rounded-full bg-surface-input px-4 py-2">Private workspace</span>
            <span className="rounded-full bg-surface-input px-4 py-2">{'Chat & tools'}</span>
            <span className="rounded-full bg-surface-input px-4 py-2">Live responses</span>
          </div>
        </section>

        <section className="rounded-3xl border border-border bg-surface-elevated p-8 shadow-sm">
          {REGISTRATION_ENABLED ? (
            <div className="flex rounded-full bg-surface-input p-1 text-sm">
              <button
                type="button"
                onClick={() => setMode('login')}
                className={`flex-1 rounded-full px-4 py-2 transition-colors ${
                  mode === 'login'
                    ? 'bg-surface-elevated text-foreground shadow-sm'
                    : 'text-foreground-muted'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => setMode('register')}
                className={`flex-1 rounded-full px-4 py-2 transition-colors ${
                  mode === 'register'
                    ? 'bg-surface-elevated text-foreground shadow-sm'
                    : 'text-foreground-muted'
                }`}
              >
                Create Account
              </button>
            </div>
          ) : (
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-foreground-muted">
              Sign in
            </p>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {activeMode === 'register' ? (
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-foreground">Display name</span>
                <input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  className="w-full rounded-2xl border border-border-subtle bg-surface-input px-4 py-3 text-foreground placeholder:text-foreground-inactive outline-none transition focus:border-accent"
                  placeholder="Alex Morgan"
                  required
                />
              </label>
            ) : null}

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-foreground">Email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-2xl border border-border-subtle bg-surface-input px-4 py-3 text-foreground placeholder:text-foreground-inactive outline-none transition focus:border-accent"
                placeholder="you@example.com"
                required
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-foreground">Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-2xl border border-border-subtle bg-surface-input px-4 py-3 text-foreground placeholder:text-foreground-inactive outline-none transition focus:border-accent"
                placeholder="At least 8 characters"
                minLength={8}
                required
              />
            </label>

            {error ? (
              <p className="rounded-2xl border border-error bg-error/10 px-4 py-3 text-sm text-error">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-2xl bg-accent px-4 py-3 text-sm font-medium text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting
                ? 'Working...'
                : activeMode === 'register'
                  ? 'Create account'
                  : 'Sign in'}
            </button>
          </form>

          {process.env.NODE_ENV !== 'production' ? (
            <button
              type="button"
              onClick={() => void handleDevLogin()}
              disabled={isSubmitting}
              className="mt-4 w-full rounded-2xl border border-dashed border-border-subtle px-4 py-3 text-sm font-medium text-foreground transition hover:border-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            >
              Use development login
            </button>
          ) : null}

          <p className="mt-6 text-sm text-foreground-muted">
            Already authenticated?{' '}
            <Link href="/chat" className="font-medium text-link underline underline-offset-4">
              Open chat
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}
