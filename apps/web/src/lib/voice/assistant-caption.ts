export type AssistantCaptionSource = 'audio_transcript' | 'output_text';

export interface CaptionSourceDecision {
  accepted: boolean;
  source: AssistantCaptionSource | null;
  resetTranscript: boolean;
}

export function chooseAssistantCaptionSource(
  current: AssistantCaptionSource | null,
  incoming: AssistantCaptionSource,
): CaptionSourceDecision {
  if (current === incoming) {
    return { accepted: true, source: current, resetTranscript: false };
  }

  if (current === null) {
    return { accepted: true, source: incoming, resetTranscript: false };
  }

  if (current === 'output_text' && incoming === 'audio_transcript') {
    return { accepted: true, source: incoming, resetTranscript: true };
  }

  return { accepted: false, source: current, resetTranscript: false };
}
