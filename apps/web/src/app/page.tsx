'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAuthContext } from '@/lib/auth-context';

// Account creation is intentionally disabled in this build; this screen only
// supports sign-in (and development login).

export default function Home() {
  const router = useRouter();
  const { isAuthenticated, isReady, login, devLogin, sessionExpired } = useAuthContext();
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
      await login(email, password);
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
    <main className="flex min-h-dvh items-center justify-center bg-surface p-8">
      <section className="w-full max-w-md rounded-3xl border border-border bg-surface-elevated p-8 shadow-sm">
        <h1 className="text-sm font-medium uppercase tracking-[0.2em] text-foreground-muted">
          {sessionExpired ? 'Session expired' : 'Sign in'}
        </h1>
        {sessionExpired ? (
          <p className="mt-2 text-sm text-foreground-muted">Sign in to continue.</p>
        ) : null}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
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
              placeholder="••••••••"
              minLength={8}
              required
            />
          </label>

          {error ? (
            <p className="rounded-2xl border border-error bg-error/10 px-4 py-3 text-sm text-error">
              {error}
            </p>
          ) : null}

          <Button type="submit" disabled={isSubmitting} fullWidth className="rounded-2xl py-3">
            {isSubmitting ? 'Working...' : 'Sign in'}
          </Button>
        </form>

        {process.env.NODE_ENV !== 'production' ? (
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void handleDevLogin()}
              disabled={isSubmitting}
              fullWidth
              className="mt-4 rounded-2xl border-dashed py-3"
            >
              Use development login
            </Button>
          </>
        ) : null}
      </section>
    </main>
  );
}
