'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { BrowserPageSummary, McpBrowserSessionSummary } from '@/lib/api-client';
import { pageLabel, sessionStatusLabel } from '@/lib/use-browser-session';

interface BrowserSessionSurfaceProps {
  variant: 'fullscreen' | 'inline';
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
  onClose?: () => void;
  onOpenFullscreen?: () => void;
  closeLabel?: string;
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
  onClose,
  onOpenFullscreen,
  closeLabel,
}: BrowserSessionSurfaceProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);

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
  }, [sendBrowserEvent, session, socketState]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-elevated">
      <div className={`border-b border-border bg-surface ${variant === 'inline' ? 'px-3 py-3' : 'px-4 py-3'}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-accent">
              Embedded Browser
            </p>
            <p className="mt-1 text-sm text-foreground-muted">
              {session ? `${sessionStatusLabel(session.status)} session for ${session.purpose}` : 'Loading session...'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {onClose ? (
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-border-subtle px-3 py-2 text-xs font-medium text-foreground hover:bg-surface-hover"
              >
                {closeLabel ?? (variant === 'inline' ? 'Close' : 'Back')}
              </button>
            ) : null}
            {onOpenFullscreen ? (
              <button
                type="button"
                onClick={onOpenFullscreen}
                className="rounded-lg border border-border-subtle px-3 py-2 text-xs font-medium text-foreground hover:bg-surface-hover"
              >
                Open full screen
              </button>
            ) : null}
            <button
              type="button"
              onClick={reconnect}
              className="rounded-lg border border-border-subtle px-3 py-2 text-xs font-medium text-foreground hover:bg-surface-hover"
            >
              Reconnect
            </button>
            {onCancel ? (
              <button
                type="button"
                onClick={() => void onCancel()}
                disabled={isCancelling}
                className="rounded-lg border border-border-subtle px-3 py-2 text-xs font-medium text-foreground hover:bg-surface-hover disabled:opacity-50"
              >
                {isCancelling ? 'Cancelling...' : 'Cancel'}
              </button>
            ) : null}
            {onSave ? (
              <button
                type="button"
                onClick={() => void onSave()}
                disabled={isSaving || session?.status !== 'active'}
                className="rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {isSaving ? 'Saving...' : 'Save session'}
              </button>
            ) : null}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-foreground-muted">
          <span>Socket: {socketState}</span>
          <span>{controlGranted ? 'Control enabled' : 'View only'}</span>
          {isTouchDevice ? <span>Touch devices are view-only in MVP.</span> : null}
        </div>
        {error ? (
          <p className="mt-3 rounded-lg bg-error/10 px-3 py-2 text-xs text-error">{error}</p>
        ) : null}
      </div>

      <div className={`border-b border-border bg-surface ${variant === 'inline' ? 'px-3 py-3' : 'px-4 py-3'}`}>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {pages.length === 0 ? (
            <p className="text-xs text-foreground-muted">Waiting for browser pages...</p>
          ) : (
            pages.map((page) => (
              <button
                key={page.id}
                type="button"
                onClick={() => sendBrowserEvent({ type: 'browser.page.select', pageId: page.id })}
                className={`min-w-0 rounded-lg border px-3 py-2 text-left text-xs ${
                  page.isSelected
                    ? 'border-accent bg-accent/10 text-foreground'
                    : 'border-border-subtle text-foreground-muted hover:bg-surface-hover'
                }`}
              >
                <span className="block truncate">{pageLabel(page)}</span>
              </button>
            ))
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => sendBrowserEvent({ type: 'browser.history', action: 'back' })}
            disabled={controlsDisabled}
            className="rounded-lg border border-border-subtle px-3 py-2 text-xs font-medium text-foreground hover:bg-surface-hover disabled:opacity-50"
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => sendBrowserEvent({ type: 'browser.history', action: 'forward' })}
            disabled={controlsDisabled}
            className="rounded-lg border border-border-subtle px-3 py-2 text-xs font-medium text-foreground hover:bg-surface-hover disabled:opacity-50"
          >
            Forward
          </button>
          <button
            type="button"
            onClick={() => sendBrowserEvent({ type: 'browser.history', action: 'reload' })}
            disabled={controlsDisabled}
            className="rounded-lg border border-border-subtle px-3 py-2 text-xs font-medium text-foreground hover:bg-surface-hover disabled:opacity-50"
          >
            Reload
          </button>
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
              className="min-w-0 flex-1 rounded-lg border border-border-subtle bg-surface-elevated px-3 py-2 text-xs text-foreground outline-none ring-0"
              placeholder="Enter a URL"
            />
            <button
              type="submit"
              disabled={controlsDisabled || addressValue.trim().length === 0}
              className="rounded-lg bg-surface-input px-3 py-2 text-xs font-medium text-foreground ring-1 ring-border-subtle hover:bg-surface-hover disabled:opacity-50"
            >
              Go
            </button>
          </form>
        </div>
      </div>

      <div className={`flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[#111827] ${variant === 'inline' ? 'p-3' : 'p-4'}`}>
        <div
          ref={viewportRef}
          tabIndex={controlsDisabled ? -1 : 0}
          className="relative w-full max-w-6xl overflow-hidden rounded-2xl border border-black/40 bg-black shadow-[0_20px_80px_rgba(0,0,0,0.45)] outline-none"
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
