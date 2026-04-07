import Link from 'next/link';
import { AppManager } from '@/components/app-manager';

export default function AppsPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface-elevated">
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
          <section>
            <div className="flex items-center justify-between gap-4">
              <h1 className="text-3xl font-semibold text-foreground">Apps</h1>
              <Link
                href="/chat"
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-border-subtle bg-surface text-foreground-muted transition hover:border-border hover:bg-surface-hover hover:text-foreground"
                aria-label="Close apps"
                title="Close"
              >
                <CloseIcon />
              </Link>
            </div>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-foreground-muted">
              Connect provider apps and environments for this workspace.
            </p>
          </section>

          <section className="rounded-3xl border border-border bg-surface p-6">
            <AppManager />
          </section>
        </div>
      </div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
