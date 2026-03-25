import { Queue } from 'bullmq';
import { getLogContext, getLogger } from '@aaa/observability';

export interface ToolExecutionJobData {
  toolExecutionId: string;
  toolName: string;
  input: Record<string, unknown>;
  conversationId: string;
  correlationId: string;
}

let queue: Queue<ToolExecutionJobData> | null = null;

function parseRedisUrl(url: string): { host: string; port: number; password?: string } {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || '6379', 10),
    password: parsed.password || undefined,
  };
}

function getQueue(): Queue<ToolExecutionJobData> {
  if (!queue) {
    queue = new Queue<ToolExecutionJobData>('tool-execution', {
      connection: parseRedisUrl(process.env.REDIS_URL ?? 'redis://localhost:6379'),
    });
  }
  return queue;
}

export async function enqueueToolExecutionJob(job: ToolExecutionJobData): Promise<void> {
  const correlationId =
    job.correlationId || getLogContext().correlationId || `tool-${job.toolExecutionId}`;
  const payload = {
    ...job,
    correlationId,
  };

  await getQueue().add('execute-tool', payload, {
    removeOnComplete: 100,
    removeOnFail: 500,
  });
  getLogger({
    component: 'tool-execution-queue',
    toolExecutionId: job.toolExecutionId,
    conversationId: job.conversationId,
    correlationId,
  }).info(
    {
      event: 'tool.execution.enqueued',
      outcome: 'accepted',
      toolName: job.toolName,
    },
    'Tool execution job enqueued',
  );
}

export async function closeToolExecutionQueue(): Promise<void> {
  if (!queue) {
    return;
  }

  await queue.close();
  queue = null;
}
