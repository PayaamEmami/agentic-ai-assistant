import { describe, expect, it } from 'vitest';
import { buildListenerSessionConfig, parseListenerConcepts } from './service.js';

describe('listener service helpers', () => {
  it('builds a transcription-only realtime session', () => {
    expect(buildListenerSessionConfig('gpt-live-transcribe')).toEqual({
      type: 'transcription',
      audio: {
        input: {
          noise_reduction: { type: 'near_field' },
          transcription: {
            model: 'gpt-live-transcribe',
            delay: 'low',
            prompt: 'Educational video, lecture, tutorial, or spoken explanation.',
          },
          turn_detection: {
            type: 'server_vad',
            prefix_padding_ms: 300,
            silence_duration_ms: 600,
          },
        },
      },
    });
  });

  it('parses and bounds concept JSON', () => {
    expect(
      parseListenerConcepts(
        '```json\n{"concepts":[{"title":"Gradient descent","explanation":"An optimizer."}]}\n```',
      ),
    ).toEqual([{ title: 'Gradient descent', explanation: 'An optimizer.' }]);
  });

  it('returns no concepts for malformed model output', () => {
    expect(parseListenerConcepts('not json')).toEqual([]);
  });
});
