'use client';

import { useCallback, useMemo, useRef } from 'react';
import { reportClientError } from './client-logging';

export interface ToolEventPayload {
  type: 'tool.done' | 'approval.resolved';
  conversationId?: string;
  toolExecutionId?: string;
  output?: unknown;
  status?: string;
}

export type ToolEventListener = (event: ToolEventPayload) => void;

export function useToolEventBus(component = 'chat-context') {
  const listenersRef = useRef<Set<ToolEventListener>>(new Set());

  const subscribe = useCallback((listener: ToolEventListener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const emit = useCallback(
    (payload: ToolEventPayload) => {
      for (const listener of listenersRef.current) {
        try {
          listener(payload);
        } catch (listenerError) {
          void reportClientError({
            event: 'client.chat.tool_listener_failed',
            component,
            message: 'Tool event listener threw an error',
            error: listenerError,
          });
        }
      }
    },
    [component],
  );

  return useMemo(() => ({ emit, subscribe }), [emit, subscribe]);
}
