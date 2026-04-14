'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { type McpBrowserSessionSummary, api } from '@/lib/api-client';
import { type BrowserSessionContentBlock, useChatContext } from '@/lib/chat-context';
import { useBrowserSession } from '@/lib/use-browser-session';
import { ChatBrowserProvider, type ChatBrowserContextValue, type ChatBrowserView } from './chat-browser-context';
import { BrowserSessionCard } from './browser-session-card';
import { BrowserSessionSurface } from './browser-session-surface';
import { ChatPanel } from './chat-panel';
import { InputBar } from './input-bar';

function isLiveBrowserSession(session: McpBrowserSessionSummary): boolean {
  return session.status === 'active' || session.status === 'pending';
}

function sortBrowserSessions(
  sessions: McpBrowserSessionSummary[],
): McpBrowserSessionSummary[] {
  return [...sessions].sort((left, right) => {
    const rightTime = new Date(right.updatedAt).getTime();
    const leftTime = new Date(left.updatedAt).getTime();
    return rightTime - leftTime;
  });
}

function upsertBrowserSession(
  sessions: McpBrowserSessionSummary[],
  session: McpBrowserSessionSummary,
): McpBrowserSessionSummary[] {
  const next = sessions.filter((item) => item.id !== session.id);
  next.push(session);
  return sortBrowserSessions(next);
}

