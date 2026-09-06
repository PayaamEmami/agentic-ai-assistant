'use client';

import { useEffect, useRef } from 'react';
import { asString } from '@aaa/shared';
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

const SOCKET_PING_INTERVAL_MS = 25_000;
const SOCKET_RECONNECT_MAX_DELAY_MS = 15_000;

function asStage(value: unknown): AssistantStage | undefined {
  return typeof value === 'string' && ASSISTANT_STAGES.has(value)
    ? (value as AssistantStage)
    : undefined;
}

interface UseChatWebSocketOptions {
  token: string | null;
  conversationId?: string;
  syncConversationMessages: (conversationId: string) => void | Promise<void>;
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
  finalizeAssistantTurn: (
    messageId: string,
    options?: { fullText?: string; interrupted?: boolean },
  ) => void;
  recoverSettledTurn: () => void | Promise<void>;
  onTurnSettled: () => void;
}

export function useChatWebSocket(options: UseChatWebSocketOptions) {
  const { token, conversationId } = options;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (!token || !conversationId) {
      return;
    }

    let active = true;
    let socket: WebSocket | null = null;
    let reconnectTimeout: number | undefined;
    let pingInterval: number | undefined;
    let reconnectAttempt = 0;

    const clearTimers = () => {
      if (reconnectTimeout !== undefined) {
        window.clearTimeout(reconnectTimeout);
        reconnectTimeout = undefined;
      }
      if (pingInterval !== undefined) {
        window.clearInterval(pingInterval);
        pingInterval = undefined;
      }
    };

    const syncConversation = () =>
      void Promise.resolve(optionsRef.current.syncConversationMessages(conversationId)).catch(
        () => undefined,
      );

    const settleTurn = (messageId: string | undefined, interrupted = false, fullText?: string) => {
      if (messageId) {
        optionsRef.current.finalizeAssistantTurn(messageId, { fullText, interrupted });
      }
      optionsRef.current.onTurnSettled();
      syncConversation();
    };

    const handleMessage = (event: MessageEvent) => {
      const parsed = parseSocketEvent(event.data);
      if (!parsed) {
        return;
      }

      const current = optionsRef.current;

      switch (parsed.type) {
        case 'assistant.text.delta': {
          const messageId = asString(parsed.messageId);
          const delta = asString(parsed.delta);
          if (messageId && delta) {
            current.appendAssistantDelta(messageId, delta);
          }
          return;
        }
        case 'assistant.thinking.delta': {
          const messageId = asString(parsed.messageId);
          const stage = asStage(parsed.stage);
          const delta = asString(parsed.delta);
          if (messageId && stage && delta) {
            current.appendThinkingDelta(messageId, stage, delta);
          }
          return;
        }
        case 'assistant.status': {
          const messageId = asString(parsed.messageId);
          const stage = asStage(parsed.stage);
          if (messageId && stage) {
            current.setAssistantStage(messageId, stage);
          }
          return;
        }
        case 'assistant.text.done':
          settleTurn(asString(parsed.messageId), false, asString(parsed.fullText) ?? undefined);
          return;
        case 'assistant.interrupted':
          settleTurn(asString(parsed.messageId), true);
          return;
        case 'tool.start': {
          const toolExecutionId = asString(parsed.toolExecutionId);
          current.patchToolResult(toolExecutionId, {
            status: 'running',
            detail: undefined,
            output: undefined,
          });
          return;
        }
        case 'tool.progress': {
          const toolExecutionId = asString(parsed.toolExecutionId);
          current.patchToolResult(toolExecutionId, {
            status: 'running',
            detail: asString(parsed.message),
          });
          return;
        }
        case 'tool.done': {
          const toolExecutionId = asString(parsed.toolExecutionId);
          const status =
            parsed.status === 'completed' || parsed.status === 'failed' ? parsed.status : undefined;
          current.patchToolResult(toolExecutionId, {
            status,
            output: parsed.output,
            detail: undefined,
          });
          current.emitToolEvent({
            type: 'tool.done',
            conversationId: asString(parsed.conversationId),
            toolExecutionId,
            output: parsed.output,
            status,
          });
          return;
        }
        case 'approval.requested':
          void current.loadPendingApprovals();
          syncConversation();
          return;
        case 'approval.resolved': {
          const toolExecutionId = asString(parsed.toolExecutionId);
          const status =
            parsed.status === 'approved' || parsed.status === 'rejected' ? parsed.status : undefined;
          current.resolveApproval(toolExecutionId, status);
          current.emitToolEvent({
            type: 'approval.resolved',
            conversationId: asString(parsed.conversationId),
            toolExecutionId,
            status,
          });
          void current.loadPendingApprovals();
          return;
        }
        case 'error': {
          const message = asString(parsed.message) ?? 'Realtime connection was rejected.';
          current.reportRealtimeError(message);
          current.onTurnSettled();
          return;
        }
        default:
          return;
      }
    };

    const connect = () => {
      if (!active) {
        return;
      }

      const next = new WebSocket(buildWebSocketUrl(token));
      const previous = socket;
      socket = next;

      if (previous && previous.readyState < WebSocket.CLOSING) {
        previous.close();
      }

      next.addEventListener('open', () => {
        if (socket !== next) {
          return;
        }
        reconnectAttempt = 0;
        next.send(
          JSON.stringify({
            type: 'subscribe',
            conversationId,
          }),
        );
        void Promise.resolve(optionsRef.current.recoverSettledTurn()).catch(() => undefined);
      });

      next.addEventListener('message', handleMessage);

      next.addEventListener('close', () => {
        if (!active || socket !== next) {
          return;
        }

        const delay = Math.min(SOCKET_RECONNECT_MAX_DELAY_MS, 1_000 * 2 ** reconnectAttempt);
        reconnectAttempt += 1;
        reconnectTimeout = window.setTimeout(connect, delay);
      });
    };

    connect();
    pingInterval = window.setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'ping' }));
      }
    }, SOCKET_PING_INTERVAL_MS);

    return () => {
      active = false;
      clearTimers();
      socket?.close();
    };
  }, [conversationId, token]);
}

function parseSocketEvent(raw: unknown): { type?: string; [key: string]: unknown } | null {
  try {
    return JSON.parse(String(raw)) as { type?: string; [key: string]: unknown };
  } catch {
    return null;
  }
}
