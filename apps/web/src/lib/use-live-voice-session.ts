'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from './api-client';
import type { ToolEventListener, ToolEventPayload } from './chat-tool-events';
import { reportClientError } from './client-logging';
import {
  chooseAssistantCaptionSource,
  type AssistantCaptionSource,
} from './voice/assistant-caption';
import type { SessionInit, VoicePendingToolCall, VoicePhase } from './voice/types';
import { getBrowserVoiceSupport } from './voice/utils';
import { useVoiceMeter } from './voice/use-voice-meter';
import { connectWebRtcVoiceSession } from './voice/webrtc-voice-connection';
import { VoiceToolRegistry } from './voice/voice-tool-registry';

interface UseLiveVoiceSessionOptions {
  startSession: () => Promise<SessionInit>;
  upsertVoiceMessage: (
    conversationId: string,
    messageId: string,
    role: 'user' | 'assistant',
    text: string,
  ) => void;
  syncConversation: (conversationId: string) => Promise<void>;
  subscribeToolEvents?: (listener: ToolEventListener) => () => void;
}

export function useLiveVoiceSession({
  startSession,
  upsertVoiceMessage,
  syncConversation,
  subscribeToolEvents,
}: UseLiveVoiceSessionOptions) {
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [connectionLabel, setConnectionLabel] = useState('Voice mode is off.');
  const [userCaption, setUserCaption] = useState('');
  const [assistantCaption, setAssistantCaption] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pendingToolCalls, setPendingToolCalls] = useState<VoicePendingToolCall[]>([]);
  const { voiceLevels, voiceVolume, startVoiceMeter, stopVoiceMeter } = useVoiceMeter();

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const activeUserMessageIdRef = useRef<string | null>(null);
  const activeAssistantMessageIdRef = useRef<string | null>(null);
  const pendingUserTranscriptRef = useRef('');
  const pendingAssistantTranscriptRef = useRef('');
  const responseDoneRef = useRef(false);
  const isPersistingTurnRef = useRef(false);
  const phaseRef = useRef<VoicePhase>('idle');
  const userMessageAddedRef = useRef(false);
  const assistantMessageAddedRef = useRef(false);
  const assistantCaptionSourceRef = useRef<AssistantCaptionSource | null>(null);
  const activeVoiceTurnIdRef = useRef<string | null>(null);
  const pendingTurnStartPromiseRef = useRef<Promise<string | null> | null>(null);
  const toolRegistryRef = useRef(new VoiceToolRegistry());

  const setVoicePhase = (nextPhase: VoicePhase) => {
    phaseRef.current = nextPhase;
    setPhase(nextPhase);
  };

  const resetPendingTurn = () => {
    pendingUserTranscriptRef.current = '';
    pendingAssistantTranscriptRef.current = '';
    responseDoneRef.current = false;
    userMessageAddedRef.current = false;
    assistantMessageAddedRef.current = false;
    assistantCaptionSourceRef.current = null;
    activeVoiceTurnIdRef.current = null;
    activeUserMessageIdRef.current = null;
    activeAssistantMessageIdRef.current = null;
    pendingTurnStartPromiseRef.current = null;
  };

  const resetToolCalls = () => {
    toolRegistryRef.current.clear();
    setPendingToolCalls([]);
  };

  const syncPendingToolCallsState = () => {
    setPendingToolCalls(toolRegistryRef.current.values());
  };

  const registerToolCall = (call: VoicePendingToolCall) => {
    toolRegistryRef.current.register(call);
    syncPendingToolCallsState();
  };

  const updateToolCallStatus = (
    toolExecutionId: string,
    status: VoicePendingToolCall['status'],
  ) => {
    if (toolRegistryRef.current.updateStatus(toolExecutionId, status)) {
      syncPendingToolCallsState();
    }
  };

  const removeToolCallByExecutionId = (toolExecutionId: string): VoicePendingToolCall | null => {
    const removed = toolRegistryRef.current.removeByExecutionId(toolExecutionId);
    if (removed) {
      syncPendingToolCallsState();
    }
    return removed;
  };

  const withRetry = async <T>(label: string, fn: () => Promise<T>, maxAttempts = 3): Promise<T> => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await fn();
      } catch (retryError) {
        lastError = retryError;
        if (attempt === maxAttempts) {
          break;
        }
        const delay = 200 * 2 ** (attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    void reportClientError({
      event: 'client.voice.persist_retry_exhausted',
      component: 'use-live-voice-session',
      message: `Voice turn ${label} failed after ${maxAttempts} attempts`,
      error: lastError,
      conversationId: conversationIdRef.current ?? undefined,
      voiceSessionId: sessionIdRef.current ?? undefined,
    });
    throw lastError instanceof Error
      ? lastError
      : new Error(typeof lastError === 'string' ? lastError : 'Voice request failed');
  };

  const addVoiceMessageToChat = (
    role: 'user' | 'assistant',
    text: string,
  ) => {
    const conversationId = conversationIdRef.current;
    const messageId = role === 'user' ? activeUserMessageIdRef.current : activeAssistantMessageIdRef.current;
    if (!conversationId || !messageId) {
      return;
    }

    upsertVoiceMessage(conversationId, messageId, role, text);
  };

  const ensureTurnStarted = async (userTranscript: string): Promise<string | null> => {
    if (activeVoiceTurnIdRef.current) {
      return activeVoiceTurnIdRef.current;
    }

    if (pendingTurnStartPromiseRef.current) {
      return pendingTurnStartPromiseRef.current;
    }

    const conversationId = conversationIdRef.current ?? undefined;
    const startPromise = (async () => {
      try {
        const result = await withRetry('start', () =>
          api.voice.startTurn(conversationId, userTranscript),
        );
        activeVoiceTurnIdRef.current = result.voiceTurnId;
        activeUserMessageIdRef.current = result.userMessageId;
        activeAssistantMessageIdRef.current = result.assistantMessageId;
        conversationIdRef.current = result.conversationId;
        return result.voiceTurnId;
      } catch (startError) {
        setError(
          startError instanceof Error ? startError.message : 'Failed to start the live voice turn.',
        );
        return null;
      } finally {
        pendingTurnStartPromiseRef.current = null;
      }
    })();

    pendingTurnStartPromiseRef.current = startPromise;
    return startPromise;
  };

  const finalizeUserTranscript = async (transcript: string) => {
    const trimmed = transcript.trim();
    if (!trimmed) {
      return;
    }

    pendingUserTranscriptRef.current = trimmed;
    setUserCaption(trimmed);

    const voiceTurnId = await ensureTurnStarted(trimmed);
    if (!voiceTurnId) {
      return;
    }

    if (!userMessageAddedRef.current) {
      addVoiceMessageToChat('user', trimmed);
      userMessageAddedRef.current = true;
    }

    try {
      const prepared = await api.voice.prepareTurn(voiceTurnId, trimmed);
      sendRealtimeEvent({
        type: 'session.update',
        session: {
          type: 'realtime',
          instructions: prepared.instructions,
        },
      });
      sendRealtimeEvent({ type: 'response.create' });
    } catch (prepareError) {
      void reportClientError({
        event: 'client.voice.prepare_failed',
        component: 'use-live-voice-session',
        message: 'Failed to prepare voice turn context; proceeding without retrieval',
        error: prepareError,
        conversationId: conversationIdRef.current ?? undefined,
        voiceSessionId: sessionIdRef.current ?? undefined,
      });
      sendRealtimeEvent({ type: 'response.create' });
    }
  };

  const selectAssistantCaptionSource = (source: AssistantCaptionSource) => {
    const decision = chooseAssistantCaptionSource(assistantCaptionSourceRef.current, source);
    assistantCaptionSourceRef.current = decision.source;

    if (decision.resetTranscript) {
      pendingAssistantTranscriptRef.current = '';
      setAssistantCaption('');
    }

    return decision.accepted;
  };

  const updateAssistantCaption = (
    source: AssistantCaptionSource,
    value: string,
    mode: 'append' | 'replace',
  ) => {
    const normalized = value.trim();
    if (!normalized && mode === 'replace') {
      return;
    }

    if (!selectAssistantCaptionSource(source)) {
      return;
    }

    setVoicePhase('speaking');
    setConnectionLabel('Assistant is speaking...');
    if (mode === 'append') {
      pendingAssistantTranscriptRef.current += value;
      setAssistantCaption((previous) => previous + value);
      addVoiceMessageToChat('assistant', pendingAssistantTranscriptRef.current);
      return;
    }

    pendingAssistantTranscriptRef.current = normalized;
    setAssistantCaption(normalized);
    addVoiceMessageToChat('assistant', normalized);
  };

  const maybePersistTurn = async () => {
    if (isPersistingTurnRef.current) {
      return;
    }

    if (toolRegistryRef.current.hasPendingCalls()) {
      return;
    }

    const conversationId = conversationIdRef.current;
    const userTranscript = pendingUserTranscriptRef.current.trim();
    const assistantTranscript = pendingAssistantTranscriptRef.current.trim();

    if (!conversationId || !userTranscript || !assistantTranscript || !responseDoneRef.current) {
      return;
    }

    isPersistingTurnRef.current = true;
    try {
      const voiceTurnId = await ensureTurnStarted(userTranscript);
      if (!voiceTurnId) {
        return;
      }

      await withRetry('assistant-text', () =>
        api.voice.updateAssistantText(voiceTurnId, assistantTranscript),
      );
      await withRetry('complete', () => api.voice.completeTurn(voiceTurnId, assistantTranscript));
      await syncConversation(conversationId);
      setUserCaption('');
      setAssistantCaption('');
      resetPendingTurn();
    } catch (persistError) {
      void reportClientError({
        event: 'client.voice.persist_failed',
        component: 'use-live-voice-session',
        message: 'Failed to save the live voice turn',
        error: persistError,
        conversationId,
        voiceSessionId: sessionIdRef.current ?? undefined,
      });
      setError(
        persistError instanceof Error
          ? persistError.message
          : 'Failed to save the live voice turn.',
      );
    } finally {
      isPersistingTurnRef.current = false;
    }
  };

  const sendRealtimeEvent = useCallback((event: Record<string, unknown>) => {
    const channel = dataChannelRef.current;
    if (!channel || channel.readyState !== 'open') {
      return;
    }

    channel.send(JSON.stringify(event));
  }, []);

  const forwardToolResultToRealtime = (callId: string, output: unknown) => {
    sendRealtimeEvent({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: typeof output === 'string' ? output : JSON.stringify(output ?? null),
      },
    });
    sendRealtimeEvent({ type: 'response.create' });
  };

  const handleFunctionCallArgumentsDone = async (event: {
    call_id?: unknown;
    name?: unknown;
    arguments?: unknown;
  }) => {
    const conversationId = conversationIdRef.current;
    if (!conversationId) {
      return;
    }

    const callId = typeof event.call_id === 'string' ? event.call_id : '';
    const toolName = typeof event.name === 'string' ? event.name : '';
    const argumentsJson = typeof event.arguments === 'string' ? event.arguments : '';

    if (!callId || !toolName) {
      return;
    }

    const voiceTurnId = await ensureTurnStarted(
      pendingUserTranscriptRef.current.trim() || '(voice tool call)',
    );
    if (!voiceTurnId) {
      forwardToolResultToRealtime(callId, {
        error: 'Voice turn has not been initialized; cannot execute tool.',
      });
      return;
    }

    try {
      const result = await api.voice.tools.submitCall({
        conversationId,
        voiceTurnId,
        callId,
        toolName,
        argumentsJson,
      });

      const status: VoicePendingToolCall['status'] =
        result.status === 'requires_approval' ? 'requires_approval' : 'running';
      registerToolCall({
        callId,
        toolExecutionId: result.toolExecutionId,
        toolName,
        status,
      });

      if (status === 'requires_approval') {
        setConnectionLabel('Waiting for approval...');
        setVoicePhase('thinking');
      } else {
        setConnectionLabel('Running tool...');
        setVoicePhase('thinking');
      }
    } catch (submitError) {
      void reportClientError({
        event: 'client.voice.tool_submit_failed',
        component: 'use-live-voice-session',
        message: 'Failed to submit voice tool call',
        error: submitError,
        conversationId,
        voiceSessionId: sessionIdRef.current ?? undefined,
        context: { toolName, callId },
      });
      forwardToolResultToRealtime(callId, {
        error: submitError instanceof Error ? submitError.message : 'Voice tool submission failed.',
      });
    }
  };

  const handleToolEventFromServer = useCallback((payload: ToolEventPayload) => {
    if (!payload.toolExecutionId) {
      return;
    }

    if (payload.type === 'tool.done') {
      const removed = removeToolCallByExecutionId(payload.toolExecutionId);
      if (!removed) {
        return;
      }
      const output =
        payload.status === 'failed'
          ? { error: payload.output ?? 'Tool execution failed.' }
          : (payload.output ?? null);
      forwardToolResultToRealtime(removed.callId, output);
      return;
    }

    if (payload.type === 'approval.resolved') {
      if (payload.status === 'approved') {
        updateToolCallStatus(payload.toolExecutionId, 'running');
        return;
      }
      if (payload.status === 'rejected') {
        const removed = removeToolCallByExecutionId(payload.toolExecutionId);
        if (!removed) {
          return;
        }
        forwardToolResultToRealtime(removed.callId, {
          error: 'User rejected this tool call.',
        });
      }
    }
  }, []);

  const canInterruptAssistant = useCallback(
    () => phaseRef.current === 'thinking' || phaseRef.current === 'speaking',
    [],
  );

  const broadcastInterruptToServer = useCallback(() => {
    const sessionId = sessionIdRef.current;
    const conversationId = conversationIdRef.current;
    if (!sessionId || !conversationId) {
      return;
    }

    const voiceTurnId = activeVoiceTurnIdRef.current ?? undefined;
    api.voice.interrupt(sessionId, { conversationId, voiceTurnId }).catch((interruptError) => {
      void reportClientError({
        event: 'client.voice.interrupt_broadcast_failed',
        component: 'use-live-voice-session',
        message: 'Failed to broadcast voice session interrupt',
        error: interruptError,
        conversationId,
        voiceSessionId: sessionId,
      });
    });
  }, []);

  const interruptAssistant = useCallback(() => {
    if (!canInterruptAssistant()) {
      return;
    }

    sendRealtimeEvent({ type: 'response.cancel' });
    sendRealtimeEvent({ type: 'output_audio_buffer.clear' });
    pendingAssistantTranscriptRef.current = '';
    responseDoneRef.current = false;
    setAssistantCaption('');
    broadcastInterruptToServer();
  }, [broadcastInterruptToServer, canInterruptAssistant, sendRealtimeEvent]);

  const teardown = useCallback(() => {
    try {
      if (canInterruptAssistant()) {
        interruptAssistant();
      }
    } catch {
      // Ignore teardown-time realtime errors.
    }

    dataChannelRef.current?.close();
    dataChannelRef.current = null;

    peerConnectionRef.current?.getSenders().forEach((sender) => {
      sender.track?.stop();
    });
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;

    microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
    microphoneStreamRef.current = null;
    stopVoiceMeter();

    if (remoteAudioRef.current) {
      remoteAudioRef.current.pause();
      remoteAudioRef.current.srcObject = null;
      remoteAudioRef.current = null;
    }

    resetPendingTurn();
    resetToolCalls();
    sessionIdRef.current = null;
    setUserCaption('');
    setAssistantCaption('');
    setConnectionLabel('Voice mode is off.');
    setVoicePhase('idle');
  }, [canInterruptAssistant, interruptAssistant, stopVoiceMeter]);

  useEffect(() => teardown, [teardown]);

  useEffect(() => {
    if (!subscribeToolEvents) {
      return;
    }
    return subscribeToolEvents(handleToolEventFromServer);
  }, [handleToolEventFromServer, subscribeToolEvents]);

  const handleRealtimeEvent = async (event: { type?: string; [key: string]: unknown }) => {
    switch (event.type) {
      case 'session.created':
      case 'session.updated':
        setConnectionLabel('Connected. Start speaking when you are ready.');
        setVoicePhase('listening');
        return;
      case 'input_audio_buffer.speech_started':
        if (canInterruptAssistant()) {
          interruptAssistant();
        }
        setVoicePhase('listening');
        setConnectionLabel('Listening...');
        setUserCaption('');
        return;
      case 'input_audio_buffer.speech_stopped':
        setVoicePhase('thinking');
        setConnectionLabel('Thinking...');
        return;
      case 'conversation.item.input_audio_transcription.delta': {
        const delta = typeof event.delta === 'string' ? event.delta : '';
        if (delta) {
          setUserCaption((previous) => previous + delta);
        }
        return;
      }
      case 'conversation.item.input_audio_transcription.completed': {
        const transcript = typeof event.transcript === 'string' ? event.transcript.trim() : '';
        if (transcript) {
          await finalizeUserTranscript(transcript);
        }
        return;
      }
      case 'response.output_audio_transcript.delta':
      case 'response.audio_transcript.delta': {
        const delta = typeof event.delta === 'string' ? event.delta : '';
        if (delta) {
          updateAssistantCaption('audio_transcript', delta, 'append');
        }
        return;
      }
      case 'response.output_audio_transcript.done':
      case 'response.audio_transcript.done': {
        const transcript = typeof event.transcript === 'string' ? event.transcript.trim() : '';
        if (transcript) {
          updateAssistantCaption('audio_transcript', transcript, 'replace');
        }
        await maybePersistTurn();
        return;
      }
      case 'response.output_text.delta': {
        const delta = typeof event.delta === 'string' ? event.delta : '';
        if (delta) {
          updateAssistantCaption('output_text', delta, 'append');
        }
        return;
      }
      case 'response.output_text.done': {
        const text = typeof event.text === 'string' ? event.text.trim() : '';
        if (text) {
          updateAssistantCaption('output_text', text, 'replace');
        }
        return;
      }
      case 'response.function_call_arguments.done': {
        await handleFunctionCallArgumentsDone(
          event as { call_id?: unknown; name?: unknown; arguments?: unknown },
        );
        return;
      }
      case 'response.done':
        responseDoneRef.current = true;
        if (pendingAssistantTranscriptRef.current && !assistantMessageAddedRef.current) {
          addVoiceMessageToChat('assistant', pendingAssistantTranscriptRef.current);
          assistantMessageAddedRef.current = true;
        }
        setVoicePhase('listening');
        setConnectionLabel('Listening...');
        await maybePersistTurn();
        return;
      case 'output_audio_buffer.cleared':
        setVoicePhase('listening');
        setConnectionLabel('Listening...');
        return;
      case 'error': {
        const message =
          typeof event.error === 'object' &&
          event.error !== null &&
          'message' in event.error &&
          typeof event.error.message === 'string'
            ? event.error.message
            : 'Live voice mode ran into an error.';

        if (message === 'Cancellation failed: no active response found') {
          return;
        }

        void reportClientError({
          event: 'client.voice.realtime_error',
          component: 'use-live-voice-session',
          message,
          conversationId: conversationIdRef.current ?? undefined,
          voiceSessionId: sessionIdRef.current ?? undefined,
          context: { event },
        });
        setError(message);
        setVoicePhase('error');
        setConnectionLabel(message);
        return;
      }
      default:
        return;
    }
  };

  const start = async () => {
    if (
      phase === 'connecting' ||
      phase === 'listening' ||
      phase === 'thinking' ||
      phase === 'speaking'
    ) {
      return;
    }

    const browserSupport = getBrowserVoiceSupport();
    if (!browserSupport.supported) {
      const message = browserSupport.reason ?? 'Live voice mode is not supported in this browser.';
      void reportClientError({
        event: 'client.voice.unsupported',
        component: 'use-live-voice-session',
        message,
      });
      setError(message);
      setVoicePhase('error');
      setConnectionLabel(message);
      return;
    }

    setError(null);
    setUserCaption('');
    setAssistantCaption('');
    setVoicePhase('connecting');
    setConnectionLabel('Connecting live voice...');

    try {
      const session = await startSession();
      conversationIdRef.current = session.conversationId;
      sessionIdRef.current = session.sessionId;

      const connection = await connectWebRtcVoiceSession({
        sessionId: session.sessionId,
        conversationId: session.conversationId,
        exchangeSdpAnswer: api.voice.exchangeSdpAnswer,
        onRealtimeEvent: (event) => {
          void handleRealtimeEvent(event);
        },
      });
      peerConnectionRef.current = connection.peerConnection;
      dataChannelRef.current = connection.dataChannel;
      microphoneStreamRef.current = connection.microphoneStream;
      remoteAudioRef.current = connection.remoteAudio;
      startVoiceMeter(connection.microphoneStream);

      setVoicePhase('listening');
      setConnectionLabel('Connected. Start speaking when you are ready.');
    } catch (startError) {
      const voiceSessionId = sessionIdRef.current ?? undefined;
      teardown();
      const apiError = startError instanceof ApiError ? startError : null;
      void reportClientError({
        event: 'client.voice.start_failed',
        component: 'use-live-voice-session',
        message: 'Failed to start live voice mode',
        error: startError,
        requestId: apiError?.requestId,
        conversationId: conversationIdRef.current ?? undefined,
        voiceSessionId,
      });
      const message =
        startError instanceof Error ? startError.message : 'Failed to start live voice mode.';
      setError(message);
      setVoicePhase('error');
      setConnectionLabel(message);
    }
  };

  const stop = async () => {
    teardown();
    if (conversationIdRef.current) {
      await syncConversation(conversationIdRef.current);
    }
  };

  const toggle = async () => {
    if (
      phase === 'listening' ||
      phase === 'thinking' ||
      phase === 'speaking' ||
      phase === 'connecting'
    ) {
      await stop();
      return;
    }

    await start();
  };

  return {
    isActive:
      phase === 'connecting' ||
      phase === 'listening' ||
      phase === 'thinking' ||
      phase === 'speaking',
    phase,
    connectionLabel,
    userCaption,
    assistantCaption,
    voiceLevels,
    voiceVolume,
    error,
    pendingToolCalls,
    start,
    stop,
    toggle,
  };
}
