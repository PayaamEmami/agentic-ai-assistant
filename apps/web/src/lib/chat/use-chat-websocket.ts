'use client';

import { useEffect, useRef } from 'react';
import { buildWebSocketUrl } from '../api-client';
import type { ToolResultContentBlock } from './model/index';
import type { ToolEventPayload } from './tool-events';

type ToolResultPatch = Partial<Pick<ToolResultContentBlock, 'status' | 'detail' | 'output'>>;

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
        case 'assistant.text.done':
        case 'assistant.interrupted':
          void refreshConversation(conversationId);
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
        case 'error':
          reportRealtimeError('Realtime connection was rejected.');
          return;
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
    conversationId,
    emitToolEvent,
    loadPendingApprovals,
    patchToolResult,
    refreshConversation,
    reportRealtimeError,
    resolveApproval,
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