export function ChatWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentConversationId, messages, syncConversationState } = useChatContext();
  const [conversationSessions, setConversationSessions] = useState<McpBrowserSessionSummary[]>([]);
  const [standaloneSessions, setStandaloneSessions] = useState<McpBrowserSessionSummary[]>([]);
  const [explicitSessionSummary, setExplicitSessionSummary] =
    useState<McpBrowserSessionSummary | null>(null);
  const [browserError, setBrowserError] = useState<string | null>(null);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);

  const explicitSessionId = searchParams.get('browserSessionId');
  const browserView: ChatBrowserView = searchParams.get('browserView') === 'dock' ? 'dock' : 'mini';

  const replaceBrowserParams = useCallback(
    (sessionId: string | null, view: ChatBrowserView = 'mini') => {
      const nextParams = new URLSearchParams(searchParams.toString());
      if (sessionId) {
        nextParams.set('browserSessionId', sessionId);
        nextParams.set('browserView', view);
      } else {
        nextParams.delete('browserSessionId');
        nextParams.delete('browserView');
      }

      const nextSearch = nextParams.toString();
      router.replace(nextSearch ? `/chat?${nextSearch}` : '/chat');
    },
    [router, searchParams],
  );

  const buildChatUrl = useCallback(
    (sessionId: string, view: ChatBrowserView) => {
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.set('browserSessionId', sessionId);
      nextParams.set('browserView', view);
      const nextSearch = nextParams.toString();
      return nextSearch ? `/chat?${nextSearch}` : '/chat';
    },
    [searchParams],
  );

  const loadConversationSessions = useCallback(
    async (showLoading = true) => {
      if (!currentConversationId) {
        setConversationSessions([]);
        return;
      }

      if (showLoading) {
        setIsLoadingSessions(true);
      }

      try {
        const response = await api.mcp.listBrowserSessions({
          conversationId: currentConversationId,
          includeEnded: true,
          limit: 6,
        });
        setConversationSessions(sortBrowserSessions(response.sessions));
        setBrowserError(null);
      } catch (error) {
        setBrowserError(
          error instanceof Error ? error.message : 'Failed to load browser sessions',
        );
      } finally {
        if (showLoading) {
          setIsLoadingSessions(false);
        }
      }
    },
    [currentConversationId],
  );

  const loadExplicitSession = useCallback(
    async (showLoading = false) => {
      if (!explicitSessionId) {
        setExplicitSessionSummary(null);
        return;
      }

      if (showLoading) {
        setIsLoadingSessions(true);
      }

      try {
        const response = await api.mcp.getBrowserSession(explicitSessionId);
        setExplicitSessionSummary(response.session);
        if (!response.session.conversationId) {
          setStandaloneSessions((previous) => upsertBrowserSession(previous, response.session));
        }
        setBrowserError(null);
      } catch (error) {
        setBrowserError(
          error instanceof Error ? error.message : 'Failed to load browser session',
        );
      } finally {
        if (showLoading) {
          setIsLoadingSessions(false);
        }
      }
    },
    [explicitSessionId],
  );

  useEffect(() => {
    void loadConversationSessions();
  }, [loadConversationSessions]);

  useEffect(() => {
    void loadExplicitSession(Boolean(explicitSessionId));
  }, [explicitSessionId, loadExplicitSession]);

  useEffect(() => {
    if (!currentConversationId && !explicitSessionId) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadConversationSessions(false);
      void loadExplicitSession(false);
    }, 5000);

    return () => window.clearInterval(interval);
  }, [currentConversationId, explicitSessionId, loadConversationSessions, loadExplicitSession]);

  const activeConversationSession = useMemo(
    () => conversationSessions.find((session) => isLiveBrowserSession(session)) ?? null,
    [conversationSessions],
  );
  const activeMessageSessionId = useMemo(() => {
    for (const message of [...messages].reverse()) {
      const block = [...message.content]
        .reverse()
        .find(
          (candidate): candidate is BrowserSessionContentBlock =>
            candidate.type === 'browser_session' &&
            Boolean(candidate.browserSessionId) &&
            (candidate.status === 'active' || candidate.status === 'pending'),
        );
      if (block?.browserSessionId) {
        return block.browserSessionId;
      }
    }

    return null;
  }, [messages]);

  const activeSessionSummary = useMemo(() => {
    if (explicitSessionId) {
      if (explicitSessionSummary?.id === explicitSessionId) {
        return explicitSessionSummary;
      }

      return (
        conversationSessions.find((session) => session.id === explicitSessionId) ??
        standaloneSessions.find((session) => session.id === explicitSessionId) ??
        null
      );
    }

    return activeConversationSession;
  }, [
    activeConversationSession,
    conversationSessions,
    explicitSessionId,
    explicitSessionSummary,
    standaloneSessions,
  ]);
  const effectiveBrowserView: ChatBrowserView =
    browserView === 'mini' && activeSessionSummary?.conversationId === null ? 'dock' : browserView;

  const activeSessionId = explicitSessionId ?? activeConversationSession?.id ?? activeMessageSessionId;
  const browser = useBrowserSession({
    sessionId: activeSessionId,
    enabled: Boolean(activeSessionId),
  });
  const previousConversationSessionSignatureRef = useRef<string | null>(null);

  const rememberSession = useCallback((session: McpBrowserSessionSummary) => {
    if (session.conversationId) {
      setConversationSessions((previous) => upsertBrowserSession(previous, session));
      return;
    }

    setStandaloneSessions((previous) => upsertBrowserSession(previous, session));
  }, []);

  useEffect(() => {
    if (browser.session) {
      rememberSession(browser.session);
      if (explicitSessionId === browser.session.id) {
        setExplicitSessionSummary(browser.session);
      }
    }
  }, [browser.session, explicitSessionId, rememberSession]);

  useEffect(() => {
    const sessionForCleanup = browser.session ?? activeSessionSummary;
    if (!explicitSessionId || !sessionForCleanup || isLiveBrowserSession(sessionForCleanup)) {
      return;
    }

    replaceBrowserParams(null);
  }, [activeSessionSummary, browser.session, explicitSessionId, replaceBrowserParams]);

  useEffect(() => {
    if (!currentConversationId) {
      previousConversationSessionSignatureRef.current = null;
      return;
    }

    const signature = conversationSessions
      .map((session) => `${session.id}:${session.status}:${session.updatedAt}`)
      .join('|');

    if (previousConversationSessionSignatureRef.current === null) {
      previousConversationSessionSignatureRef.current = signature;
      return;
    }

    if (previousConversationSessionSignatureRef.current !== signature) {
      previousConversationSessionSignatureRef.current = signature;
      void syncConversationState(currentConversationId);
    }
  }, [conversationSessions, currentConversationId, syncConversationState]);

  const openSessionFullscreen = useCallback(
    (sessionId: string) => {
      const nextParams = new URLSearchParams();
      nextParams.set('returnTo', buildChatUrl(sessionId, 'dock'));
      router.push(`/chat/browser/${sessionId}?${nextParams.toString()}`);
    },
    [buildChatUrl, router],
  );

  const handleDockSave = useCallback(async () => {
    const response = await browser.persistSession(true);
    if (response?.session) {
      rememberSession(response.session);
      replaceBrowserParams(null);
    }
  }, [browser, rememberSession, replaceBrowserParams]);

  const handleDockCancel = useCallback(async () => {
    const response = await browser.cancelSession();
    if (response?.session) {
      rememberSession(response.session);
      replaceBrowserParams(null);
    }
  }, [browser, rememberSession, replaceBrowserParams]);

  const sessionCards = useMemo(() => {
    const cards = standaloneSessions.filter((session) => session.id !== activeSessionId);
    return sortBrowserSessions(cards).slice(0, 4);
  }, [activeSessionId, standaloneSessions]);

  const dockedBrowser =
    effectiveBrowserView === 'dock' &&
    activeSessionId &&
    activeSessionSummary &&
    isLiveBrowserSession(activeSessionSummary) ? (
      <section className="border-t border-border bg-surface px-4 py-4">
        <div className="flex h-[min(50vh,36rem)] min-h-[320px] min-h-0 overflow-hidden rounded-[28px] border border-border shadow-sm">
          <BrowserSessionSurface
            variant="dock"
            session={browser.session ?? activeSessionSummary}
            pages={browser.pages}
            selectedPage={browser.selectedPage}
            addressValue={browser.addressValue}
            setAddressValue={browser.setAddressValue}
            frameUrl={browser.frameUrl}
            frameSize={browser.frameSize}
            controlGranted={browser.controlGranted}
            socketState={browser.socketState}
            isTouchDevice={browser.isTouchDevice}
            error={browser.error}
            controlsDisabled={browser.controlsDisabled}
            isSaving={browser.isSaving}
            isCancelling={browser.isCancelling}
            sendBrowserEvent={browser.sendBrowserEvent}
            reconnect={browser.reconnect}
            onSave={handleDockSave}
            onCancel={handleDockCancel}
            onRequestControl={() => {
              browser.requestControl();
            }}
            onToggleDisplay={() => openSessionFullscreen(activeSessionId)}
            onClose={() => replaceBrowserParams(activeSessionId, 'mini')}
          />
        </div>
      </section>
    ) : null;

  const sessionTray =
    browserError || isLoadingSessions || sessionCards.length > 0 ? (
      <section className="border-t border-border bg-surface px-4 py-3">
        <div className="space-y-3">
          {browserError ? (
            <p className="rounded-lg bg-error/10 px-3 py-2 text-xs text-error">{browserError}</p>
          ) : null}
          {isLoadingSessions && sessionCards.length === 0 ? (
            <p className="text-xs text-foreground-muted">Loading browser sessions...</p>
          ) : null}
          {sessionCards.map((session) => (
            <BrowserSessionCard
              key={session.id}
              session={session}
              actions={[
                ...(isLiveBrowserSession(session)
                  ? [
                      {
                        label: 'Open dock',
                        onClick: () => replaceBrowserParams(session.id, 'dock'),
                        tone: 'primary' as const,
                      },
                    ]
                  : []),
                {
                  label: 'Open full screen',
                  onClick: () => openSessionFullscreen(session.id),
                },
              ]}
            />
          ))}
        </div>
      </section>
    ) : null;

  const chatBrowserContextValue = useMemo<ChatBrowserContextValue>(
    () => ({
      activeSessionId,
      activeSession: browser.session ?? activeSessionSummary,
      browserView: effectiveBrowserView,
      browser: activeSessionId ? browser : null,
      isSessionSelected: (sessionId) => Boolean(sessionId) && sessionId === activeSessionId,
      isSessionDocked: (sessionId) =>
        Boolean(sessionId) && sessionId === activeSessionId && effectiveBrowserView === 'dock',
      canRenderMiniPreview: (sessionId) =>
        Boolean(sessionId) &&
        sessionId === activeSessionId &&
        effectiveBrowserView === 'mini' &&
        Boolean(
          (browser.session && isLiveBrowserSession(browser.session)) ||
            (activeSessionSummary && isLiveBrowserSession(activeSessionSummary)),
        ),
      showSessionMini: (sessionId) => replaceBrowserParams(sessionId, 'mini'),
      openSessionDock: (sessionId) => replaceBrowserParams(sessionId, 'dock'),
      openSessionFullscreen,
      collapseToMini: (sessionId) => replaceBrowserParams(sessionId ?? activeSessionId, 'mini'),
      clearSession: () => replaceBrowserParams(null),
    }),
    [
      activeSessionId,
      activeSessionSummary,
      browser,
      effectiveBrowserView,
      openSessionFullscreen,
      replaceBrowserParams,
    ],
  );

  return (
    <ChatBrowserProvider value={chatBrowserContextValue}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface-elevated">
        <ChatPanel />
        {sessionTray}
        {dockedBrowser}
        <InputBar />
      </div>
    </ChatBrowserProvider>
  );
}
