'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { type McpBrowserSessionSummary, api } from '@/lib/api-client';
import { useChatContext } from '@/lib/chat-context';
import { BrowserSessionCard } from './browser-session-card';
import { ChatPanel } from './chat-panel';
import { InlineBrowserPane } from './inline-browser-pane';
import { InputBar } from './input-bar';

const DESKTOP_INLINE_MEDIA_QUERY = '(min-width: 1200px)';

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
  const { currentConversationId } = useChatContext();
  const [conversationSessions, setConversationSessions] = useState<McpBrowserSessionSummary[]>([]);
  const [standaloneSessions, setStandaloneSessions] = useState<McpBrowserSessionSummary[]>([]);
  const [explicitSessionSummary, setExplicitSessionSummary] =
    useState<McpBrowserSessionSummary | null>(null);
  const [dismissedAutoSessionIds, setDismissedAutoSessionIds] = useState<string[]>([]);
  const [browserError, setBrowserError] = useState<string | null>(null);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [isDesktopInline, setIsDesktopInline] = useState(false);
  const [isMobilePreviewOpen, setIsMobilePreviewOpen] = useState(false);

  const explicitSessionId = searchParams.get('browserSessionId');

  const replaceBrowserSessionParam = useCallback(
    (sessionId: string | null) => {
      const nextParams = new URLSearchParams(searchParams.toString());
      if (sessionId) {
        nextParams.set('browserSessionId', sessionId);
      } else {
        nextParams.delete('browserSessionId');
      }

      const nextSearch = nextParams.toString();
      router.replace(nextSearch ? `/chat?${nextSearch}` : '/chat');
    },
    [router, searchParams],
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
    if (typeof window === 'undefined') {
      return;
    }

    const mediaQuery = window.matchMedia(DESKTOP_INLINE_MEDIA_QUERY);
    const syncViewport = () => setIsDesktopInline(mediaQuery.matches);
    syncViewport();
    mediaQuery.addEventListener('change', syncViewport);

    return () => mediaQuery.removeEventListener('change', syncViewport);
  }, []);

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
    () =>
      conversationSessions.find(
        (session) =>
          isLiveBrowserSession(session) && !dismissedAutoSessionIds.includes(session.id),
      ) ?? null,
    [conversationSessions, dismissedAutoSessionIds],
  );

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

  const activeSessionId = explicitSessionId ?? activeConversationSession?.id ?? null;

  const rememberSession = useCallback((session: McpBrowserSessionSummary) => {
    if (session.conversationId) {
      setConversationSessions((previous) => upsertBrowserSession(previous, session));
      return;
    }

    setStandaloneSessions((previous) => upsertBrowserSession(previous, session));
  }, []);

  const handleSessionChange = useCallback(
    (session: McpBrowserSessionSummary) => {
      rememberSession(session);

      if (explicitSessionId === session.id) {
        setExplicitSessionSummary(session);
      }
    },
    [explicitSessionId, rememberSession],
  );

  const collapseActiveSession = useCallback(
    (session?: McpBrowserSessionSummary | null) => {
      const targetSession = session ?? activeSessionSummary;
      if (!targetSession) {
        setIsMobilePreviewOpen(false);
        if (explicitSessionId) {
          replaceBrowserSessionParam(null);
        }
        return;
      }

      rememberSession(targetSession);
      setIsMobilePreviewOpen(false);

      if (explicitSessionId === targetSession.id) {
        if (
          targetSession.conversationId &&
          targetSession.conversationId === currentConversationId
        ) {
          setDismissedAutoSessionIds((previous) =>
            previous.includes(targetSession.id)
              ? previous
              : [...previous, targetSession.id],
          );
        }
        replaceBrowserSessionParam(null);
        return;
      }

      setDismissedAutoSessionIds((previous) =>
        previous.includes(targetSession.id) ? previous : [...previous, targetSession.id],
      );
    },
    [
      activeSessionSummary,
      currentConversationId,
      explicitSessionId,
      rememberSession,
      replaceBrowserSessionParam,
    ],
  );

  const openSessionInline = useCallback(
    (sessionId: string) => {
      setDismissedAutoSessionIds((previous) => previous.filter((item) => item !== sessionId));
      if (!isDesktopInline) {
        setIsMobilePreviewOpen(true);
      }
      replaceBrowserSessionParam(sessionId);
    },
    [isDesktopInline, replaceBrowserSessionParam],
  );

  useEffect(() => {
    if (isDesktopInline) {
      setIsMobilePreviewOpen(false);
      return;
    }

    if (!activeSessionId) {
      setIsMobilePreviewOpen(false);
    }
  }, [activeSessionId, isDesktopInline]);

  useEffect(() => {
    if (!activeSessionSummary || isLiveBrowserSession(activeSessionSummary)) {
      return;
    }

    collapseActiveSession(activeSessionSummary);
  }, [activeSessionSummary, collapseActiveSession]);

  const sessionCards = useMemo(() => {
    const cards = [...standaloneSessions, ...conversationSessions].filter(
      (session) => session.id !== activeSessionId,
    );
    const deduped = cards.reduce<McpBrowserSessionSummary[]>((items, session) => {
      if (items.some((item) => item.id === session.id)) {
        return items.map((item) => (item.id === session.id ? session : item));
      }

      return [...items, session];
    }, []);

    return sortBrowserSessions(deduped).slice(0, 4);
  }, [activeSessionId, conversationSessions, standaloneSessions]);

  const mobileActiveCard = !isDesktopInline && activeSessionId && activeSessionSummary ? (
    <section className="border-t border-border bg-surface px-4 py-3">
      <BrowserSessionCard
        session={activeSessionSummary}
        title="Inline browser"
        description={
          isMobilePreviewOpen
            ? 'Preview is open below. Touch devices stay view-only in chat.'
            : 'Preview is collapsed. Open the preview or switch to full screen to continue.'
        }
        actions={[
          {
            label: isMobilePreviewOpen ? 'Hide preview' : 'Show preview',
            onClick: () => setIsMobilePreviewOpen((previous) => !previous),
            tone: 'primary',
          },
          {
            label: 'Open full screen',
            onClick: () => router.push(`/chat/browser/${activeSessionId}`),
          },
          {
            label: 'Close',
            onClick: () => collapseActiveSession(activeSessionSummary),
          },
        ]}
      />
      {isMobilePreviewOpen ? (
        <div className="mt-3 flex h-[360px] min-h-0 overflow-hidden rounded-2xl border border-border">
          <InlineBrowserPane
            sessionId={activeSessionId}
            className="flex min-h-0 flex-1"
            onClose={() => collapseActiveSession(activeSessionSummary)}
            onSessionChange={handleSessionChange}
          />
        </div>
      ) : null}
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
                        label: 'Open in chat',
                        onClick: () => openSessionInline(session.id),
                        tone: 'primary' as const,
                      },
                    ]
                  : []),
                {
                  label: 'Open full screen',
                  onClick: () => router.push(`/chat/browser/${session.id}`),
                },
              ]}
            />
          ))}
        </div>
      </section>
    ) : null;

  const chatColumn = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface-elevated">
      <ChatPanel />
      {mobileActiveCard}
      {sessionTray}
      <InputBar />
    </div>
  );

  if (isDesktopInline && activeSessionId) {
    return (
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(360px,48vw)] overflow-hidden">
        {chatColumn}
        <div className="flex min-h-0 min-w-0 border-l border-border bg-surface">
          <InlineBrowserPane
            sessionId={activeSessionId}
            className="flex min-h-0 flex-1"
            onClose={() => collapseActiveSession(activeSessionSummary)}
            onSessionChange={handleSessionChange}
          />
        </div>
      </div>
    );
  }

  return chatColumn;
}
