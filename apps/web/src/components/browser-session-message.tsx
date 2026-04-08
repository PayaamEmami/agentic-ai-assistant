'use client';

import type { BrowserSessionContentBlock } from '@/lib/chat-context';
import { sessionStatusLabel } from '@/lib/use-browser-session';
import { BrowserSessionCard } from './browser-session-card';
import { useChatBrowserContext } from './chat-browser-context';

function isLiveStatus(status: NonNullable<BrowserSessionContentBlock['status']>): boolean {
  return status === 'pending' || status === 'active';
}

function statusTone(status: NonNullable<BrowserSessionContentBlock['status']>): string {
  switch (status) {
    case 'active':
      return 'bg-accent/15 text-accent';
    case 'pending':
      return 'bg-surface-input text-foreground-muted';
    default:
      return 'bg-error/10 text-error';
  }
}

function purposeCopy(purpose: NonNullable<BrowserSessionContentBlock['purpose']>): string {
  switch (purpose) {
    case 'sign_in':
      return 'Authentication browser';
    case 'handoff':
      return 'Agent handoff browser';
    default:
      return 'Interactive browser';
  }
}

function browserStatusCopy(input: {
  socketState: 'connecting' | 'connected' | 'disconnected';
  controlGranted: boolean;
  isTouchDevice: boolean;
}): string {
  if (input.socketState === 'connecting') {
    return 'Connecting to the live browser...';
  }
  if (input.socketState === 'disconnected') {
    return 'Live preview disconnected.';
  }
  if (input.isTouchDevice) {
    return 'Touch devices stay view-only.';
  }
  if (!input.controlGranted) {
    return 'View-only here. Take over from the dock when needed.';
  }
  return 'Live preview ready.';
}

function ThreadActionButton({
  label,
  onClick,
  tone = 'secondary',
}: {
  label: string;
  onClick: () => void;
  tone?: 'primary' | 'secondary';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-2 text-xs font-medium transition ${
        tone === 'primary'
          ? 'bg-accent text-white hover:bg-accent-hover'
          : 'border border-border-subtle text-foreground hover:bg-surface-hover'
      }`}
    >
      {label}
    </button>
  );
}

export function BrowserSessionMessage({ block }: { block: BrowserSessionContentBlock }) {
  const browserContext = useChatBrowserContext();
  const sessionStatus = block.status ?? 'pending';
  const sessionPurpose = block.purpose ?? 'manual';
  const browserSessionId = block.browserSessionId;
  const live = isLiveStatus(sessionStatus);

  if (!live || !browserSessionId || !browserContext) {
    return (
      <BrowserSessionCard
        session={{
          purpose: sessionPurpose,
          status: sessionStatus,
          expiresAt: block.expiresAt ?? null,
          endedAt: block.endedAt ?? null,
          metadata: {
            handoffReason: block.handoffReason ?? undefined,
            terminalReason: block.terminalReason ?? undefined,
          },
        }}
        title={block.profileLabel ?? 'Browser session'}
        description={`${purposeCopy(sessionPurpose)} linked to this conversation`}
      />
    );
  }

  const isSelected = browserContext.isSessionSelected(browserSessionId);
  const isDocked = browserContext.isSessionDocked(browserSessionId);
  const canRenderMini = browserContext.canRenderMiniPreview(browserSessionId);
  const browser = isSelected ? browserContext.browser : null;
  const browserStatus = browser
    ? browserStatusCopy({
        socketState: browser.socketState,
        controlGranted: browser.controlGranted,
        isTouchDevice: browser.isTouchDevice,
      })
    : 'Live browser available.';

  if (canRenderMini && browser) {
    return (
      <section className="group overflow-hidden rounded-[24px] border border-border bg-surface shadow-sm">
        <div className="relative bg-[#111827]">
          <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 bg-gradient-to-b from-black/75 via-black/35 to-transparent p-4 text-white">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-semibold">
                  {block.profileLabel ?? 'Browser session'}
                </p>
                <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${statusTone(sessionStatus)}`}>
                  {sessionStatusLabel(sessionStatus)}
                </span>
              </div>
              <p className="mt-1 text-xs text-white/75">{purposeCopy(sessionPurpose)}</p>
            </div>
          </div>

          <div className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-between gap-3 bg-gradient-to-t from-black/80 via-black/35 to-transparent p-4 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
            <p className="text-xs text-white/75">{browserStatus}</p>
            <div className="flex items-center gap-2">
              <ThreadActionButton
                label="Open dock"
                onClick={() => browserContext.openSessionDock(browserSessionId)}
                tone="primary"
              />
              <ThreadActionButton
                label="Full screen"
                onClick={() => browserContext.openSessionFullscreen(browserSessionId)}
              />
            </div>
          </div>

          {browser.frameUrl ? (
            <img
              src={browser.frameUrl}
              alt={`Live browser frame${browser.selectedPage?.title ? ` for ${browser.selectedPage.title}` : ''}`}
              className="block aspect-[16/10] w-full object-cover"
              draggable={false}
            />
          ) : (
            <div className="flex aspect-[16/10] items-center justify-center px-6 text-center text-sm text-white/70">
              Waiting for the live browser stream...
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">
              {browser.selectedPage?.title || browser.selectedPage?.url || 'Live preview'}
            </p>
            <p className="mt-1 text-xs text-foreground-muted">{browserStatus}</p>
          </div>
          <div className="flex items-center gap-2">
            <ThreadActionButton
              label="Open dock"
              onClick={() => browserContext.openSessionDock(browserSessionId)}
              tone="primary"
            />
            <ThreadActionButton
              label="Full screen"
              onClick={() => browserContext.openSessionFullscreen(browserSessionId)}
            />
          </div>
        </div>
      </section>
    );
  }

  if (isDocked) {
    return (
      <section className="rounded-[22px] border border-border bg-surface px-4 py-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-foreground">
                {block.profileLabel ?? 'Browser session'}
              </p>
              <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${statusTone(sessionStatus)}`}>
                {sessionStatusLabel(sessionStatus)}
              </span>
            </div>
            <p className="mt-1 text-xs text-foreground-muted">
              The live browser is open in the chat dock below.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ThreadActionButton
              label="Collapse to mini"
              onClick={() => browserContext.collapseToMini(browserSessionId)}
            />
            <ThreadActionButton
              label="Full screen"
              onClick={() => browserContext.openSessionFullscreen(browserSessionId)}
              tone="primary"
            />
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-[22px] border border-border bg-surface px-4 py-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-foreground">
              {block.profileLabel ?? 'Browser session'}
            </p>
            <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${statusTone(sessionStatus)}`}>
              {sessionStatusLabel(sessionStatus)}
            </span>
          </div>
          <p className="mt-1 text-xs text-foreground-muted">
            {purposeCopy(sessionPurpose)} available in this conversation.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ThreadActionButton
            label="Show mini"
            onClick={() => browserContext.showSessionMini(browserSessionId)}
            tone="primary"
          />
          <ThreadActionButton
            label="Open dock"
            onClick={() => browserContext.openSessionDock(browserSessionId)}
          />
          <ThreadActionButton
            label="Full screen"
            onClick={() => browserContext.openSessionFullscreen(browserSessionId)}
          />
        </div>
      </div>
    </section>
  );
}
