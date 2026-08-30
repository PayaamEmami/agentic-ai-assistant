import Redis from 'ioredis';
import type { WorkerConfig } from '@aaa/config';
import {
  automationRunRepository,
  automationScheduleRepository,
  conversationRepository,
  isPgUniqueViolation,
} from '@aaa/db';
import { computeNextRunAt, startOfDayInTimeZone } from '@aaa/shared';
import { logger } from './logger.js';
import { enqueueAutomationJob } from './job-queues.js';
import { publishAbandonedRuns } from '../jobs/automation/run-log.js';

const TICK_INTERVAL_MS = 60 * 1000;
const SCHEDULER_LOCK_KEY = 'aaa:automation-scheduler';
/**
 * Held for slightly less than one tick so a replica that dies mid-tick only
 * delays scheduling by one minute rather than stalling it until the TTL expires.
 */
const SCHEDULER_LOCK_TTL_SECONDS = 50;
/** A queued run with no worker pickup is almost certainly an enqueue miss. */
const QUEUED_STALE_MS = 15 * 60 * 1000;
/** Coding a card and opening a PR should finish well under this. */
const RUNNING_STALE_MS = 90 * 60 * 1000;

async function enqueueOrFailRun(
  runId: string,
  job: Parameters<typeof enqueueAutomationJob>[0],
): Promise<void> {
  try {
    await enqueueAutomationJob(job);
  } catch (error) {
    const failed = await automationRunRepository.failIfActive(
      runId,
      'Could not enqueue the automation job.',
    );
    if (failed) {
      await publishAbandonedRuns([failed]);
    }
    throw error;
  }
}

async function scheduleDueAutomations(redis: Redis): Promise<void> {
  const lock = await redis.set(SCHEDULER_LOCK_KEY, '1', 'EX', SCHEDULER_LOCK_TTL_SECONDS, 'NX');
  if (lock !== 'OK') {
    return;
  }

  const now = new Date();
  const staleRuns = await automationRunRepository.failStale(
    now,
    QUEUED_STALE_MS,
    RUNNING_STALE_MS,
  );
  if (staleRuns.length > 0) {
    logger.warn(
      {
        event: 'automation.schedule.stale_runs_failed',
        outcome: 'failure',
        count: staleRuns.length,
      },
      'Failed stale automation runs that never reached a terminal status',
    );
    await publishAbandonedRuns(staleRuns);
  }

  const due = await automationScheduleRepository.listDue(now);

  for (const schedule of due) {
    // Advance the schedule first. If enqueueing or the run itself fails, the
    // schedule still moves on rather than firing repeatedly every tick.
    let nextRunAt: Date | null = null;
    try {
      nextRunAt = computeNextRunAt(schedule.cron, schedule.timezone, now);
    } catch (error) {
      logger.error(
        {
          event: 'automation.schedule.invalid_cron',
          outcome: 'failure',
          scheduleId: schedule.id,
          error,
        },
        'Disabling automation schedule with an invalid cron expression',
      );
      await automationScheduleRepository.update(schedule.id, schedule.userId, {
        enabled: false,
        nextRunAt: null,
      });
      continue;
    }

    const claimed = await automationScheduleRepository.claimDue(schedule.id, now, nextRunAt);
    if (!claimed) {
      continue;
    }

    const runsToday = await automationScheduleRepository.countRunsToday(
      schedule.id,
      startOfDayInTimeZone(now, schedule.timezone),
    );
    if (runsToday >= schedule.maxRunsPerDay) {
      logger.info(
        {
          event: 'automation.schedule.rate_limited',
          outcome: 'success',
          scheduleId: schedule.id,
          runsToday,
          maxRunsPerDay: schedule.maxRunsPerDay,
        },
        'Skipping automation run: daily limit reached',
      );
      continue;
    }

    if (await automationRunRepository.hasActiveRunForSchedule(schedule.id)) {
      logger.info(
        {
          event: 'automation.schedule.already_running',
          outcome: 'success',
          scheduleId: schedule.id,
        },
        'Skipping automation run: a run is already in progress',
      );
      continue;
    }

    // The conversation exists before the job starts so the UI can subscribe to a
    // queued run and see its very first activity event.
    const conversation = await conversationRepository.create(
      schedule.userId,
      `Automation: ${schedule.name}`,
      true,
    );
    let run;
    try {
      run = await automationRunRepository.create({
        scheduleId: schedule.id,
        userId: schedule.userId,
        conversationId: conversation.id,
        trigger: 'schedule',
        dryRun: schedule.dryRun,
        boardId: schedule.boardId,
      });
    } catch (error) {
      if (isPgUniqueViolation(error)) {
        logger.info(
          {
            event: 'automation.schedule.already_running',
            outcome: 'success',
            scheduleId: schedule.id,
          },
          'Skipping automation run: a run is already in progress',
        );
        continue;
      }
      throw error;
    }

    await enqueueOrFailRun(run.id, {
      runId: run.id,
      scheduleId: schedule.id,
      userId: schedule.userId,
      correlationId: `automation-${run.id}`,
    });
  }
}

export interface AutomationScheduler {
  stop: () => void;
}

export function startAutomationScheduler(config: WorkerConfig): AutomationScheduler {
  const redis = new Redis(config.redisUrl, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });

  const tick = () => {
    void scheduleDueAutomations(redis).catch((error) => {
      logger.error(
        {
          event: 'automation.schedule.failed',
          outcome: 'failure',
          error,
        },
        'Automation scheduling tick failed',
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
