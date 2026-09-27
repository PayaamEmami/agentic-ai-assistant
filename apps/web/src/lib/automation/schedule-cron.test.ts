import { describe, expect, it } from 'vitest';
import { cronForTiming, describeTiming, timingFromCron } from './schedule-cron';

describe('schedule cron', () => {
  it('builds daily, weekday, weekly, and hourly expressions', () => {
    expect(
      cronForTiming({ cadence: 'daily', time: '09:05', weekday: '1', cron: '' }),
    ).toBe('5 9 * * *');
    expect(
      cronForTiming({ cadence: 'weekdays', time: '08:00', weekday: '1', cron: '' }),
    ).toBe('0 8 * * 1-5');
    expect(
      cronForTiming({ cadence: 'weekly', time: '18:30', weekday: '5', cron: '' }),
    ).toBe('30 18 * * 5');
    expect(
      cronForTiming({ cadence: 'hourly', time: '09:00', weekday: '1', cron: '' }),
    ).toBe('0 * * * *');
  });

  it('round-trips the supported cadences', () => {
    expect(timingFromCron('0 9 * * *').cadence).toBe('daily');
    expect(timingFromCron('0 9 * * *').time).toBe('09:00');
    expect(timingFromCron('15 14 * * 1-5').cadence).toBe('weekdays');
    expect(timingFromCron('0 9 * * 1').cadence).toBe('weekly');
    expect(timingFromCron('0 9 * * 1').weekday).toBe('1');
    expect(timingFromCron('0 * * * *').cadence).toBe('hourly');
    expect(timingFromCron('*/15 * * * *').cadence).toBe('custom');
  });

  it('describes a schedule in plain language', () => {
    expect(describeTiming('30 18 * * 5', 'America/Los_Angeles')).toBe(
      'Every Friday at 18:30 (America/Los_Angeles)',
    );
    expect(describeTiming('0 * * * *', 'UTC')).toBe('Hourly (UTC)');
  });
});
