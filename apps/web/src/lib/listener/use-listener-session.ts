'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api-client';
import type { ListenerConcept, ListenerSession } from '@/lib/api/listener';
import { reportClientError } from '@/lib/client-logging';
import { getListenerBrowserSupport, type ListenerBrowserSupport } from './browser-support';
import { acquireListenerMedia, stopListenerMedia } from './media-source';
import { ListenerTranscriptStore } from './transcript-store';
import type {
  ListenerAudioSource,
  ListenerConnection,
  ListenerPhase,
  ListenerTranscriptSegment,
} from './types';
import { closeListenerConnection, connectListenerSession } from './webrtc-connection';

const AUTO_ANALYSIS_INTERVAL_MS = 20_000;
const AUTO_ANALYSIS_MIN_NEW_CHARS = 300;
const MAX_EXPLANATION_CONTEXT_CHARS = 12_000;

interface UseListenerSessionOptions {
  syncConversation: (conversationId: string) => Promise<void>;
}

export function useListenerSession({ syncConversation }: UseListenerSessionOptions) {
  const [phase, setPhase] = useState<ListenerPhase>('idle');
  const [source, setSourceState] = useState<ListenerAudioSource>('microphone');
  const [segments, setSegments] = useState<ListenerTranscriptSegment[]>([]);
  const [concepts, setConcepts] = useState<ListenerConcept[]>([]);
  const [autoExplain, setAutoExplainState] = useState(false);
  const [isExplaining, setIsExplaining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [support, setSupport] = useState<ListenerBrowserSupport>({
    microphone: false,
    browserTab: false,
  });
  const [session, setSession] = useState<ListenerSession | null>(null);

  const storeRef = useRef(new ListenerTranscriptStore());
  const sessionRef = useRef<ListenerSession | null>(null);
  const connectionRef = useRef<ListenerConnection | null>(null);
  const pendingMediaRef = useRef<MediaStream | null>(null);
  const persistenceTailRef = useRef<Promise<void>>(Promise.resolve());
  const autoExplainRef = useRef(false);
  const lastAutoAnalysisAtRef = useRef(0);
  const lastAutoAnalysisLengthRef = useRef(0);
  const conceptTitlesRef = useRef<string[]>([]);
  const stoppingRef = useRef(false);

  useEffect(() => {
    setSupport(getListenerBrowserSupport());
  }, []);

  const teardownMedia = useCallback(() => {
    closeListenerConnection(connectionRef.current);
    connectionRef.current = null;
    stopListenerMedia(pendingMediaRef.current);
    pendingMediaRef.current = null;
  }, []);

  const appendConcepts = useCallback((nextConcepts: ListenerConcept[]) => {
    if (nextConcepts.length === 0) {
      return;
    }
    setConcepts((previous) => {
      const existing = new Set(previous.map((concept) => concept.title.trim().toLowerCase()));
      const unique = nextConcepts.filter(
        (concept) => !existing.has(concept.title.trim().toLowerCase()),
      );
      const merged = [...previous, ...unique];
      conceptTitlesRef.current = merged.map((concept) => concept.title);
      return merged;
    });
  }, []);

  const requestExplanation = useCallback(
    async (mode: 'selection' | 'auto', context: string, selectedText?: string) => {
      const activeSession = sessionRef.current;
      const boundedContext = context.trim().slice(-MAX_EXPLANATION_CONTEXT_CHARS);
      if (!activeSession || !boundedContext || (mode === 'selection' && !selectedText?.trim())) {
        return;
      }
      setIsExplaining(true);
      try {
        const response = await api.listener.explain({
          sessionId: activeSession.sessionId,
          conversationId: activeSession.conversationId,
          mode,
          selectedText: selectedText?.trim(),
          context: boundedContext,
          excludedConcepts: conceptTitlesRef.current.slice(-50),
        });
        appendConcepts(response.concepts);
      } catch (requestError) {
        if (
          mode === 'auto' &&
          requestError instanceof ApiError &&
          requestError.code === 'LISTENER_ANALYSIS_IN_PROGRESS'
        ) {
          return;
        }
        const message =
          requestError instanceof Error
            ? requestError.message
            : 'Could not explain the selected concept.';
        setError(message);
        void reportClientError({
          event: 'client.listener.explanation_failed',
          component: 'use-listener-session',
          message,
          error: requestError,
          conversationId: activeSession.conversationId,
        });
      } finally {
        setIsExplaining(false);
      }
    },
    [appendConcepts],
  );

  const maybeAutoExplain = useCallback(
    (finalText: string) => {
      if (!autoExplainRef.current) {
        return;
      }
      const now = Date.now();
      const newChars = finalText.length - lastAutoAnalysisLengthRef.current;
      if (
        newChars < AUTO_ANALYSIS_MIN_NEW_CHARS ||
        now - lastAutoAnalysisAtRef.current < AUTO_ANALYSIS_INTERVAL_MS
      ) {
        return;
      }
      const context = finalText.slice(lastAutoAnalysisLengthRef.current);
      lastAutoAnalysisLengthRef.current = finalText.length;
      lastAutoAnalysisAtRef.current = now;
      void requestExplanation('auto', context);
    },
    [requestExplanation],
  );

  const persistCompletedSegment = useCallback(
    (completed: ListenerTranscriptSegment) => {
      persistenceTailRef.current = persistenceTailRef.current
        .then(async () => {
          const activeSession = sessionRef.current;
          if (!activeSession) {
            return;
          }
          const response = await api.listener.appendTranscript({
            sessionId: activeSession.sessionId,
            conversationId: activeSession.conversationId,
            transcriptMessageId: activeSession.transcriptMessageId,
            itemId: completed.itemId,
            text: completed.text,
          });
          const nextSession = {
            ...activeSession,
            transcriptMessageId: response.transcriptMessageId,
          };
          sessionRef.current = nextSession;
          setSession(nextSession);
        })
        .catch((persistError) => {
          const activeSession = sessionRef.current;
          const message =
            persistError instanceof Error ? persistError.message : 'Failed to save transcript.';
          setError(message);
          void reportClientError({
            event: 'client.listener.transcript_persist_failed',
            component: 'use-listener-session',
            message,
            error: persistError,
            conversationId: activeSession?.conversationId,
          });
        });
    },
    [],
  );

  const handleRealtimeEvent = useCallback(
    (event: Record<string, unknown>) => {
      const result = storeRef.current.apply(event);
      if (result.error) {
        setError(result.error);
        setPhase('error');
        return;
      }
      if (!result.changed) {
        return;
      }
      setSegments(storeRef.current.values());
      if (result.completed) {
        persistCompletedSegment(result.completed);
        maybeAutoExplain(storeRef.current.finalText());
      }
    },
    [maybeAutoExplain, persistCompletedSegment],
  );

  const stop = useCallback(async () => {
    if (stoppingRef.current) {
      return;
    }
    stoppingRef.current = true;
    teardownMedia();
    try {
      await persistenceTailRef.current;
      const activeSession = sessionRef.current;
      if (activeSession) {
        await syncConversation(activeSession.conversationId);
      }
      setPhase('idle');
    } finally {
      stoppingRef.current = false;
    }
  }, [syncConversation, teardownMedia]);

  const handleCaptureEnded = useCallback(() => {
    if (!stoppingRef.current) {
      void stop();
    }
  }, [stop]);

  const start = useCallback(async () => {
    if (phase === 'connecting' || phase === 'listening') {
      return;
    }
    if (source === 'microphone' && !support.microphone) {
      setError('Microphone capture is not supported in this browser.');
      setPhase('error');
      return;
    }
    if (source === 'browser_tab' && !support.browserTab) {
      setError('Browser tab audio is available on supported desktop browsers only.');
      setPhase('error');
      return;
    }
    setPhase('connecting');
    setError(null);
    storeRef.current.clear();
    setSegments([]);
    setConcepts([]);
    conceptTitlesRef.current = [];
    lastAutoAnalysisAtRef.current = 0;
    lastAutoAnalysisLengthRef.current = 0;
    try {
      const mediaStream = await acquireListenerMedia(source);
      pendingMediaRef.current = mediaStream;
      const created = await api.listener.createSession(source);
      sessionRef.current = created;
      setSession(created);
      await syncConversation(created.conversationId);
      const connection = await connectListenerSession({
        sessionId: created.sessionId,
        conversationId: created.conversationId,
        mediaStream,
        exchangeSdpAnswer: api.listener.exchangeSdpAnswer,
        onRealtimeEvent: handleRealtimeEvent,
        onCaptureEnded: handleCaptureEnded,
      });
      connectionRef.current = connection;
      pendingMediaRef.current = null;
      setPhase('listening');
    } catch (startError) {
      teardownMedia();
      const message =
        startError instanceof Error ? startError.message : 'Failed to start Listener Mode.';
      setError(message);
      setPhase('error');
      void reportClientError({
        event: 'client.listener.start_failed',
        component: 'use-listener-session',
        message,
        error: startError,
        conversationId: sessionRef.current?.conversationId,
      });
    }
  }, [
    handleCaptureEnded,
    handleRealtimeEvent,
    phase,
    source,
    support.browserTab,
    support.microphone,
    syncConversation,
    teardownMedia,
  ]);

  const setSource = useCallback((nextSource: ListenerAudioSource) => {
    setSourceState(nextSource);
    setError(null);
  }, []);

  const setAutoExplain = useCallback((enabled: boolean) => {
    autoExplainRef.current = enabled;
    setAutoExplainState(enabled);
    if (enabled) {
      lastAutoAnalysisAtRef.current = Date.now() - AUTO_ANALYSIS_INTERVAL_MS;
    }
  }, []);

  const explainSelection = useCallback(
    async (selectedText: string) => {
      await requestExplanation('selection', storeRef.current.finalText(), selectedText);
    },
    [requestExplanation],
  );

  const clear = useCallback(() => {
    if (phase === 'connecting' || phase === 'listening') {
      return;
    }
    storeRef.current.clear();
    setSegments([]);
    setConcepts([]);
    conceptTitlesRef.current = [];
    setError(null);
  }, [phase]);

  useEffect(
    () => () => {
      teardownMedia();
    },
    [teardownMedia],
  );

  return {
    phase,
    source,
    segments,
    concepts,
    autoExplain,
    isExplaining,
    error,
    support,
    session,
    setSource,
    setAutoExplain,
    start,
    stop,
    clear,
    explainSelection,
  };
}
