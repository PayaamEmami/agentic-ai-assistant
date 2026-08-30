'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, buildWebSocketUrl, type AutomationRunEvent } from '@/lib/api-client';
import { useAuthContext } from '@/lib/auth-context';

interface RawEvent {
  type?: unknown;
  runId?: unknown;
  seq?: unknown;
  at?: unknown;
  kind?: unknown;
  stage?: unknown;
  message?: unknown;
  status?: unknown;
}

function parseActivityEvent(data: unknown, runId: string): AutomationRunEvent | null {
  if (typeof data !== 'string') {
    return null;
  }

  let parsed: RawEvent;
  try {
    parsed = JSON.parse(data) as RawEvent;
  } catch {
    return null;
  }

  if (
    parsed.type !== 'automation.run.event' ||
    parsed.runId !== runId ||
    typeof parsed.seq !== 'number' ||
    typeof parsed.message !== 'string'
  ) {
    return null;
  }

  return {
    seq: parsed.seq,
    at: typeof parsed.at === 'string' ? parsed.at : new Date().toISOString(),
    kind: (parsed.kind as AutomationRunEvent['kind']) ?? 'progress',
    stage: typeof parsed.stage === 'string' ? parsed.stage : null,
    message: parsed.message,
  };
}

function isTerminalStatusEvent(data: unknown, runId: string): boolean {
  if (typeof data !== 'string') {
    return false;
  }

  try {
    const parsed = JSON.parse(data) as RawEvent;
    return (
      parsed.type === 'automation.run.status' &&
      parsed.runId === runId &&
      (parsed.status === 'completed' || parsed.status === 'skipped' || parsed.status === 'failed')
    );
  } catch {
    return false;
  }
}

interface UseRunActivityOptions {
  runId: string;
  conversationId: string | null;
  /** Live events are only worth a socket while the run is still going. */
  live: boolean;
  enabled: boolean;
  onRunFinished?: () => void;
}

/**
 * Loads a run's activity log and, for an in-flight run, follows it live.
 *
 * History comes from the replay endpoint first so the log is complete even if the
 * user opens a run that started before the page loaded; the socket then appends
 * anything newer. Events are keyed by `seq`, so a replayed event and its live
 * counterpart collapse into one entry.
 */
export function useRunActivity({
  runId,
  conversationId,
  live,
  enabled,
  onRunFinished,
}: UseRunActivityOptions) {
  const { token } = useAuthContext();
  const [events, setEvents] = useState<AutomationRunEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const finishedRef = useRef(onRunFinished);

  useEffect(() => {
    finishedRef.current = onRunFinished;
  }, [onRunFinished]);

  const mergeEvent = useCallback((event: AutomationRunEvent) => {
    setEvents((current) => {
      if (current.some((existing) => existing.seq === event.seq)) {
        return current;
      }
      return [...current, event].sort((a, b) => a.seq - b.seq);
    });
  }, []);

  const eventsRef = useRef<AutomationRunEvent[]>([]);
  eventsRef.current = events;

  const catchUp = useCallback(async () => {
    const afterSeq = eventsRef.current.reduce((max, event) => Math.max(max, event.seq), 0);
    try {
      const { events: next } = await api.automation.listRunEvents(runId, afterSeq);
      for (const event of next) {
        mergeEvent(event);
      }
    } catch {
      // Replay is a backstop; a failed poll should not clear the log we have.
    }
  }, [mergeEvent, runId]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;
    setLoading(true);

    void api.automation
      .listRunEvents(runId)
      .then(({ events: history }) => {
        if (!cancelled) {
          setEvents(history);
        }
      })
      .catch(() => {
        // The log is supplementary; the run row already shows the outcome.
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, runId]);

  useEffect(() => {
    if (!enabled || !live || !token || !conversationId) {
      return;
    }

    let socket: WebSocket | null = null;
    let reconnectTimeout: number | undefined;
    let pollInterval: number | undefined;
    let reconnectAttempt = 0;
    let active = true;

    const attach = (next: WebSocket) => {
      next.addEventListener('open', () => {
        reconnectAttempt = 0;
        next.send(JSON.stringify({ type: 'subscribe', conversationId }));
        void catchUp();
      });

      next.addEventListener('message', (message) => {
        const event = parseActivityEvent(message.data, runId);
        if (event) {
          mergeEvent(event);
          return;
        }

        if (isTerminalStatusEvent(message.data, runId)) {
          finishedRef.current?.();
        }
      });

      next.addEventListener('close', () => {
        if (!active) {
          return;
        }

        const delay = Math.min(15_000, 1_000 * 2 ** reconnectAttempt);
        reconnectAttempt += 1;
        reconnectTimeout = window.setTimeout(connect, delay);
      });
    };

    const connect = () => {
      if (!active) {
        return;
      }

      socket = new WebSocket(buildWebSocketUrl(token));
      attach(socket);
    };

    connect();
    pollInterval = window.setInterval(() => {
      void catchUp();
    }, 10_000);

    return () => {
      active = false;
      if (reconnectTimeout) {
        window.clearTimeout(reconnectTimeout);
      }
      if (pollInterval) {
        window.clearInterval(pollInterval);
      }
      socket?.close();
    };
  }, [catchUp, conversationId, enabled, live, mergeEvent, runId, token]);

  return { events, loading };
}
