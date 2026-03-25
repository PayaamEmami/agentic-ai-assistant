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

  const resetPendingTurn = () => {
    pendingUserTranscriptRef.current = '';
    pendingAssistantTranscriptRef.current = '';
    responseDoneRef.current = false;
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

  const interruptAssistant = () => {
    sendRealtimeEvent({ type: 'response.cancel' });
    sendRealtimeEvent({ type: 'output_audio_buffer.clear' });
    pendingAssistantTranscriptRef.current = '';
    responseDoneRef.current = false;
    setAssistantCaption('');
  };

  const teardown = () => {
    try {
      interruptAssistant();
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
    setPhase('idle');
  };

  useEffect(() => teardown, []);

  const handleRealtimeEvent = async (event: { type?: string; [key: string]: unknown }) => {
    switch (event.type) {
      case 'session.created':
      case 'session.updated':
        setConnectionLabel('Connected. Start speaking when you are ready.');
        setPhase('listening');
        return;
      case 'input_audio_buffer.speech_started':
        interruptAssistant();
        setPhase('listening');
        setConnectionLabel('Listening...');
        setUserCaption('');
        return;
      case 'input_audio_buffer.speech_stopped':
        setPhase('thinking');
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
          pendingUserTranscriptRef.current = transcript;
          setUserCaption(transcript);
        }
        return;
      }
      case 'response.audio_transcript.delta': {
        const delta = typeof event.delta === 'string' ? event.delta : '';
        if (delta) {
          setPhase('speaking');
          setConnectionLabel('Assistant is speaking...');
          setAssistantCaption((previous) => previous + delta);
        }
        return;
      }
      case 'response.audio_transcript.done': {
        const transcript = typeof event.transcript === 'string' ? event.transcript.trim() : '';
        if (transcript) {
          pendingAssistantTranscriptRef.current = transcript;
          setAssistantCaption(transcript);
        }
        await maybePersistTurn();
        return;
      }
      case 'response.done':
        responseDoneRef.current = true;
        setPhase('listening');
        setConnectionLabel('Listening...');
        await maybePersistTurn();
        return;
      case 'output_audio_buffer.cleared':
        setPhase('listening');
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
        void reportClientError({
          event: 'client.voice.realtime_error',
          component: 'use-live-voice-session',
          message,
          conversationId: conversationIdRef.current ?? undefined,
          voiceSessionId: sessionIdRef.current ?? undefined,
          context: { event },
        });
        setError(message);
        setPhase('error');
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
      setPhase('error');
      setConnectionLabel('Live voice mode is not supported in this browser.');
      return;
    }

    setError(null);
    setUserCaption('');
    setAssistantCaption('');
    setPhase('connecting');
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

      setPhase('listening');
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
      setPhase('error');
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
