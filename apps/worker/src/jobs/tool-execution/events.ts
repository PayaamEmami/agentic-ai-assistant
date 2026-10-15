import { getPool, messageRepository } from '@aaa/db';
import {
  TOOL_EVENT_CHANNEL,
  type ToolDoneEvent,
  type ToolProgressEvent,
  type ToolStartEvent,
} from '@aaa/shared';

export async function publishToolEvent(
  event: ToolStartEvent | ToolProgressEvent | ToolDoneEvent,
): Promise<void> {
  const pool = getPool();
  await pool.query('SELECT pg_notify($1, $2)', [TOOL_EVENT_CHANNEL, JSON.stringify(event)]);
}

export async function updateInlineToolResult(
  messageId: string | null,
  toolExecutionId: string,
  patch: {
    status?: string;
    output?: unknown;
    detail?: string;
  },
): Promise<void> {
  if (!messageId) {
    return;
  }

  await messageRepository.updateToolResultBlock(messageId, toolExecutionId, patch);
}
