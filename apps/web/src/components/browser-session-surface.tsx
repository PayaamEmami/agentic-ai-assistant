'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { BrowserPageSummary, McpBrowserSessionSummary } from '@/lib/api-client';
import { pageLabel } from '@/lib/use-browser-session';

interface BrowserSessionSurfaceProps {
  variant: 'dock' | 'fullscreen';
  session: McpBrowserSessionSummary | null;
  pages: BrowserPageSummary[];
  selectedPage: BrowserPageSummary | null;
  addressValue: string;
  setAddressValue: (value: string) => void;
  frameUrl: string | null;
  frameSize: { width: number; height: number } | null;
  controlGranted: boolean;
  socketState: 'connecting' | 'connected' | 'disconnected';
  isTouchDevice: boolean;
  error: string | null;
  controlsDisabled: boolean;
  isSaving: boolean;
  isCancelling: boolean;
  sendBrowserEvent: (payload: Record<string, unknown>) => boolean;
  reconnect: () => void;
  onSave?: () => Promise<void>;
  onCancel?: () => Promise<void>;
  onRequestControl?: () => void;
  onClose?: () => void;
  onToggleDisplay?: () => void;
  toggleDisplayLabel?: string;
  closeLabel?: string;
}

interface IconButtonProps {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}

function IconButton({ label, onClick, children, disabled = false }: IconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border-subtle bg-surface text-foreground hover:bg-surface-hover disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function sessionTitle(session: McpBrowserSessionSummary | null): string {
  if (!session) {
    return 'Opening browser...';
  }

  switch (session.purpose) {
    case 'sign_in':
      return 'Sign-in session';
    case 'handoff':
      return 'Browser handoff';
    default:
      return 'Browser session';
  }
}

function ExpandIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-4 w-4">
      <path d="M7 3H3v4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 3h4v4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17 13v4h-4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 13v4h4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CollapseIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-4 w-4">
      <path d="M8 3H3v5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 3h5v5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17 12v5h-5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 12v5h5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 7L3 3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 7l4-4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 13l4 4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 13l-4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-4 w-4">
      <path d="M5 5l10 10" strokeLinecap="round" />
      <path d="M15 5L5 15" strokeLinecap="round" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-4 w-4">
      <path d="M16 10a6 6 0 10-1.2 3.6" strokeLinecap="round" />
      <path d="M13.5 4H17v3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ReconnectIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-4 w-4">
      <path d="M6.5 6.5a4.5 4.5 0 016.4 0l.6.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.5 13.5a4.5 4.5 0 01-6.4 0l-.6-.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 4.5h3v3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 15.5H6v-3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-4 w-4">
      <path d="M11.5 4.5L6 10l5.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ForwardIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-4 w-4">
      <path d="M8.5 4.5L14 10l-5.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GoIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-4 w-4">
      <path d="M4 10h10" strokeLinecap="round" />
      <path d="M10.5 6.5L14 10l-3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BrowserSessionSurface({
  variant,
  session,
  pages,
  selectedPage,
  addressValue,
  setAddressValue,
  frameUrl,
  frameSize,
  controlGranted,
  socketState,
  isTouchDevice,
  error,
  controlsDisabled,
  isSaving,
  isCancelling,
  sendBrowserEvent,
  reconnect,
  onSave,
  onCancel,
  onRequestControl,
  onClose,
  onToggleDisplay,
  toggleDisplayLabel,
  closeLabel,
}: BrowserSessionSurfaceProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const browserStatusMessage =
    socketState === 'connecting'
      ? 'Connecting to the live browser...'
      : socketState === 'disconnected'
        ? 'Browser connection lost. Reconnect to continue.'
        : !controlGranted
          ? isTouchDevice
            ? 'Touch devices stay view-only in chat.'
            : 'Waiting for browser control...'
          : null;

  const mapPointer = useCallback(
    (clientX: number, clientY: number) => {
      if (!viewportRef.current || !frameSize) {
        return null;
      }

      const rect = viewportRef.current.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return null;
      }

      const x = ((clientX - rect.left) / rect.width) * frameSize.width;
      const y = ((clientY - rect.top) / rect.height) * frameSize.height;
      return {
        x: Math.max(0, Math.min(frameSize.width, Math.round(x))),
        y: Math.max(0, Math.min(frameSize.height, Math.round(y))),
      };
    },
    [frameSize],
  );

  useEffect(() => {
    if (
      !viewportRef.current ||
      socketState !== 'connected' ||
      !controlGranted ||
      !session ||
      (session.status !== 'active' && session.status !== 'pending')
    ) {
      return;
    }

    const viewport = viewportRef.current;
    let previousWidth = 0;
    let previousHeight = 0;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }

      const nextWidth = Math.max(1, Math.round(entry.contentRect.width));
      const nextHeight = Math.max(1, Math.round(entry.contentRect.height));
      if (nextWidth === previousWidth && nextHeight === previousHeight) {
        return;
      }

      previousWidth = nextWidth;
      previousHeight = nextHeight;
      sendBrowserEvent({
        type: 'browser.resize',
        width: nextWidth,
        height: nextHeight,
      });
    });

    observer.observe(viewport);
    return () => observer.disconnect();
  }, [controlGranted, sendBrowserEvent, session, socketState]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-elevated">
      <div
        className={`border-b border-border bg-surface ${variant === 'dock' ? 'px-5 py-4' : 'px-6 py-4'}`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{sessionTitle(session)}</p>
            {browserStatusMessage ? (
              <p className="mt-1 text-xs text-foreground-muted">{browserStatusMessage}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {onCancel ? (
              <button
                type="button"
                onClick={() => void onCancel()}
                disabled={isCancelling}
                className="rounded-xl border border-border-subtle px-3 py-2 text-xs font-medium text-foreground hover:bg-surface-hover disabled:opacity-50"
              >
                {isCancelling ? 'Cancelling...' : 'Cancel'}
              </button>
            ) : null}
            {onSave ? (
              <button
                type="button"
                onClick={() => void onSave()}
                disabled={isSaving || session?.status !== 'active'}
                className="rounded-xl bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {isSaving ? 'Saving...' : 'Save session'}
              </button>
            ) : null}
            {onRequestControl &&
            session?.status === 'active' &&
            socketState === 'connected' &&
            !controlGranted &&
            !isTouchDevice ? (
              <button
                type="button"
                onClick={onRequestControl}
                className="rounded-xl border border-border-subtle px-3 py-2 text-xs font-medium text-foreground hover:bg-surface-hover"
              >
                Take over
              </button>
            ) : null}
            <IconButton label="Reconnect browser" onClick={reconnect}>
              <ReconnectIcon />
            </IconButton>
            {onToggleDisplay ? (
              <IconButton
                label={
                  toggleDisplayLabel ??
                  (variant === 'dock' ? 'Open full screen' : 'Return to chat dock')
                }
                onClick={onToggleDisplay}
              >
                {variant === 'dock' ? <ExpandIcon /> : <CollapseIcon />}
              </IconButton>
            ) : null}
            {onClose ? (
              <IconButton
                label={closeLabel ?? (variant === 'dock' ? 'Collapse to mini' : 'Close browser')}
                onClick={onClose}
              >
                <CloseIcon />
              </IconButton>
            ) : null}
          </div>
        </div>
        {error ? (
          <p className="mt-3 rounded-lg bg-error/10 px-3 py-2 text-xs text-error">{error}</p>
        ) : null}
      </div>

      <div
        className={`border-b border-border bg-surface ${variant === 'dock' ? 'px-5 py-4' : 'px-6 py-4'}`}
      >
        {pages.length > 1 ? (
          <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
            {pages.map((page) => (
              <button
                key={page.id}
                type="button"
                onClick={() => sendBrowserEvent({ type: 'browser.page.select', pageId: page.id })}
                className={`min-w-0 rounded-xl border px-3 py-2 text-left text-xs ${
                  page.isSelected
                    ? 'border-accent bg-accent/10 text-foreground'
                    : 'border-border-subtle text-foreground-muted hover:bg-surface-hover'
                }`}
              >
                <span className="block truncate">{pageLabel(page)}</span>
              </button>
            ))}
          </div>
        ) : null}
        {pages.length === 0 ? (
          <p className="mb-3 text-xs text-foreground-muted">Waiting for browser pages...</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <IconButton
            label="Go back"
            onClick={() => sendBrowserEvent({ type: 'browser.history', action: 'back' })}
            disabled={controlsDisabled}
          >
            <BackIcon />
          </IconButton>
          <IconButton
            label="Go forward"
            onClick={() => sendBrowserEvent({ type: 'browser.history', action: 'forward' })}
            disabled={controlsDisabled}
          >
            <ForwardIcon />
          </IconButton>
          <IconButton
            label="Reload page"
            onClick={() => sendBrowserEvent({ type: 'browser.history', action: 'reload' })}
            disabled={controlsDisabled}
          >
            <RefreshIcon />
          </IconButton>
          <form
            className="flex min-w-[240px] flex-1 gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              sendBrowserEvent({ type: 'browser.navigate', url: addressValue });
            }}
          >
            <input
              value={addressValue}
              onChange={(event) => setAddressValue(event.target.value)}
              className="min-w-0 flex-1 rounded-xl border border-border-subtle bg-surface-elevated px-4 py-2.5 text-sm text-foreground outline-none ring-0"
              placeholder="Search or enter URL"
            />
            <button
              type="submit"
              disabled={controlsDisabled || addressValue.trim().length === 0}
              aria-label="Go to URL"
              title="Go to URL"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-surface-input text-foreground ring-1 ring-border-subtle hover:bg-surface-hover disabled:opacity-50"
            >
              <GoIcon />
            </button>
          </form>
        </div>
      </div>

      <div
        className={`flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[#111827] ${
          variant === 'dock' ? 'p-5 lg:p-6' : 'p-6'
        }`}
      >
        <div
          ref={viewportRef}
          tabIndex={controlsDisabled ? -1 : 0}
          className="relative w-full max-w-[1280px] overflow-hidden rounded-[28px] border border-black/40 bg-black shadow-[0_20px_80px_rgba(0,0,0,0.45)] outline-none"
          onMouseMove={(event) => {
            const point = mapPointer(event.clientX, event.clientY);
            if (!point || controlsDisabled) {
              return;
            }
            sendBrowserEvent({ type: 'browser.pointer', action: 'move', ...point });
          }}
          onMouseDown={(event) => {
            const point = mapPointer(event.clientX, event.clientY);
            if (!point || controlsDisabled) {
              return;
            }
            sendBrowserEvent({
              type: 'browser.pointer',
              action: 'down',
              ...point,
              button: event.button === 2 ? 'right' : event.button === 1 ? 'middle' : 'left',
            });
          }}
          onMouseUp={(event) => {
            const point = mapPointer(event.clientX, event.clientY);
            if (!point || controlsDisabled) {
              return;
            }
            sendBrowserEvent({
              type: 'browser.pointer',
              action: 'up',
              ...point,
              button: event.button === 2 ? 'right' : event.button === 1 ? 'middle' : 'left',
            });
          }}
          onWheel={(event) => {
            const point = mapPointer(event.clientX, event.clientY);
            if (!point || controlsDisabled) {
              return;
            }
            event.preventDefault();
            sendBrowserEvent({
              type: 'browser.wheel',
              ...point,
              deltaX: event.deltaX,
              deltaY: event.deltaY,
            });
          }}
          onKeyDown={(event) => {
            if (controlsDisabled) {
              return;
            }
            if (event.key.length === 1) {
              sendBrowserEvent({ type: 'browser.keyboard', action: 'press', key: event.key });
              event.preventDefault();
              return;
            }
            sendBrowserEvent({ type: 'browser.keyboard', action: 'down', key: event.key });
            event.preventDefault();
          }}
          onKeyUp={(event) => {
            if (controlsDisabled || event.key.length === 1) {
              return;
            }
            sendBrowserEvent({ type: 'browser.keyboard', action: 'up', key: event.key });
            event.preventDefault();
          }}
          onContextMenu={(event) => event.preventDefault()}
        >
          {frameUrl ? (
            <img
              src={frameUrl}
              alt={`Live browser frame${selectedPage?.title ? ` for ${selectedPage.title}` : ''}`}
              className="block h-auto w-full"
              draggable={false}
            />
          ) : (
            <div className="flex aspect-[16/10] items-center justify-center px-6 text-center text-sm text-white/70">
              Waiting for the live browser stream...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
