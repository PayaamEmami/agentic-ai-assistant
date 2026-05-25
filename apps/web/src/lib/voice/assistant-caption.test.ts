import { describe, expect, it } from 'vitest';
import { chooseAssistantCaptionSource } from './assistant-caption';

describe('chooseAssistantCaptionSource', () => {
  it('accepts the first caption source', () => {
    expect(chooseAssistantCaptionSource(null, 'output_text')).toEqual({
      accepted: true,
      source: 'output_text',
      resetTranscript: false,
    });
  });

  it('lets audio transcripts replace output text and reset accumulated text', () => {
    expect(chooseAssistantCaptionSource('output_text', 'audio_transcript')).toEqual({
      accepted: true,
      source: 'audio_transcript',
      resetTranscript: true,
    });
  });

  it('keeps audio transcripts when later output text arrives', () => {
    expect(chooseAssistantCaptionSource('audio_transcript', 'output_text')).toEqual({
      accepted: false,
      source: 'audio_transcript',
      resetTranscript: false,
    });
  });
});
