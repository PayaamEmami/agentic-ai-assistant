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
    deferDue: vi.fn(),
    updateSchedule: vi.fn(),
    createConversation: vi.fn(),
    deleteConversation: vi.fn(),
    createRun: vi.fn(),
    computeNextRunAt: vi.fn(),
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
    deferDue: mocks.deferDue,
    update: mocks.updateSchedule,
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
  computeNextRunAt: mocks.computeNextRunAt,
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
    mocks.deferDue.mockResolvedValue(true);
    mocks.computeNextRunAt.mockReturnValue(new Date('2026-10-16T12:00:00.000Z'));
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
    expect(mocks.deferDue).not.toHaveBeenCalled();
  });

  it('advances next_run_at when the daily cap is reached and does not enqueue', async () => {
    mocks.countRunsToday.mockResolvedValue(schedule.maxRunsPerDay);

    await scheduleDueAutomations({
      set: vi.fn().mockResolvedValue('OK'),
    } as never);

    expect(mocks.deferDue).toHaveBeenCalledWith(
      'schedule-1',
      expect.any(Date),
      new Date('2026-10-16T12:00:00.000Z'),
    );
    expect(mocks.claimDue).not.toHaveBeenCalled();
    expect(mocks.createRun).not.toHaveBeenCalled();
    expect(mocks.enqueueAutomationJob).not.toHaveBeenCalled();
  });

  it('leaves the slot due when a run is already in progress', async () => {
    mocks.hasActiveRunForSchedule.mockResolvedValue(true);

    await scheduleDueAutomations({
      set: vi.fn().mockResolvedValue('OK'),
    } as never);

    expect(mocks.deferDue).not.toHaveBeenCalled();
    expect(mocks.claimDue).not.toHaveBeenCalled();
    expect(mocks.createRun).not.toHaveBeenCalled();
  });

  it('disables the schedule when a capped fire has an invalid cron', async () => {
    mocks.countRunsToday.mockResolvedValue(schedule.maxRunsPerDay);
    mocks.computeNextRunAt.mockImplementation(() => {
      throw new Error('bad cron');
    });

    await scheduleDueAutomations({
      set: vi.fn().mockResolvedValue('OK'),
    } as never);

    expect(mocks.updateSchedule).toHaveBeenCalledWith('schedule-1', 'user-1', {
      enabled: false,
      nextRunAt: null,
    });
    expect(mocks.deferDue).not.toHaveBeenCalled();
    expect(mocks.claimDue).not.toHaveBeenCalled();
  });
});
