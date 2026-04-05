'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  api,
  buildBrowserWebSocketUrl,
  type BrowserPageSummary,
  type McpBrowserSessionSummary,
} from '@/lib/api-client';
import { useAuthContext } from '@/lib/auth-context';
import { reportClientError } from '@/lib/client-logging';

interface BrowserWorkspaceProps {
  sessionId: string;
}

interface FrameMeta {
  sessionId: string;
  pageId: string;
  mimeType: string;
  width: number;
  height: number;
}

function pageLabel(page: BrowserPageSummary): string {
  if (page.title.trim()) {
    return page.title;
  }
  if (page.url && page.url !== 'about:blank') {
    return page.url;
  }
  return 'New tab';
}

function sessionStatusLabel(status: McpBrowserSessionSummary['status']): string {
  switch (status) {
    case 'active':
      return 'Live';
    case 'completed':
      return 'Saved';
    case 'cancelled':
      return 'Cancelled';
    case 'expired':
      return 'Expired';
    case 'failed':
      return 'Failed';
    case 'crashed':
      return 'Crashed';
    default:
      return 'Starting';
  }
}

export function BrowserWorkspace({ sessionId }: BrowserWorkspaceProps) {
  const router = useRouter();
  const { token } = useAuthContext();
  const [session, setSession] = useState<McpBrowserSessionSummary | null>(null);
  const [pages, setPages] = useState<BrowserPageSummary[]>([]);
  const [addressValue, setAddressValue] = useState('');
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [frameSize, setFrameSize] = useState<{ width: number; height: number } | null>(null);
  const [controlGranted, setControlGranted] = useState(false);
  const [socketState, setSocketState] = useState<'connecting' | 'connected' | 'disconnected'>(
    'connecting',
  );
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const pendingFrameMetaRef = useRef<FrameMeta | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const selectedPage = pages.find((page) => page.isSelected) ?? null;

  const replaceFrameUrl = useCallback((nextUrl: string) => {
    const previous = objectUrlRef.current;
    objectUrlRef.current = nextUrl;
    setFrameUrl(nextUrl);
    if (previous) {
      URL.revokeObjectURL(previous);
    }
  }, []);

  const loadSession = useCallback(async () => {
    try {
      const response = await api.mcp.getBrowserSession(sessionId);
      setSession(response.session);
      setPages(response.pages);
      const selected = response.pages.find((page) => page.isSelected);
      setAddressValue(selected?.url ?? '');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load browser session');
    }
  }, [sessionId]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const mediaQuery = window.matchMedia('(pointer: coarse)');
    const sync = () => setIsTouchDevice(mediaQuery.matches);
    sync();
    mediaQuery.addEventListener('change', sync);

    return () => mediaQuery.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!token) {
      return;
    }

    const socket = new WebSocket(buildBrowserWebSocketUrl(token));
    socket.binaryType = 'arraybuffer';
    socketRef.current = socket;
    setSocketState('connecting');

    socket.addEventListener('open', () => {
      setSocketState('connected');
      socket.send(JSON.stringify({ type: 'browser.attach', sessionId }));
    });

    socket.addEventListener('message', (event) => {
      if (typeof event.data === 'string') {
        try {
          const parsed = JSON.parse(event.data) as
            | {
                type?: string;
                sessionId?: string;
                status?: McpBrowserSessionSummary['status'];
                pages?: BrowserPageSummary[];
                selectedPageId?: string | null;
                viewport?: { width: number; height: number } | null;
                controlGranted?: boolean;
                code?: string;
                message?: string;
              }
            | null;

          if (!parsed || typeof parsed.type !== 'string') {
            return;
          }

          switch (parsed.type) {
            case 'browser.session.attached':
              setPages(parsed.pages ?? []);
              setControlGranted(Boolean(parsed.controlGranted));
              if (parsed.viewport) {
                setFrameSize(parsed.viewport);
              }
              return;
            case 'browser.session.updated':
              setPages(parsed.pages ?? []);
              if (parsed.viewport) {
                setFrameSize(parsed.viewport);
              }
              setSession((previous) =>
                previous
                  ? {
                      ...previous,
                      status: parsed.status ?? previous.status,
                      selectedPageId: parsed.selectedPageId ?? previous.selectedPageId,
                    }
                  : previous,
              );
              return;
            case 'browser.control.state':
              setControlGranted(Boolean(parsed.controlGranted));
              return;
            case 'browser.frame.meta':
              pendingFrameMetaRef.current = parsed as FrameMeta;
              setFrameSize({
                width: (parsed as FrameMeta).width,
                height: (parsed as FrameMeta).height,
              });
              return;
            case 'browser.session.ended':
              setSession((previous) =>
                previous
                  ? {
                      ...previous,
                      status: parsed.status ?? previous.status,
                    }
                  : previous,
              );
              setSocketState('disconnected');
              return;
            case 'browser.error':
              setError(parsed.message ?? 'Browser websocket error');
              return;
            default:
              return;
          }
        } catch {
          return;
        }
      }

      const meta = pendingFrameMetaRef.current;
      if (!meta) {
        return;
      }

      const blob = new Blob([event.data], { type: meta.mimeType });
      replaceFrameUrl(URL.createObjectURL(blob));
      pendingFrameMetaRef.current = null;
    });

    socket.addEventListener('close', () => {
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
      setSocketState('disconnected');
    });

    return () => {
      socket.close();
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
    };
  }, [replaceFrameUrl, sessionId, token]);

  useEffect(() => {
    if (!selectedPage) {
      return;
    }
    setAddressValue(selectedPage.url);
  }, [selectedPage]);

  useEffect(() => {
    if (!socketRef.current || socketState !== 'connected') {
      return;
    }

    const interval = window.setInterval(() => {
      socketRef.current?.send(JSON.stringify({ type: 'browser.heartbeat', sessionId }));
    }, 5000);

    return () => window.clearInterval(interval);
  }, [sessionId, socketState]);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []);

  const sendBrowserEvent = useCallback(
    (payload: Record<string, unknown>) => {
      if (!socketRef.current || socketState !== 'connected') {
        setError('Browser session is disconnected.');
        return;
      }
      socketRef.current.send(JSON.stringify({ ...payload, sessionId }));
    },
    [sessionId, socketState],
  );

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

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      await api.mcp.persistBrowserSession(sessionId, true);
      router.push('/chat/connectors');
    } catch (saveError) {
      void reportClientError({
        event: 'client.browser.persist_failed',
        component: 'browser-workspace',
        message: 'Failed to save browser session',
        error: saveError,
      });
      setError(saveError instanceof Error ? saveError.message : 'Failed to save browser session');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = async () => {
    setIsCancelling(true);
    setError(null);
    try {
      await api.mcp.cancelBrowserSession(sessionId);
      router.push('/chat/connectors');
    } catch (cancelError) {
      setError(
        cancelError instanceof Error ? cancelError.message : 'Failed to cancel browser session',
      );
    } finally {
      setIsCancelling(false);
    }
  };

  const controlsDisabled =
    !controlGranted || socketState !== 'connected' || session?.status !== 'active' || isTouchDevice;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-elevated">
      <div className="border-b border-border bg-surface px-4 py-3">
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
            <Link
              href="/chat/connectors"
              className="rounded-lg border border-border-subtle px-3 py-2 text-xs font-medium text-foreground hover:bg-surface-hover"
            >
              Back
            </Link>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg border border-border-subtle px-3 py-2 text-xs font-medium text-foreground hover:bg-surface-hover"
            >
              Reconnect
            </button>
            <button
              type="button"
              onClick={() => void handleCancel()}
              disabled={isCancelling}
              className="rounded-lg border border-border-subtle px-3 py-2 text-xs font-medium text-foreground hover:bg-surface-hover disabled:opacity-50"
            >
              {isCancelling ? 'Cancelling...' : 'Cancel'}
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={isSaving || session?.status !== 'active'}
              className="rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {isSaving ? 'Saving...' : 'Save session'}
            </button>
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

      <div className="border-b border-border bg-surface px-4 py-3">
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
            className="flex min-w-[280px] flex-1 gap-2"
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

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[#111827] p-4">
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
              alt="Live browser frame"
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
