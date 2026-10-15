import { beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduleDueAutomations } from './automation-scheduler.js';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    failStale: vi.fn(),
    listDue: vi.fn(),
    countRunsToday: vi.fn(),
    hasActiveRunForSchedule: vi.fn(),
    claimDue: vi.fn(),
    restoreClaim: vi.fn(),
    createConversation: vi.fn(),
    deleteConversation: vi.fn(),
    createRun: vi.fn(),
    loggerInfo: vi.fn(),
    loggerError: vi.fn(),
    loggerWarn: vi.fn(),
    enqueueAutomationJob: vi.fn(),
    publishAbandonedRuns: vi.fn(),
  },
}));

vi.mock('@aaa/db', () => ({
  automationRunRepository: {
    failStale: mocks.failStale,
    hasActiveRunForSchedule: mocks.hasActiveRunForSchedule,
    create: mocks.createRun,
  },
  automationScheduleRepository: {
    listDue: mocks.listDue,
    countRunsToday: mocks.countRunsToday,
    claimDue: mocks.claimDue,
    restoreClaim: mocks.restoreClaim,
  },
  conversationRepository: {
    create: mocks.createConversation,
    delete: mocks.deleteConversation,
  },
  isPgUniqueViolation: (error: unknown) =>
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === '23505',
}));

vi.mock('./logger.js', () => ({
  logger: {
    info: mocks.loggerInfo,
    error: mocks.loggerError,
    warn: mocks.loggerWarn,
  },
}));

vi.mock('./job-queues.js', () => ({
  enqueueAutomationJob: mocks.enqueueAutomationJob,
}));

vi.mock('../jobs/automation/run-log.js', () => ({
  publishAbandonedRuns: mocks.publishAbandonedRuns,
}));

vi.mock('@aaa/shared', () => ({
  computeNextRunAt: () => new Date('2026-10-16T12:00:00.000Z'),
  startOfDayInTimeZone: () => new Date('2026-10-15T00:00:00.000Z'),
}));

describe('scheduleDueAutomations', () => {
  const dueAt = new Date('2026-10-15T12:00:00.000Z');
  const schedule = {
    id: 'schedule-1',
    userId: 'user-1',
    name: 'Daily briefing',
    prompt: 'Summarize the board',
    cron: '0 12 * * *',
    timezone: 'UTC',
    enabled: true,
    maxRunsPerDay: 8,
    lastRunAt: new Date('2026-10-14T12:00:00.000Z'),
    nextRunAt: dueAt,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.failStale.mockResolvedValue([]);
    mocks.listDue.mockResolvedValue([schedule]);
    mocks.countRunsToday.mockResolvedValue(0);
    mocks.hasActiveRunForSchedule.mockResolvedValue(false);
    mocks.claimDue.mockResolvedValue(true);
    mocks.createConversation.mockResolvedValue({ id: 'conversation-1' });
  });

  it('restores next_run_at when run insert hits the active-run unique constraint', async () => {
    mocks.createRun.mockRejectedValue({ code: '23505' });

    await scheduleDueAutomations({
      set: vi.fn().mockResolvedValue('OK'),
    } as never);

    expect(mocks.restoreClaim).toHaveBeenCalledWith(
      'schedule-1',
      schedule.lastRunAt,
      schedule.nextRunAt,
    );
    expect(mocks.deleteConversation).toHaveBeenCalledWith('conversation-1');
    expect(mocks.enqueueAutomationJob).not.toHaveBeenCalled();
  });
});
