import type { VoicePendingToolCall } from './types';

export class VoiceToolRegistry {
  private readonly callsByExecutionId = new Map<string, VoicePendingToolCall>();
  private readonly callsByCallId = new Map<string, VoicePendingToolCall>();

  register(call: VoicePendingToolCall) {
    this.callsByCallId.set(call.callId, call);
    this.callsByExecutionId.set(call.toolExecutionId, call);
  }

  updateStatus(toolExecutionId: string, status: VoicePendingToolCall['status']) {
    const existing = this.callsByExecutionId.get(toolExecutionId);
    if (!existing) {
      return null;
    }

    const updated = { ...existing, status };
    this.callsByExecutionId.set(toolExecutionId, updated);
    this.callsByCallId.set(updated.callId, updated);
    return updated;
  }

  removeByExecutionId(toolExecutionId: string) {
    const existing = this.callsByExecutionId.get(toolExecutionId);
    if (!existing) {
      return null;
    }

    this.callsByExecutionId.delete(toolExecutionId);
    this.callsByCallId.delete(existing.callId);
    return existing;
  }

  hasPendingCalls() {
    return this.callsByCallId.size > 0;
  }

  values() {
    return Array.from(this.callsByCallId.values());
  }

  clear() {
    this.callsByExecutionId.clear();
    this.callsByCallId.clear();
  }
}
