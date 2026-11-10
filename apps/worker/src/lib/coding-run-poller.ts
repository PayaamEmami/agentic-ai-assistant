import Redis from 'ioredis';
import type { WorkerConfig } from '@aaa/config';
import {
  automationRunRepository,
  codingRunRepository,
  conversationRepository,
  toolExecutionRepository,
  type CodingRun,
} from '@aaa/db';
import type { ToolDoneEvent } from '@aaa/shared';
import { createCodingAgent, type CodingAgent, type CodingAgentSnapshot } from '@aaa/tool-providers';
import { publishToolEvent, updateInlineToolResult } from '../jobs/tool-execution/events.js';
import { enqueueChatContinuationJob } from './chat-continuation-queue.js';
import { logger } from './logger.js';

const TICK_INTERVAL_MS = 15 * 1000;
const POLLER_LOCK_KEY = 'aaa:coding-run-poller';
const POLLER_LOCK_TTL_SECONDS = 12;
export const CODING_RUN_TIMEOUT_MS = 2 * 60 * 60 * 1000;

export async function pollCodingRuns(agent: CodingAgent, now = new Date()): Promise<void> {
  const runs = await codingRunRepository.listRunning();
  for (const run of runs) {
    if (now.getTime() - run.createdAt.getTime() >= CODING_RUN_TIMEOUT_MS) {
      await finishCodingRun(run, {
        status: 'error',
        summary: 'The coding task did not finish.',
      });
      continue;
    }

    await refreshAutomationHeartbeat(run.conversationId);

    try {
      const snapshot = await agent.fetch(run.externalId);
      if (snapshot.status === 'running') {
        continue;
      }
      await finishCodingRun(run, snapshot);
    } catch (error) {
      logger.warn(
        {
          event: 'coding_run.poll_failed',
          outcome: 'failure',
          codingRunId: run.id,
          externalId: run.externalId,
          error,
        },
        'Coding run status check failed',
      );
    }
  }
}

export async function finishCodingRun(run: CodingRun, snapshot: CodingAgentSnapshot): Promise<void> {
  const success = snapshot.status === 'finished';
  const summary =
    snapshot.summary?.trim() ||
    (success ? 'The coding task finished.' : 'The coding task failed.');
  const output = success
    ? {
        summary,
        repo: run.repo,
        ...(snapshot.branch ? { branch: snapshot.branch } : {}),
        ...(snapshot.pullRequestUrl ? { pullRequestUrl: snapshot.pullRequestUrl } : {}),
      }
    : { error: summary };

  const execution = await toolExecutionRepository.finishIfRunning(
    run.toolExecutionId,
    success ? 'completed' : 'failed',
    output,
  );
  await codingRunRepository.settleIfRunning(run.id, {
    status: success ? 'finished' : 'error',
    summary,
    branch: snapshot.branch ?? null,
    pullRequestUrl: snapshot.pullRequestUrl ?? null,
  });
  if (!execution) {
    return;
  }

  await updateInlineToolResult(execution.messageId, run.toolExecutionId, {
    status: success ? 'completed' : 'failed',
    output,
    detail: undefined,
  });

  const doneEvent: ToolDoneEvent = {
    type: 'tool.done',
    conversationId: run.conversationId,
    toolExecutionId: run.toolExecutionId,
    toolName: execution.toolName,
    output,
    status: success ? 'completed' : 'failed',
  };
  await publishToolEvent(doneEvent);

  if (execution.originMode === 'voice') {
    return;
  }

  await enqueueChatContinuationJob({
    toolExecutionId: run.toolExecutionId,
    conversationId: run.conversationId,
    correlationId: run.correlationId,
  });
}

async function refreshAutomationHeartbeat(conversationId: string): Promise<void> {
  const conversation = await conversationRepository.findById(conversationId);
  if (!conversation?.isAutomation) {
    return;
  }
  const activeRun = await automationRunRepository.findActiveByConversation(conversationId);
  if (activeRun) {
    await automationRunRepository.touch(activeRun.id);
  }
}

export interface CodingRunPoller {
  stop: () => void;
}

export function startCodingRunPoller(config: WorkerConfig): CodingRunPoller {
  if (!config.cursorApiKey) {
    logger.warn(
      {
        event: 'coding_run.poller_disabled',
        outcome: 'failure',
      },
      'Coding agent API key is not set; repository tasks cannot run',
    );
    return { stop: () => undefined };
  }

  const agent = createCodingAgent({
    provider: config.codingAgentProvider,
    apiKey: config.cursorApiKey,
  });
  const redis = new Redis(config.redisUrl, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });

  const tick = () => {
    void pollWithLock(redis, agent).catch((error) => {
      logger.error(
        {
          event: 'coding_run.poll_tick_failed',
          outcome: 'failure',
          error,
        },
        'Coding run poll tick failed',
      );
    });
  };

  tick();
  const interval = setInterval(tick, TICK_INTERVAL_MS);
  return {
    stop: () => {
      clearInterval(interval);
      redis.disconnect();
    },
  };
}

async function pollWithLock(redis: Redis, agent: CodingAgent): Promise<void> {
  const lock = await redis.set(POLLER_LOCK_KEY, '1', 'EX', POLLER_LOCK_TTL_SECONDS, 'NX');
  if (lock !== 'OK') {
    return;
  }
  await pollCodingRuns(agent);
}
