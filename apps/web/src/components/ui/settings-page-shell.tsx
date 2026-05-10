import Link from 'next/link';
import { CloseIcon } from '@/components/icons';

interface SettingsPageShellProps {
  children: React.ReactNode;
  closeLabel: string;
  title: string;
}

export function SettingsPageShell({ children, closeLabel, title }: SettingsPageShellProps) {
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
                <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
              </div>
              <Link
                href="/chat"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-foreground-muted transition hover:bg-surface-hover hover:text-foreground"
                aria-label={closeLabel}
                title="Close"
              >
                <CloseIcon />
              </Link>
            </div>
          </section>

          {children}
        </div>
      </div>
    </div>
  );
}
