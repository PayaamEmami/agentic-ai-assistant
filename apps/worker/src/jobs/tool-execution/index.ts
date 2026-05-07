import type { Job } from 'bullmq';
import { conversationRepository, toolExecutionRepository } from '@aaa/db';
import type { ToolDoneEvent, ToolExecutionJobData, ToolStartEvent } from '@aaa/shared';
import { logger } from '../../lib/logger.js';
import { enqueueChatContinuationJob } from '../../lib/chat-continuation-queue.js';
import { publishToolEvent, updateInlineToolResult } from './events.js';
import { executeTool } from './handlers.js';
import type { ToolExecutionResult } from './types.js';

type ToolExecutionRecord = NonNullable<Awaited<ReturnType<typeof toolExecutionRepository.findById>>>;

interface FinalizeToolExecutionInput {
  toolExecutionId: string;
  toolName: string;
  conversationId: string;
  correlationId: string;
  messageId: string | null;
  originMode: ToolExecutionRecord['originMode'];
  result: ToolExecutionResult;
}

export async function finalizeToolExecution({
  toolExecutionId,
  toolName,
  conversationId,
  correlationId,
  messageId,
  originMode,
  result,
}: FinalizeToolExecutionInput): Promise<void> {
  const status = result.success ? 'completed' : 'failed';
  const output = result.success ? result.result : { error: result.error ?? 'Tool execution failed' };

  await toolExecutionRepository.updateStatus(toolExecutionId, status, output);
  await updateInlineToolResult(messageId, toolExecutionId, {
    status,
    output,
    detail: undefined,
  });

  const doneEvent: ToolDoneEvent = {
    type: 'tool.done',
    conversationId,
    toolExecutionId,
    toolName,
    output,
    status,
  };
  await publishToolEvent(doneEvent);

  if (originMode !== 'voice') {
    await enqueueChatContinuationJob({
      toolExecutionId,
      conversationId,
      correlationId,
    });
  } else {
    logger.info(
      {
        event: 'tool.execution.continuation_skipped',
        outcome: 'success',
        toolExecutionId,
        toolName,
        conversationId,
        correlationId,
        reason: 'voice_origin',
      },
      'Skipping HTTP continuation for voice-origin tool execution',
    );
  }

  if (result.success) {
    logger.info(
      {
        event: 'tool.execution.completed',
        outcome: 'success',
        toolExecutionId,
        toolName,
        conversationId,
        correlationId,
      },
      'Tool execution completed',
    );
    return;
  }

  logger.warn(
    {
      event: 'tool.execution.completed',
      outcome: 'failure',
      toolExecutionId,
      toolName,
      conversationId,
      correlationId,
      error: result.error,
    },
    'Tool execution failed',
  );
}

export async function handleToolExecution(job: Job<ToolExecutionJobData>): Promise<void> {
  const { toolExecutionId, toolName, conversationId, correlationId } = job.data;
  logger.info(
    {
      event: 'tool.execution.started',
      outcome: 'start',
      toolExecutionId,
      toolName,
      conversationId,
      jobId: job.id,
      correlationId,
    },
    'Processing tool execution job',
  );

  const execution = await toolExecutionRepository.findById(toolExecutionId);
  if (!execution) {
    logger.warn(
      {
        event: 'tool.execution.skipped',
        outcome: 'failure',
        toolExecutionId,
        conversationId,
        correlationId,
      },
      'Tool execution row not found',
    );
    return;
  }

  const conversation = await conversationRepository.findById(conversationId);
  if (!conversation) {
    throw new Error(`Conversation not found for tool execution: ${conversationId}`);
  }

  await toolExecutionRepository.updateStatus(toolExecutionId, 'running');
  await updateInlineToolResult(execution.messageId, toolExecutionId, {
    status: 'running',
    detail: undefined,
    output: undefined,
  });

  const startEvent: ToolStartEvent = {
    type: 'tool.start',
    conversationId,
    toolExecutionId,
    toolName,
    input: execution.input,
  };
  await publishToolEvent(startEvent);

  const result = await executeTool(
    conversation.userId,
    conversationId,
    toolExecutionId,
    toolName,
    job.data.input,
    execution.messageId,
  );

  await finalizeToolExecution({
    toolExecutionId,
    toolName,
    conversationId,
    correlationId,
    messageId: execution.messageId,
    originMode: execution.originMode,
    result,
  });
}
