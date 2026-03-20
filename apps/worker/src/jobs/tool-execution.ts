import type { Job } from 'bullmq';
import { getPool, messageRepository, toolExecutionRepository } from '@aaa/db';
import { getConfiguredToolRegistry } from '@aaa/mcp';
import type { ToolDoneEvent, ToolStartEvent } from '@aaa/shared';
import { logger } from '../lib/logger.js';

export interface ToolExecutionJobData {
  toolExecutionId: string;
  toolName: string;
  input: Record<string, unknown>;
  conversationId: string;
}

const TOOL_EVENT_CHANNEL = 'tool_execution_events';

async function publishToolEvent(event: ToolStartEvent | ToolDoneEvent): Promise<void> {
  const pool = getPool();
  await pool.query('SELECT pg_notify($1, $2)', [
    TOOL_EVENT_CHANNEL,
    JSON.stringify(event),
  ]);
}

function toNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === 'number' ? entry : Number.NaN))
    .filter((entry) => Number.isFinite(entry));
}

async function executeNativeTool(
  toolName: string,
  input: Record<string, unknown>,
): Promise<{ success: boolean; result: unknown; error?: string }> {
  switch (toolName) {
    case 'echo': {
      return { success: true, result: { echo: input['text'] ?? input['message'] ?? null } };
    }
    case 'sum': {
      const numbers = toNumberArray(input['numbers']);
      if (numbers.length === 0) {
        return { success: false, result: null, error: 'sum tool expects "numbers": number[]' };
      }
      const total = numbers.reduce((acc, current) => acc + current, 0);
      return { success: true, result: { total, count: numbers.length } };
    }
    case 'time.now': {
      return { success: true, result: { iso: new Date().toISOString() } };
    }
    case 'external.action': {
      return {
        success: true,
        result: {
          accepted: true,
          action: input['action'] ?? null,
          payload: input['payload'] ?? null,
          note: 'Simulated external action execution completed.',
        },
      };
    }
    default:
      return { success: false, result: null, error: `Unknown tool: ${toolName}` };
  }
}

async function executeTool(
  origin: string,
  toolName: string,
  input: Record<string, unknown>,
): Promise<{ success: boolean; result: unknown; error?: string }> {
  if (origin === 'mcp') {
    const registry = await getConfiguredToolRegistry();
    return registry.executeTool({
      toolName,
      arguments: input,
    });
  }

  return executeNativeTool(toolName, input);
}

export async function handleToolExecution(job: Job<ToolExecutionJobData>): Promise<void> {
  const { toolExecutionId, toolName, conversationId } = job.data;
  logger.info({ toolExecutionId, toolName, conversationId, jobId: job.id }, 'Processing tool execution job');

  const execution = await toolExecutionRepository.findById(toolExecutionId);
  if (!execution) {
    logger.warn({ toolExecutionId, conversationId }, 'Tool execution row not found');
    return;
  }

  await toolExecutionRepository.updateStatus(toolExecutionId, 'running');
  await messageRepository.create(conversationId, 'tool', [
    {
      type: 'tool_result',
      toolExecutionId,
      toolName,
      status: 'running',
    },
  ]);

  const startEvent: ToolStartEvent = {
    type: 'tool.start',
    conversationId,
    toolExecutionId,
    toolName,
    input: execution.input,
  };
  await publishToolEvent(startEvent);

  const result = await executeTool(execution.origin, toolName, job.data.input);

  if (result.success) {
    await toolExecutionRepository.updateStatus(toolExecutionId, 'completed', result.result);
    await messageRepository.create(conversationId, 'tool', [
      {
        type: 'tool_result',
        toolExecutionId,
        toolName,
        status: 'completed',
        output: result.result,
      },
    ]);

    const doneEvent: ToolDoneEvent = {
      type: 'tool.done',
      conversationId,
      toolExecutionId,
      toolName,
      output: result.result,
      status: 'completed',
    };
    await publishToolEvent(doneEvent);
    return;
  }

  const errorOutput = { error: result.error ?? 'Tool execution failed' };
  await toolExecutionRepository.updateStatus(toolExecutionId, 'failed', errorOutput);
  await messageRepository.create(conversationId, 'tool', [
    {
      type: 'tool_result',
      toolExecutionId,
      toolName,
      status: 'failed',
      output: errorOutput,
    },
  ]);

  const doneEvent: ToolDoneEvent = {
    type: 'tool.done',
    conversationId,
    toolExecutionId,
    toolName,
    output: errorOutput,
    status: 'failed',
  };
  await publishToolEvent(doneEvent);
}
