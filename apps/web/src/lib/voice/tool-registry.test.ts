import { describe, expect, it } from 'vitest';
import { VoiceToolRegistry } from './tool-registry';

describe('VoiceToolRegistry', () => {
  it('tracks calls by call id and tool execution id', () => {
    const registry = new VoiceToolRegistry();

    registry.register({
      callId: 'call-1',
      toolExecutionId: 'tool-1',
      toolName: 'search',
      status: 'requires_approval',
    });

    expect(registry.values()).toEqual([
      {
        callId: 'call-1',
        toolExecutionId: 'tool-1',
        toolName: 'search',
        status: 'requires_approval',
      },
    ]);
    expect(registry.hasPendingCalls()).toBe(true);
  });

  it('updates and removes calls by execution id', () => {
    const registry = new VoiceToolRegistry();
    registry.register({
      callId: 'call-1',
      toolExecutionId: 'tool-1',
      toolName: 'search',
      status: 'requires_approval',
    });

    expect(registry.updateStatus('tool-1', 'running')).toEqual({
      callId: 'call-1',
      toolExecutionId: 'tool-1',
      toolName: 'search',
      status: 'running',
    });
    expect(registry.removeByExecutionId('tool-1')).toEqual({
      callId: 'call-1',
      toolExecutionId: 'tool-1',
      toolName: 'search',
      status: 'running',
    });
    expect(registry.values()).toEqual([]);
    expect(registry.hasPendingCalls()).toBe(false);
  });
});
