import { approvalRepository, toolExecutionRepository } from '@aaa/db';
import { getLogContext } from '@aaa/observability';
import type { ApprovalRequestedEvent } from '@aaa/shared';
import { broadcast } from '../ws/connections.js';
import { enqueueToolExecutionJob } from './tool-execution-queue.js';
import type { AvailableTool } from './tools-loader.js';

function getStringField(input: Record<string, unknown>, key: string): string | null {
  const value = input[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function getNumberField(input: Record<string, unknown>, key: string): number | null {
  const value = input[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function truncateLabel(value: string, maxLength = 80): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

export function buildApprovalDescription(
  tool: AvailableTool,
  input: Record<string, unknown>,
): string {
  const repo = getStringField(input, 'repo');
  const repoSuffix = repo ? ` in ${repo}` : '';
  const pullNumber = getNumberField(input, 'pullNumber');
  const pullSuffix = pullNumber !== null ? ` for PR #${pullNumber}` : '';

  switch (tool.name) {
    case 'external.execute': {
      const operation = getStringField(input, 'operation');
      return operation ? `Allow external action: ${operation}` : 'Allow this external action';
    }
    case 'github.create_pull_request':
      return `Allow creating a pull request${repoSuffix}`;
    case 'github.update_pull_request':
      return `Allow updating a pull request${pullSuffix}${repoSuffix}`;
    case 'github.add_pull_request_comment':
      return `Allow posting a pull request comment${pullSuffix}${repoSuffix}`;
    case 'github.reply_to_review_comment':
      return `Allow replying to a review comment${pullSuffix}${repoSuffix}`;
    case 'github.submit_pull_request_review': {
      const event = getStringField(input, 'event');
      if (event === 'APPROVE') {
        return `Allow approving a pull request${pullSuffix}${repoSuffix}`;
      }
      if (event === 'REQUEST_CHANGES') {
        return `Allow requesting changes on a pull request${pullSuffix}${repoSuffix}`;
      }
      return `Allow submitting a pull request review${pullSuffix}${repoSuffix}`;
    }
    case 'github.coding_task': {
      const task = getStringField(input, 'task');
      return task
        ? `Allow running this coding task${repoSuffix}: ${truncateLabel(task)}`
        : `Allow running this coding task${repoSuffix}`;
    }
    case 'google_drive.create_text_file': {
      const name = getStringField(input, 'name');
      return name
        ? `Allow creating "${name}" in Google Drive`
        : 'Allow creating a file in Google Drive';
    }
    case 'google_drive.update_text_file':
      return 'Allow updating this Google Drive file';
    case 'google_drive.rename_file': {
      const name = getStringField(input, 'name');
      return name
        ? `Allow renaming this Google Drive file to "${name}"`
        : 'Allow renaming this Google Drive file';
    }
    case 'google_drive.move_file':
      return 'Allow moving this Google Drive file';
    case 'google_drive.trash_file':
      return 'Allow moving this Google Drive file to trash';
    case 'google_docs.create_document': {
      const title = getStringField(input, 'title');
      return title ? `Allow creating the Google Doc "${title}"` : 'Allow creating a Google Doc';
    }
    case 'google_docs.batch_update_document':
      return 'Allow updating this Google Doc';
    default:
      return `Allow ${tool.description.charAt(0).toLowerCase()}${tool.description.slice(1)}`;
  }
}

export interface CreateToolCallOptions {
  conversationId: string;
  userId: string;
  tool: AvailableTool;
  input: Record<string, unknown>;
  messageId?: string | null;
  originMode: 'text' | 'voice';
}

export interface CreateToolCallResult {
  toolExecutionId: string;
  status: 'requires_approval' | 'pending' | 'running';
  approvalId?: string;
}

/**
 * Creates a tool_executions row and either requests approval or enqueues the
 * execution job. Shared between text-chat flow and voice.
 */
export async function createToolCall(
  options: CreateToolCallOptions,
): Promise<CreateToolCallResult> {
  const { conversationId, userId, tool, input, messageId, originMode } = options;

  const toolExecution = await toolExecutionRepository.create(
    conversationId,
    messageId ?? null,
    tool.name,
    input,
    { originMode },
  );

  if (tool.requiresApproval) {
    await toolExecutionRepository.updateStatus(toolExecution.id, 'requires_approval');
    const approval = await approvalRepository.create(
      userId,
      conversationId,
      toolExecution.id,
      buildApprovalDescription(tool, input),
    );
    await toolExecutionRepository.setApproval(toolExecution.id, approval.id);

    const approvalEvent: ApprovalRequestedEvent = {
      type: 'approval.requested',
      conversationId,
      approvalId: approval.id,
      toolExecutionId: toolExecution.id,
      description: approval.description,
    };
    broadcast(conversationId, approvalEvent);

    return {
      toolExecutionId: toolExecution.id,
      status: 'requires_approval',
      approvalId: approval.id,
    };
  }

  await enqueueToolExecutionJob({
    toolExecutionId: toolExecution.id,
    toolName: tool.name,
    input,
    conversationId,
    correlationId:
      getLogContext().correlationId ?? `${originMode}-${conversationId}-${toolExecution.id}`,
  });

  return {
    toolExecutionId: toolExecution.id,
    status: 'pending',
  };
}
