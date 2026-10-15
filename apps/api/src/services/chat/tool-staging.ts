import type { ApprovalRequestedEvent } from '@aaa/shared';
import { stageToolCall } from '../tools/call-service.js';
import type { EnqueueToolExecutionJob } from '../tools/execution-queue.js';
import type { AvailableTool } from '../tools/loader.js';
import { throwIfAborted } from './helpers.js';

type AgentToolCall = { name: string; arguments: Record<string, unknown> };

export interface StagedToolCalls {
  toolResultBlocks: Array<Record<string, unknown>>;
  toolExecutionIds: string[];
  queuedToolJobs: Array<Parameters<EnqueueToolExecutionJob>[0]>;
  approvalEvents: ApprovalRequestedEvent[];
  hasApprovalRequest: boolean;
}

/**
 * Stages model tool calls without enqueueing them.
 *
 * Jobs stay queued in memory until the assistant message is persisted, so a
 * failed save cannot leave a worker running against a missing message.
 */
export async function stageToolCalls(params: {
  conversationId: string;
  userId: string;
  toolCalls: AgentToolCall[];
  availableTools: AvailableTool[];
  enqueueToolExecutionJob: EnqueueToolExecutionJob;
  signal?: AbortSignal;
  autoApprove?: boolean;
}): Promise<StagedToolCalls> {
  const availableToolsByName = new Map(
    params.availableTools.map((tool) => [tool.name, tool] as const),
  );
  const toolResultBlocks: Array<Record<string, unknown>> = [];
  const toolExecutionIds: string[] = [];
  const queuedToolJobs: Array<Parameters<EnqueueToolExecutionJob>[0]> = [];
  const approvalEvents: ApprovalRequestedEvent[] = [];
  let hasApprovalRequest = false;

  for (const toolCall of params.toolCalls) {
    throwIfAborted(params.signal);

    const tool = availableToolsByName.get(toolCall.name);
    if (!tool) {
      continue;
    }

    const stagedToolCall = await stageToolCall({
      conversationId: params.conversationId,
      userId: params.userId,
      tool,
      input: toolCall.arguments,
      messageId: null,
      originMode: 'text',
      enqueueToolExecutionJob: params.enqueueToolExecutionJob,
      autoApprove: params.autoApprove,
    });
    toolExecutionIds.push(stagedToolCall.toolExecutionId);

    if (stagedToolCall.status === 'requires_approval') {
      hasApprovalRequest = true;

      toolResultBlocks.push({
        type: 'tool_result',
        toolExecutionId: stagedToolCall.toolExecutionId,
        toolName: toolCall.name,
        status: 'pending',
      });

      if (stagedToolCall.approvalEvent) {
        approvalEvents.push(stagedToolCall.approvalEvent);
      }
    } else if (stagedToolCall.queuedJob) {
      queuedToolJobs.push(stagedToolCall.queuedJob);

      toolResultBlocks.push({
        type: 'tool_result',
        toolExecutionId: stagedToolCall.toolExecutionId,
        toolName: toolCall.name,
        status: 'planned',
      });
    }
  }

  return { toolResultBlocks, toolExecutionIds, queuedToolJobs, approvalEvents, hasApprovalRequest };
}
