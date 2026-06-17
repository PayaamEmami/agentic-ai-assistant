'use client';

import { useEffect, useRef } from 'react';
import { buildWebSocketUrl } from '../api-client';
import type { AssistantStage, ToolResultContentBlock } from './model/index';
import type { ToolEventPayload } from '../tool-events';

type ToolResultPatch = Partial<Pick<ToolResultContentBlock, 'status' | 'detail' | 'output'>>;

const ASSISTANT_STAGES: ReadonlySet<string> = new Set([
  'routing',
  'retrieving',
  'research',
  'tool',
  'coding',
  'answering',
  'verifying',
  'done',
]);

function asStage(value: unknown): AssistantStage | undefined {
  return typeof value === 'string' && ASSISTANT_STAGES.has(value)
    ? (value as AssistantStage)
    : undefined;
}

interface UseChatWebSocketOptions {
  token: string | null;
  conversationId?: string;
  refreshConversation: (conversationId: string) => void | Promise<void>;
  loadPendingApprovals: () => void | Promise<void>;
  patchToolResult: (toolExecutionId: string | undefined, patch: ToolResultPatch) => void;
  resolveApproval: (
    toolExecutionId: string | undefined,
    status: 'approved' | 'rejected' | undefined,
  ) => void;
  emitToolEvent: (payload: ToolEventPayload) => void;
  reportRealtimeError: (message: string) => void;
  appendAssistantDelta: (messageId: string, delta: string) => void;
  appendThinkingDelta: (messageId: string, stage: AssistantStage, delta: string) => void;
  setAssistantStage: (messageId: string, stage: AssistantStage) => void;
  onTurnSettled: () => void;
}

export function useChatWebSocket({
  token,
  conversationId,
  refreshConversation,
  loadPendingApprovals,
  patchToolResult,
  resolveApproval,
  emitToolEvent,
  reportRealtimeError,
  appendAssistantDelta,
  appendThinkingDelta,
  setAssistantStage,
  onTurnSettled,
}: UseChatWebSocketOptions) {
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!token || !conversationId) {
      socketRef.current?.close();
      socketRef.current = null;
      return;
    }

    const socket = new WebSocket(buildWebSocketUrl(token));
    socketRef.current = socket;

    socket.addEventListener('open', () => {
      socket.send(
        JSON.stringify({
          type: 'subscribe',
          conversationId,
        }),
      );
    });

    socket.addEventListener('message', (event) => {
      const parsed = parseSocketEvent(event.data);
      if (!parsed) {
        return;
      }

      switch (parsed.type) {
        case 'assistant.text.delta': {
          const messageId = asString(parsed.messageId);
          const delta = asString(parsed.delta);
          if (messageId && delta) {
            appendAssistantDelta(messageId, delta);
          }
          return;
        }
        case 'assistant.thinking.delta': {
          const messageId = asString(parsed.messageId);
          const stage = asStage(parsed.stage);
          const delta = asString(parsed.delta);
          if (messageId && stage && delta) {
            appendThinkingDelta(messageId, stage, delta);
          }
          return;
        }
        case 'assistant.status': {
          const messageId = asString(parsed.messageId);
          const stage = asStage(parsed.stage);
          if (messageId && stage) {
            setAssistantStage(messageId, stage);
          }
          return;
        }
        case 'assistant.text.done':
        case 'assistant.interrupted':
          void refreshConversation(conversationId);
          onTurnSettled();
          return;
        case 'tool.start': {
          const toolExecutionId = asString(parsed.toolExecutionId);
          patchToolResult(toolExecutionId, {
            status: 'running',
            detail: undefined,
            output: undefined,
          });
          return;
        }
        case 'tool.progress': {
          const toolExecutionId = asString(parsed.toolExecutionId);
          patchToolResult(toolExecutionId, {
            status: 'running',
            detail: asString(parsed.message),
          });
          return;
        }
        case 'tool.done': {
          const toolExecutionId = asString(parsed.toolExecutionId);
          const status =
            parsed.status === 'completed' || parsed.status === 'failed' ? parsed.status : undefined;
          patchToolResult(toolExecutionId, {
            status,
            output: parsed.output,
            detail: undefined,
          });
          emitToolEvent({
            type: 'tool.done',
            conversationId: asString(parsed.conversationId),
            toolExecutionId,
            output: parsed.output,
            status,
          });
          return;
        }
        case 'approval.requested':
          void loadPendingApprovals();
          void refreshConversation(conversationId);
          return;
        case 'approval.resolved': {
          const toolExecutionId = asString(parsed.toolExecutionId);
          const status =
            parsed.status === 'approved' || parsed.status === 'rejected' ? parsed.status : undefined;
          resolveApproval(toolExecutionId, status);
          emitToolEvent({
            type: 'approval.resolved',
            conversationId: asString(parsed.conversationId),
            toolExecutionId,
            status,
          });
          void loadPendingApprovals();
          return;
        }
        case 'error': {
          const message = asString(parsed.message) ?? 'Realtime connection was rejected.';
          reportRealtimeError(message);
          onTurnSettled();
          return;
        }
        default:
          return;
      }
    });

    socket.addEventListener('close', () => {
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
    });

    return () => {
      socket.close();
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
    };
  }, [
    appendAssistantDelta,
    appendThinkingDelta,
    conversationId,
    emitToolEvent,
    loadPendingApprovals,
    onTurnSettled,
    patchToolResult,
    refreshConversation,
    reportRealtimeError,
    resolveApproval,
    setAssistantStage,
    token,
  ]);
}

function parseSocketEvent(raw: unknown): { type?: string; [key: string]: unknown } | null {
  try {
    return JSON.parse(String(raw)) as { type?: string; [key: string]: unknown };
  } catch {
    return null;
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
