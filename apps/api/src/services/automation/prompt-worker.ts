import { Worker, type Job } from 'bullmq';
import { QUEUE_NAMES, parseRedisUrl } from '@aaa/config';
import { AutomationRunLog, automationRunRepository, automationScheduleRepository } from '@aaa/db';
import { getLogger, withLogContext, withSpan } from '@aaa/observability';
import type { AutomationJobData } from '@aaa/shared';
import type { AppConfig } from '../../config.js';
import type { ChatService } from '../chat/service.js';

const LOCK_MS = 5 * 60 * 1000;

let worker: Worker<AutomationJobData> | null = null;

async function runScheduledPrompt(
  chatService: ChatService,
  job: Job<AutomationJobData>,
): Promise<void> {
  const run = await automationRunRepository.findById(job.data.runId);
  if (!run || (run.status !== 'queued' && run.status !== 'running')) {
    return;
  }

  if (!run.conversationId) {
    await automationRunRepository.failIfActive(run.id, 'The run has no conversation.');
    return;
  }

  const schedule = await automationScheduleRepository.findById(job.data.scheduleId);
  const log = new AutomationRunLog(run.id, run.conversationId);
  if (!schedule || schedule.userId !== job.data.userId) {
    await log.failIfActive('Schedule no longer exists.');
    return;
  }

  await log.enterStage('running_prompt');
  try {
    await chatService.runScheduledPrompt(
      job.data.userId,
      run.conversationId,
      schedule.prompt,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The scheduled prompt failed.';
    await log.failIfActive(message);
    throw error;
  }
}

export function startAutomationPromptWorker(
  config: AppConfig,
  chatService: ChatService,
): Worker<AutomationJobData> {
  if (worker) {
    return worker;
  }

  worker = new Worker<AutomationJobData>(
    QUEUE_NAMES.automation,
    (job) =>
      withLogContext(
        {
          component: 'automation-prompt-worker',
          queue: job.queueName,
          jobId: job.id ?? undefined,
          correlationId: job.data.correlationId,
        },
        () =>
          withSpan(
            'worker.job.automation',
            {
              'aaa.queue.name': job.queueName,
              'aaa.job.id': job.id ?? 'unknown',
            },
            () => runScheduledPrompt(chatService, job),
          ),
      ),
    {
      connection: parseRedisUrl(config.redisUrl),
      lockDuration: LOCK_MS,
    },
  );

  worker.on('failed', (job, error) => {
    getLogger({
      component: 'automation-prompt-worker',
      queue: job?.queueName,
      jobId: job?.id,
      correlationId: job?.data?.correlationId,
    }).error(
      {
        event: 'automation.run.failed',
        outcome: 'failure',
        automationRunId: job?.data?.runId,
        scheduleId: job?.data?.scheduleId,
        error,
      },
      'Scheduled prompt job failed',
    );
  });

  return worker;
}

export async function stopAutomationPromptWorker(): Promise<void> {
  if (!worker) {
    return;
  }
  const current = worker;
  worker = null;
  await current.close();
}
