import { describe, expect, it } from 'vitest';
import { toRealtimeToolName } from './voice-service.js';

describe('toRealtimeToolName', () => {
  it('converts native tool names to OpenAI Realtime function names', () => {
    expect(toRealtimeToolName('time.now')).toBe('time_now');
    expect(toRealtimeToolName('github.get_pull_request')).toBe('github_get_pull_request');
  });

  it('preserves characters allowed by Realtime function names', () => {
    expect(toRealtimeToolName('tool-name_123')).toBe('tool-name_123');
  });
});
