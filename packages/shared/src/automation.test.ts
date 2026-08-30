import { describe, expect, it } from 'vitest';
import { startOfDayInTimeZone } from './automation.js';

describe('startOfDayInTimeZone', () => {
  it('returns UTC midnight for UTC', () => {
    const now = new Date('2026-08-30T15:30:00.000Z');
    expect(startOfDayInTimeZone(now, 'UTC').toISOString()).toBe('2026-08-30T00:00:00.000Z');
  });

  it('returns the Pacific midnight instant for a Los Angeles afternoon', () => {
    // 15:30 UTC is 08:30 PDT on 2026-08-30; midnight PDT is 07:00 UTC.
    const now = new Date('2026-08-30T15:30:00.000Z');
    expect(startOfDayInTimeZone(now, 'America/Los_Angeles').toISOString()).toBe(
      '2026-08-30T07:00:00.000Z',
    );
  });

  it('uses the previous calendar day when it is still evening in Los Angeles', () => {
    // 00:17 UTC is 17:17 PDT on 2026-08-29; midnight that day is 07:00 UTC on the 29th.
    const now = new Date('2026-08-30T00:17:00.000Z');
    expect(startOfDayInTimeZone(now, 'America/Los_Angeles').toISOString()).toBe(
      '2026-08-29T07:00:00.000Z',
    );
  });
});
