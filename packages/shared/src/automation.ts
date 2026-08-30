import { CronExpressionParser } from 'cron-parser';

export const AUTOMATION_RUN_STATUSES = [
  'queued',
  'running',
  'completed',
  'skipped',
  'failed',
] as const;

export type AutomationRunStatus = (typeof AUTOMATION_RUN_STATUSES)[number];

/**
 * Ordered stages of a board-task run. The UI shows the current stage next to a
 * running run, so the order here is the order the user sees.
 */
export const AUTOMATION_RUN_STAGES = [
  'connecting',
  'reading_board',
  'selecting_card',
  'implementing',
  'opening_pull_request',
  'reporting_back',
] as const;

export type AutomationRunStage = (typeof AUTOMATION_RUN_STAGES)[number];

export const AUTOMATION_RUN_EVENT_KINDS = [
  'stage',
  'thought',
  'progress',
  'result',
] as const;

export type AutomationRunEventKind = (typeof AUTOMATION_RUN_EVENT_KINDS)[number];

export const AUTOMATION_RUN_STAGE_LABELS: Record<AutomationRunStage, string> = {
  connecting: 'Connecting to task board',
  reading_board: 'Reading board',
  selecting_card: 'Choosing a card',
  implementing: 'Writing code',
  opening_pull_request: 'Opening pull request',
  reporting_back: 'Updating the card',
};

export class InvalidCronExpressionError extends Error {
  constructor(cron: string, cause: unknown) {
    super(
      `"${cron}" is not a valid cron expression: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    this.name = 'InvalidCronExpressionError';
  }
}

/**
 * Resolves the next fire time for a cron expression in a given timezone.
 *
 * Schedules store `next_run_at` as an absolute timestamp so the scheduler query
 * stays a simple indexed comparison; this is what recomputes it after each run.
 */
export function computeNextRunAt(cron: string, timezone = 'UTC', from = new Date()): Date {
  try {
    return CronExpressionParser.parse(cron, { currentDate: from, tz: timezone })
      .next()
      .toDate();
  } catch (error) {
    throw new InvalidCronExpressionError(cron, error);
  }
}

export function isValidCronExpression(cron: string, timezone = 'UTC'): boolean {
  try {
    computeNextRunAt(cron, timezone);
    return true;
  } catch {
    return false;
  }
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);

  const parts = Object.fromEntries(
    formatted.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - date.getTime();
}

/**
 * Start of the calendar day containing `date` in `timeZone`, as a UTC instant.
 * Used so `max_runs_per_day` counts in the schedule's timezone rather than UTC.
 */
export function startOfDayInTimeZone(date: Date, timeZone: string): Date {
  const offset = timeZoneOffsetMs(date, timeZone);
  const local = new Date(date.getTime() + offset);
  const midnightUtcMs =
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - offset;
  const midnight = new Date(midnightUtcMs);
  const midnightOffset = timeZoneOffsetMs(midnight, timeZone);
  return new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - midnightOffset,
  );
}

