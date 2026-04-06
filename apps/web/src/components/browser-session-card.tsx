'use client';

import type { McpBrowserSessionSummary } from '@/lib/api-client';
import { sessionStatusLabel } from '@/lib/use-browser-session';

type BrowserSessionPurpose = McpBrowserSessionSummary['purpose'];
type BrowserSessionStatus = McpBrowserSessionSummary['status'];

type BrowserSessionActionTone = 'primary' | 'secondary' | 'danger';

export interface BrowserSessionCardSession {
  purpose: BrowserSessionPurpose;
  status: BrowserSessionStatus;
  conversationId?: string | null;
  metadata?: Record<string, unknown>;
  expiresAt?: string | null;
  endedAt?: string | null;
}

export interface BrowserSessionCardAction {
  label: string;
  onClick: () => void;
  tone?: BrowserSessionActionTone;
  disabled?: boolean;
}

interface BrowserSessionCardProps {
  session: BrowserSessionCardSession;
  title?: string;
  description?: string;
  actions?: BrowserSessionCardAction[];
}

function purposeLabel(purpose: BrowserSessionPurpose): string {
  switch (purpose) {
    case 'auth':
      return 'Sign-in session';
    case 'manual':
      return 'Manual browser session';
    case 'tool_takeover':
      return 'Tool takeover session';
    default:
      return 'Browser session';
  }
}

function statusTone(status: BrowserSessionStatus): string {
  switch (status) {
    case 'active':
      return 'bg-accent/10 text-accent';
    case 'completed':
      return 'bg-success/10 text-success';
    case 'cancelled':
    case 'expired':
    case 'failed':
    case 'crashed':
      return 'bg-error/10 text-error';
    default:
      return 'bg-surface-input text-foreground-muted';
  }
}

function formatTimestamp(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return null;
  }

  return timestamp.toLocaleString();
}

function actionClassName(tone: BrowserSessionActionTone | undefined): string {
  if (tone === 'primary') {
    return 'bg-accent text-white hover:bg-accent-hover';
  }

  if (tone === 'danger') {
    return 'border border-error/30 bg-error/10 text-error hover:bg-error/20';
  }

  return 'border border-border-subtle text-foreground hover:bg-surface-hover';
}

export function BrowserSessionCard({
  session,
  title,
  description,
  actions = [],
}: BrowserSessionCardProps) {
  const endedAtLabel = formatTimestamp(session.endedAt ?? null);
  const expiresAtLabel = formatTimestamp(session.expiresAt ?? null);
  const reason =
    session.metadata && typeof session.metadata['reason'] === 'string'
      ? session.metadata['reason']
      : undefined;

  return (
    <section className="rounded-2xl border border-border bg-surface px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-foreground">
              {title ?? purposeLabel(session.purpose)}
            </p>
            <span
              className={`inline-flex rounded-full px-2 py-1 text-[11px] font-medium ${statusTone(session.status)}`}
            >
              {sessionStatusLabel(session.status)}
            </span>
          </div>
          <p className="mt-1 text-xs text-foreground-muted">
            {description ??
              (session.conversationId
                ? 'Linked to the current conversation'
                : 'Opened outside a specific conversation')}
          </p>
          <p className="mt-2 text-xs text-foreground-muted">
            {endedAtLabel ? `Ended ${endedAtLabel}` : expiresAtLabel ? `Expires ${expiresAtLabel}` : 'Session timing unavailable'}
          </p>
          {reason ? <p className="mt-1 text-xs text-foreground-muted">Reason: {reason}</p> : null}
        </div>

        {actions.length > 0 ? (
          <div className="flex flex-wrap justify-end gap-2">
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={action.onClick}
                disabled={action.disabled}
                className={`rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-50 ${actionClassName(action.tone)}`}
              >
                {action.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
