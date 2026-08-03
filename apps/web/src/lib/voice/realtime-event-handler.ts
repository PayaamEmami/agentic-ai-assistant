import type { Dispatch, SetStateAction } from 'react';
import type { AssistantCaptionSource } from './assistant-caption';
import type { VoicePhase } from './types';

type RealtimeEvent = { type?: string; [key: string]: unknown };

// The realtime data channel emits a stream of loosely typed events. This
// controller exposes exactly the operations the event router needs so the
// large `switch` can live outside the hook while still driving its state.
export interface RealtimeEventController {
  setConnectionLabel: (label: string) => void;
  setPhase: (phase: VoicePhase) => void;
  setUserCaption: Dispatch<SetStateAction<string>>;
  canInterruptAssistant: () => boolean;
  interruptAssistant: () => void;
  finalizeUserTranscript: (transcript: string) => Promise<void>;
  updateAssistantCaption: (
    source: AssistantCaptionSource,
    value: string,
    mode: 'append' | 'replace',
  ) => void;
  maybePersistTurn: () => Promise<void>;
  handleFunctionCallArgumentsDone: (event: {
    call_id?: unknown;
    name?: unknown;
    arguments?: unknown;
  }) => Promise<void>;
  handleResponseDone: () => Promise<void>;
  reportRealtimeError: (message: string, event: RealtimeEvent) => void;
}

function extractErrorMessage(event: RealtimeEvent): string {
  return typeof event.error === 'object' &&
    event.error !== null &&
    'message' in event.error &&
    typeof (event.error as { message?: unknown }).message === 'string'
    ? (event.error as { message: string }).message
    : 'Voice mode ran into an error.';
}

export function createRealtimeEventHandler(controller: RealtimeEventController) {
  return async function handleRealtimeEvent(event: RealtimeEvent): Promise<void> {
    switch (event.type) {
      case 'session.created':
      case 'session.updated':
        controller.setConnectionLabel('Connected. Start speaking when you are ready.');
        controller.setPhase('listening');
        return;
      case 'input_audio_buffer.speech_started':
        if (controller.canInterruptAssistant()) {
          controller.interruptAssistant();
        }
        controller.setPhase('listening');
        controller.setConnectionLabel('Listening...');
        controller.setUserCaption('');
        return;
      case 'input_audio_buffer.speech_stopped':
        controller.setPhase('thinking');
        controller.setConnectionLabel('Thinking...');
        return;
      case 'conversation.item.input_audio_transcription.delta': {
        const delta = typeof event.delta === 'string' ? event.delta : '';
        if (delta) {
          controller.setUserCaption((previous) => previous + delta);
        }
        return;
      }
      case 'conversation.item.input_audio_transcription.completed': {
        const transcript = typeof event.transcript === 'string' ? event.transcript.trim() : '';
        if (transcript) {
          await controller.finalizeUserTranscript(transcript);
        }
        return;
      }
      case 'response.output_audio_transcript.delta':
      case 'response.audio_transcript.delta': {
        const delta = typeof event.delta === 'string' ? event.delta : '';
        if (delta) {
          controller.updateAssistantCaption('audio_transcript', delta, 'append');
        }
        return;
      }
      case 'response.output_audio_transcript.done':
      case 'response.audio_transcript.done': {
        const transcript = typeof event.transcript === 'string' ? event.transcript.trim() : '';
        if (transcript) {
          controller.updateAssistantCaption('audio_transcript', transcript, 'replace');
        }
        await controller.maybePersistTurn();
        return;
      }
      case 'response.output_text.delta': {
        const delta = typeof event.delta === 'string' ? event.delta : '';
        if (delta) {
          controller.updateAssistantCaption('output_text', delta, 'append');
        }
        return;
      }
      case 'response.output_text.done': {
        const text = typeof event.text === 'string' ? event.text.trim() : '';
        if (text) {
          controller.updateAssistantCaption('output_text', text, 'replace');
        }
        return;
      }
      case 'response.function_call_arguments.done': {
        await controller.handleFunctionCallArgumentsDone(
          event as { call_id?: unknown; name?: unknown; arguments?: unknown },
        );
        return;
      }
      case 'response.done':
        await controller.handleResponseDone();
        return;
      case 'output_audio_buffer.cleared':
        controller.setPhase('listening');
        controller.setConnectionLabel('Listening...');
        return;
      case 'error': {
        const message = extractErrorMessage(event);

        if (message === 'Cancellation failed: no active response found') {
          return;
        }

        controller.reportRealtimeError(message, event);
        return;
      }
      default:
        return;
    }
  };
}
