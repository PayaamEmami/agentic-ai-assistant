'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  buildBrowserWebSocketUrl,
  type BrowserPageSummary,
  type McpBrowserSessionSummary,
} from './api-client';
import { useAuthContext } from './auth-context';

interface FrameMeta {
  sessionId: string;
  pageId: string;
  mimeType: string;
  width: number;
  height: number;
}

interface BrowserPageLike {
  id?: string;
  pageId?: string;
  url?: string;
  title?: string;
  isSelected?: boolean;
}

function normalizeBrowserPage(page: BrowserPageLike): BrowserPageSummary | null {
  const id =
    typeof page.id === 'string'
      ? page.id
      : typeof page.pageId === 'string'
        ? page.pageId
        : null;
  if (!id) {
    return null;
  }

  return {
    id,
    url: typeof page.url === 'string' ? page.url : '',
    title: typeof page.title === 'string' ? page.title : '',
    isSelected: page.isSelected === true,
  };
}

function normalizeBrowserPages(pages: BrowserPageLike[] | undefined): BrowserPageSummary[] {
  if (!Array.isArray(pages)) {
    return [];
  }

  return pages
    .map(normalizeBrowserPage)
    .filter((page): page is BrowserPageSummary => page !== null);
}

export function pageLabel(page: BrowserPageSummary): string {
  if (page.title.trim()) {
    return page.title;
  }
  if (page.url && page.url !== 'about:blank') {
    return page.url;
  }
  return 'New tab';
}

