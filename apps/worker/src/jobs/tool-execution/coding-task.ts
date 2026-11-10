import { codingRunRepository } from '@aaa/db';
import type { ToolProgressEvent } from '@aaa/shared';
import { CodingAgentError, type CodingAgent } from '@aaa/tool-providers';
import { logger } from '../../lib/logger.js';
import { publishToolEvent, updateInlineToolResult } from './events.js';
import type { ToolExecutionResult } from './types.js';

export interface AcceptCodingTaskInput {
  agent: CodingAgent;
  userId: string;
  conversationId: string;
  toolExecutionId: string;
  toolName: string;
  messageId: string | null;
  correlationId: string;
  repo: string;
  task: string;
  baseBranch?: string;
  pullRequestUrl?: string;
}

export async function acceptCodingTask(input: AcceptCodingTaskInput): Promise<ToolExecutionResult> {
  let externalId: string;
  try {
    const started = await input.agent.start({
      repo: input.repo,
      task: input.task,
      baseBranch: input.baseBranch,
      pullRequestUrl: input.pullRequestUrl,
    });
    externalId = started.externalId;
  } catch (error) {
    const agentError =
      error instanceof CodingAgentError
        ? error
        : new CodingAgentError(error instanceof Error ? error.message : String(error));
    logger.warn(
      {
        event: 'coding_run.start_failed',
        outcome: 'failure',
        toolExecutionId: input.toolExecutionId,
        conversationId: input.conversationId,
        repo: input.repo,
        error: agentError.message,
      },
      'Coding task could not start',
    );
    return { success: false, result: null, error: agentError.userMessage };
  }

  await codingRunRepository.create({
    userId: input.userId,
    conversationId: input.conversationId,
    toolExecutionId: input.toolExecutionId,
    providerId: input.agent.providerId,
    externalId,
    repo: input.repo,
    correlationId: input.correlationId,
  });

  const detail = `Working on ${input.repo}`;
  await updateInlineToolResult(input.messageId, input.toolExecutionId, {
    status: 'running',
    detail,
  });
  const event: ToolProgressEvent = {
    type: 'tool.progress',
    conversationId: input.conversationId,
    toolExecutionId: input.toolExecutionId,
    toolName: input.toolName,
    phase: 'running',
    message: detail,
  };
  await publishToolEvent(event);

  return { deferred: true };
}
