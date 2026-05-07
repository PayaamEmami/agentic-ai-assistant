import Link from 'next/link';
import { AppManager } from '@/components/app-manager';

export default function AppsPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
          <section className="border-b border-border pb-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-foreground-inactive">
                  Settings
                </p>
                <h1 className="text-2xl font-semibold text-foreground">Apps</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground-muted">
                  Connect providers for tools, retrieval, and workspace context.
                </p>
              </div>
              <Link
                href="/chat"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-foreground-muted transition hover:bg-surface-hover hover:text-foreground"
                aria-label="Close apps"
                title="Close"
              >
                <CloseIcon />
              </Link>
            </div>
          </section>

          <AppManager />
        </div>
      </div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