export function sessionStatusLabel(status: McpBrowserSessionSummary['status']): string {
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

interface UseBrowserSessionOptions {
  sessionId?: string | null;
  enabled?: boolean;
}

export function useBrowserSession({
  sessionId,
  enabled = true,
}: UseBrowserSessionOptions) {
  const { token } = useAuthContext();
  const [session, setSession] = useState<McpBrowserSessionSummary | null>(null);
  const [pages, setPages] = useState<BrowserPageSummary[]>([]);
  const [addressValue, setAddressValue] = useState('');
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [frameSize, setFrameSize] = useState<{ width: number; height: number } | null>(null);
  const [controlGranted, setControlGranted] = useState(false);
  const [socketState, setSocketState] = useState<'connecting' | 'connected' | 'disconnected'>(
    'disconnected',
  );
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [connectionNonce, setConnectionNonce] = useState(0);
  const [isAttached, setIsAttached] = useState(false);
  const pendingFrameMetaRef = useRef<FrameMeta | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const sessionStatus = session?.status;
  const isLiveSession =
    sessionStatus === undefined || sessionStatus === 'active' || sessionStatus === 'pending';

  const clearFrameUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setFrameUrl(null);
  }, []);

  const replaceFrameUrl = useCallback(
    (nextUrl: string) => {
      const previous = objectUrlRef.current;
      objectUrlRef.current = nextUrl;
      setFrameUrl(nextUrl);
      if (previous) {
        URL.revokeObjectURL(previous);
      }
    },
    [],
  );

  const loadSession = useCallback(async () => {
    if (!sessionId || !enabled) {
      setSession(null);
      setPages([]);
      setAddressValue('');
      clearFrameUrl();
      setFrameSize(null);
      setControlGranted(false);
      setIsAttached(false);
      setError(null);
      return null;
    }

    try {
      pendingFrameMetaRef.current = null;
      clearFrameUrl();
      setFrameSize(null);
      setControlGranted(false);
      setIsAttached(false);
      setPages([]);
      setAddressValue('');
      setSession(null);
      setError(null);
      const response = await api.mcp.getBrowserSession(sessionId);
      const normalizedPages = normalizeBrowserPages(response.pages);
      setSession(response.session);
      setPages(normalizedPages);
      const selected = normalizedPages.find((page) => page.isSelected);
      setAddressValue(selected?.url ?? '');
      setError(null);
      return response.session;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load browser session');
      return null;
    }
  }, [clearFrameUrl, enabled, sessionId]);

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
    if (!enabled || !sessionId || !token) {
      socketRef.current?.close();
      socketRef.current = null;
      setSocketState('disconnected');
      setIsAttached(false);
      return;
    }

    if (!isLiveSession) {
      socketRef.current?.close();
      socketRef.current = null;
      setSocketState('disconnected');
      setIsAttached(false);
      return;
    }

    const socket = new WebSocket(buildBrowserWebSocketUrl(token));
    socket.binaryType = 'arraybuffer';
    socketRef.current = socket;
    setSocketState('connecting');

    socket.addEventListener('open', () => {
      if (socketRef.current !== socket) {
        socket.close();
        return;
      }
      setSocketState('connected');
      setIsAttached(false);
      socket.send(JSON.stringify({ type: 'browser.attach', sessionId }));
    });

    socket.addEventListener('message', (event) => {
      if (socketRef.current !== socket) {
        return;
      }
      if (typeof event.data === 'string') {
        try {
          const parsed = JSON.parse(event.data) as
            | {
                type?: string;
                sessionId?: string;
                status?: McpBrowserSessionSummary['status'];
                pages?: BrowserPageLike[];
                selectedPageId?: string | null;
                viewport?: { width: number; height: number } | null;
                controlGranted?: boolean;
                message?: string;
                code?: string;
              }
            | null;

          if (!parsed || typeof parsed.type !== 'string') {
            return;
          }

          switch (parsed.type) {
            case 'browser.session.attached': {
              const normalizedPages = normalizeBrowserPages(parsed.pages);
              setPages(normalizedPages);
              setIsAttached(true);
              setControlGranted(Boolean(parsed.controlGranted));
              if (parsed.viewport) {
                setFrameSize(parsed.viewport);
              }
              setSession((previous) =>
                previous
                  ? {
                      ...previous,
                      status: parsed.status ?? previous.status,
                      selectedPageId:
                        typeof parsed.selectedPageId === 'string' || parsed.selectedPageId === null
                          ? parsed.selectedPageId
                          : previous.selectedPageId,
                    }
                  : previous,
              );
              setError(null);
              return;
            }
            case 'browser.session.updated': {
              const normalizedPages = normalizeBrowserPages(parsed.pages);
              setPages(normalizedPages);
              if (parsed.viewport) {
                setFrameSize(parsed.viewport);
              }
              setSession((previous) =>
                previous
                  ? {
                      ...previous,
                      status: parsed.status ?? previous.status,
                      selectedPageId:
                        typeof parsed.selectedPageId === 'string' || parsed.selectedPageId === null
                          ? parsed.selectedPageId
                          : previous.selectedPageId,
                    }
                  : previous,
              );
              return;
            }
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
              setIsAttached(false);
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
      if (socketRef.current !== socket) {
        return;
      }
      socketRef.current = null;
      setSocketState('disconnected');
      setIsAttached(false);
    });

    return () => {
      socket.close();
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
      setIsAttached(false);
    };
  }, [connectionNonce, enabled, isLiveSession, replaceFrameUrl, sessionId, token]);

  useEffect(() => {
    const selectedPage = pages.find((page) => page.isSelected);
    if (!selectedPage) {
      return;
    }
    setAddressValue(selectedPage.url);
  }, [pages]);

  useEffect(() => {
    if (!sessionId || !socketRef.current || socketState !== 'connected' || !isAttached) {
      return;
    }

    const interval = window.setInterval(() => {
      socketRef.current?.send(JSON.stringify({ type: 'browser.heartbeat', sessionId }));
    }, 5000);

    return () => window.clearInterval(interval);
  }, [isAttached, sessionId, socketState]);

  useEffect(() => {
    return () => {
      clearFrameUrl();
    };
  }, [clearFrameUrl]);

  const sendBrowserEvent = useCallback(
    (payload: Record<string, unknown>) => {
      if (!sessionId) {
        setError('Browser session is unavailable.');
        return false;
      }
      if (!socketRef.current || socketState !== 'connected' || !isAttached) {
        setError('Browser session is disconnected.');
        return false;
      }

      socketRef.current.send(JSON.stringify({ ...payload, sessionId }));
      return true;
    },
    [isAttached, sessionId, socketState],
  );

  const reconnect = useCallback(() => {
    setError(null);
    setIsAttached(false);
    clearFrameUrl();
    setConnectionNonce((previous) => previous + 1);
    void loadSession();
  }, [clearFrameUrl, loadSession]);

  const persistSession = useCallback(
    async (persistAsDefault = true) => {
      if (!sessionId) {
        return null;
      }

      setIsSaving(true);
      setError(null);
      try {
        const response = await api.mcp.persistBrowserSession(sessionId, persistAsDefault);
        setSession(response.session);
        setPages(normalizeBrowserPages(response.pages));
        socketRef.current?.close();
        return response;
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : 'Failed to save browser session');
        return null;
      } finally {
        setIsSaving(false);
      }
    },
    [sessionId],
  );

  const cancelSession = useCallback(async () => {
    if (!sessionId) {
      return null;
    }

    setIsCancelling(true);
    setError(null);
    try {
      const response = await api.mcp.cancelBrowserSession(sessionId);
      setSession(response.session);
      socketRef.current?.close();
      return response;
    } catch (cancelError) {
      setError(
        cancelError instanceof Error ? cancelError.message : 'Failed to cancel browser session',
      );
      return null;
    } finally {
      setIsCancelling(false);
    }
  }, [sessionId]);

  const selectedPage = useMemo(
    () => pages.find((page) => page.isSelected) ?? null,
    [pages],
  );
  const controlsDisabled =
    !isAttached ||
    !controlGranted ||
    socketState !== 'connected' ||
    session?.status !== 'active' ||
    isTouchDevice;

  return {
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
    setError,
    isSaving,
    isCancelling,
    controlsDisabled,
    loadSession,
    reconnect,
    persistSession,
    cancelSession,
    sendBrowserEvent,
  };
}
