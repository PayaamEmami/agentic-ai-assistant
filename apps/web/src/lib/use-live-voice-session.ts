'use client';

import { useEffect, useRef, useState } from 'react';
import { API_BASE, ApiError, getStoredAuthToken, api } from './api-client';
import { reportClientError } from './client-logging';

type VoicePhase =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'error';

interface SessionInit {
  sessionId: string;
  clientSecret: string;
  expiresAt: string;
  conversationId: string;
  model: string;
  voice: string;
}

interface UseLiveVoiceSessionOptions {
  startSession: () => Promise<SessionInit>;
  appendVoiceMessage: (conversationId: string, role: 'user' | 'assistant', text: string) => void;
  syncConversation: (conversationId: string) => Promise<void>;
}

function parseEvent(raw: string): { type?: string; [key: string]: unknown } | null {
  try {
    return JSON.parse(raw) as { type?: string; [key: string]: unknown };
  } catch {
    return null;
  }
}

async function requestSdpAnswerFallback(
  sessionId: string,
  conversationId: string,
  sdp: string,
): Promise<string> {
  const token = getStoredAuthToken();
  if (!token) {
    throw new Error('Authentication required');
  }

  const response = await fetch(`${API_BASE}/api/voice/session/answer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ conversationId, sdp, sessionId }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(
      response.status,
      typeof body?.error?.message === 'string'
        ? body.error.message
        : 'Failed to connect live voice session.',
      typeof body?.error?.code === 'string' ? body.error.code : undefined,
      response.headers.get('x-request-id') ?? undefined,
    );
  }

  return response.text();
}

export function useLiveVoiceSession({
  startSession,
  appendVoiceMessage,
  syncConversation,
}: UseLiveVoiceSessionOptions) {
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [connectionLabel, setConnectionLabel] = useState('Voice mode is off.');
  const [userCaption, setUserCaption] = useState('');
  const [assistantCaption, setAssistantCaption] = useState('');
  const [error, setError] = useState<string | null>(null);

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const pendingUserTranscriptRef = useRef('');
  const pendingAssistantTranscriptRef = useRef('');
  const responseDoneRef = useRef(false);
  const isPersistingTurnRef = useRef(false);
  const phaseRef = useRef<VoicePhase>('idle');
  const userMessageAddedRef = useRef(false);
  const assistantMessageAddedRef = useRef(false);
  const assistantCaptionSourceRef = useRef<'audio_transcript' | 'output_text' | null>(null);

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
  };

  const addVoiceMessageToChat = (role: 'user' | 'assistant', text: string) => {
    const conversationId = conversationIdRef.current;
    if (!conversationId) {
      return;
    }

    appendVoiceMessage(conversationId, role, text);
  };

  const finalizeUserTranscript = (transcript: string) => {
    const trimmed = transcript.trim();
    if (!trimmed) {
      return;
    }

    pendingUserTranscriptRef.current = trimmed;
    setUserCaption(trimmed);

    if (!userMessageAddedRef.current) {
      addVoiceMessageToChat('user', trimmed);
      userMessageAddedRef.current = true;
    }
  };

  const selectAssistantCaptionSource = (source: 'audio_transcript' | 'output_text') => {
    const current = assistantCaptionSourceRef.current;
    if (current === source) {
      return true;
    }

    if (current === null) {
      assistantCaptionSourceRef.current = source;
      return true;
    }

    if (current === 'output_text' && source === 'audio_transcript') {
      assistantCaptionSourceRef.current = source;
      setAssistantCaption('');
      return true;
    }

    return false;
  };

  const updateAssistantCaption = (
    source: 'audio_transcript' | 'output_text',
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
      setAssistantCaption((previous) => previous + value);
      return;
    }

    pendingAssistantTranscriptRef.current = normalized;
    setAssistantCaption(normalized);
  };

  const maybePersistTurn = async () => {
    if (isPersistingTurnRef.current) {
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
      await api.voice.persistTurn(conversationId, userTranscript, assistantTranscript);
      await syncConversation(conversationId);
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

  const sendRealtimeEvent = (event: Record<string, unknown>) => {
    const channel = dataChannelRef.current;
    if (!channel || channel.readyState !== 'open') {
      return;
    }

    channel.send(JSON.stringify(event));
  };

  const canInterruptAssistant = () =>
    phaseRef.current === 'thinking' || phaseRef.current === 'speaking';

  const interruptAssistant = () => {
    if (!canInterruptAssistant()) {
      return;
    }

    sendRealtimeEvent({ type: 'response.cancel' });
    sendRealtimeEvent({ type: 'output_audio_buffer.clear' });
    pendingAssistantTranscriptRef.current = '';
    responseDoneRef.current = false;
    setAssistantCaption('');
  };

  const teardown = () => {
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

    if (remoteAudioRef.current) {
      remoteAudioRef.current.pause();
      remoteAudioRef.current.srcObject = null;
      remoteAudioRef.current = null;
    }

    resetPendingTurn();
    sessionIdRef.current = null;
    setUserCaption('');
    setAssistantCaption('');
    setConnectionLabel('Voice mode is off.');
    setVoicePhase('idle');
  };

  useEffect(() => teardown, []);

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
          finalizeUserTranscript(transcript);
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
    if (phase === 'connecting' || phase === 'listening' || phase === 'thinking' || phase === 'speaking') {
      return;
    }

    if (
      typeof window === 'undefined' ||
      typeof navigator === 'undefined' ||
      typeof RTCPeerConnection === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      void reportClientError({
        event: 'client.voice.unsupported',
        component: 'use-live-voice-session',
        message: 'Live voice mode is not supported in this browser.',
      });
      setError('Live voice mode is not supported in this browser.');
      setVoicePhase('error');
      setConnectionLabel('Live voice mode is not supported in this browser.');
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

      const pc = new RTCPeerConnection();
      peerConnectionRef.current = pc;

      const remoteAudio = new Audio();
      remoteAudio.autoplay = true;
      remoteAudioRef.current = remoteAudio;

      pc.ontrack = (event) => {
        remoteAudio.srcObject = event.streams[0] ?? null;
      };

      const microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      microphoneStreamRef.current = microphoneStream;
      for (const track of microphoneStream.getTracks()) {
        pc.addTrack(track, microphoneStream);
      }

      const dc = pc.createDataChannel('oai-events');
      dataChannelRef.current = dc;
      dc.addEventListener('message', (messageEvent) => {
        const event = parseEvent(String(messageEvent.data));
        if (!event) {
          return;
        }
        void handleRealtimeEvent(event);
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const answerSdp = await requestSdpAnswerFallback(
        session.sessionId,
        session.conversationId,
        offer.sdp ?? '',
      );

      await pc.setRemoteDescription({
        type: 'answer',
        sdp: answerSdp,
      });

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
        startError instanceof Error
          ? startError.message
          : 'Failed to start live voice mode.';
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
    if (phase === 'listening' || phase === 'thinking' || phase === 'speaking' || phase === 'connecting') {
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
    error,
    start,
    stop,
    toggle,
  };
}
