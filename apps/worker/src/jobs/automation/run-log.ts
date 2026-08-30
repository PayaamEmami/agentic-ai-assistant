import {
  automationRunEventRepository,
  automationRunRepository,
  getPool,
  type AutomationRun,
} from '@aaa/db';
import type {
  AutomationRunActivityEvent,
  AutomationRunStage,
  AutomationRunStatusEvent,
} from '@aaa/shared';
import { AUTOMATION_RUN_STAGE_LABELS } from '@aaa/shared';
import { logger } from '../../lib/logger.js';

export const AUTOMATION_EVENT_CHANNEL = 'automation_run_events';

type RunEventKind = 'stage' | 'thought' | 'progress' | 'result';

/** Thrown when a worker continues after the sweeper has already failed the run. */
export class AutomationRunAbandonedError extends Error {
  constructor(runId: string) {
    super(`Automation run ${runId} is no longer active`);
    this.name = 'AutomationRunAbandonedError';
  }
}

async function notify(
  event: AutomationRunActivityEvent | AutomationRunStatusEvent,
): Promise<void> {
  try {
    await getPool().query('SELECT pg_notify($1, $2)', [
      AUTOMATION_EVENT_CHANNEL,
      JSON.stringify(event),
    ]);
  } catch (error) {
    // A dropped notification only costs live updates; the row is already
    // persisted, so the UI still sees it on replay.
    logger.warn(
      {
        event: 'automation.run.notify_failed',
        outcome: 'failure',
        automationRunId: event.runId,
        error,
      },
      'Failed to publish automation run event',
    );
  }
}

/**
 * Writes and streams one run's activity log.
 *
 * Every entry is persisted before being published so a browser that connects
 * mid-run can replay the log and then follow along live. Entries are coarse (one
 * per stage or decision), never per model token.
 */
export class AutomationRunLog {
  constructor(
    private readonly runId: string,
    private readonly conversationId: string,
  ) {}

  async append(
    kind: RunEventKind,
    message: string,
    stage?: string | null,
    options?: { heartbeat?: boolean },
  ): Promise<void> {
    if (options?.heartbeat !== false) {
      const alive = await automationRunRepository.touch(this.runId);
      if (!alive) {
        return;
      }
    }

    try {
      const row = await automationRunEventRepository.append({
        runId: this.runId,
        kind,
        message,
        stage: stage ?? null,
      });

      await notify({
        type: 'automation.run.event',
        conversationId: this.conversationId,
        runId: this.runId,
        seq: row.seq,
        at: row.at.toISOString(),
        kind,
        stage: row.stage,
        message: row.message,
      });
    } catch (error) {
      logger.warn(
        {
          event: 'automation.run.log_failed',
          outcome: 'failure',
          automationRunId: this.runId,
          error,
        },
        'Failed to record automation run event',
      );
    }
  }

  /** Records a stage transition on both the run row and its activity log. */
  async enterStage(stage: AutomationRunStage): Promise<void> {
    const updated = await automationRunRepository.update(
      this.runId,
      {
        status: 'running',
        currentStage: stage,
      },
      { requireActive: true },
    );
    if (!updated) {
      throw new AutomationRunAbandonedError(this.runId);
    }

    await this.append('stage', AUTOMATION_RUN_STAGE_LABELS[stage], stage);
    await notify({
      type: 'automation.run.status',
      conversationId: this.conversationId,
      runId: this.runId,
      status: 'running',
      stage,
    });
  }

  async thought(message: string): Promise<void> {
    await this.append('thought', message);
  }

  async progress(message: string, stage?: AutomationRunStage): Promise<void> {
    await this.append('progress', message, stage);
  }

  async result(message: string): Promise<void> {
    await this.append('result', message);
  }

  async finish(
    status: 'completed' | 'skipped' | 'failed',
    details: {
      message: string;
      pullRequestUrl?: string | null;
      skipReason?: string | null;
      error?: string | null;
    },
  ): Promise<boolean> {
    const updated = await automationRunRepository.update(
      this.runId,
      {
        status,
        currentStage: null,
        completedAt: new Date(),
        pullRequestUrl: details.pullRequestUrl ?? undefined,
        skipReason: details.skipReason ?? undefined,
        error: details.error ?? undefined,
      },
      { requireActive: true },
    );
    if (!updated) {
      return false;
    }

    await this.append('result', details.message, null, { heartbeat: false });
    await notify({
      type: 'automation.run.status',
      conversationId: this.conversationId,
      runId: this.runId,
      status,
      stage: null,
      pullRequestUrl: details.pullRequestUrl ?? null,
      skipReason: details.skipReason ?? null,
      error: details.error ?? null,
    });
    return true;
  }

  /**
   * Fails a run only if it is still queued or running. Used when a worker job
   * is abandoned (stall, crash, enqueue miss) so a late failure cannot overwrite
   * a run that already completed.
   */
  async failIfActive(message: string): Promise<boolean> {
    const updated = await automationRunRepository.failIfActive(this.runId, message);
    if (!updated) {
      return false;
    }

    await this.append('result', message, null, { heartbeat: false });
    await notify({
      type: 'automation.run.status',
      conversationId: this.conversationId,
      runId: this.runId,
      status: 'failed',
      stage: null,
      error: message,
    });
    return true;
  }
}

/** Persists and broadcasts sweeper timeouts so the UI does not stay on "running". */
export async function publishAbandonedRuns(runs: AutomationRun[]): Promise<void> {
  for (const run of runs) {
    if (!run.conversationId) {
      continue;
    }

    const message =
      run.error ?? 'Run did not finish before it timed out. The worker may have crashed.';
    try {
      const row = await automationRunEventRepository.append({
        runId: run.id,
        kind: 'result',
        message,
      });
      await notify({
        type: 'automation.run.event',
        conversationId: run.conversationId,
        runId: run.id,
        seq: row.seq,
        at: row.at.toISOString(),
        kind: 'result',
        stage: row.stage,
        message: row.message,
      });
      await notify({
        type: 'automation.run.status',
        conversationId: run.conversationId,
        runId: run.id,
        status: 'failed',
        stage: null,
        error: message,
      });
    } catch (error) {
      logger.warn(
        {
          event: 'automation.run.stale_notify_failed',
          outcome: 'failure',
          automationRunId: run.id,
          error,
        },
        'Failed to publish a stale automation run failure',
      );
    }
  }
}
