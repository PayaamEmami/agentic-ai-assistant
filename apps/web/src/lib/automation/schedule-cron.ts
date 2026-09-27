export type ScheduleCadence = 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'custom';

export interface ScheduleTiming {
  cadence: ScheduleCadence;
  /** `HH:MM` in 24-hour form. */
  time: string;
  /** Cron day-of-week, `0` (Sunday) through `6` (Saturday). */
  weekday: string;
  cron: string;
}

const WEEKDAY_LABELS: Record<string, string> = {
  '0': 'Sunday',
  '1': 'Monday',
  '2': 'Tuesday',
  '3': 'Wednesday',
  '4': 'Thursday',
  '5': 'Friday',
  '6': 'Saturday',
};

export const WEEKDAY_OPTIONS = Object.entries(WEEKDAY_LABELS).map(([value, label]) => ({
  value,
  label,
}));

function padTime(hour: string, minute: string): string {
  return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
}

export function cronForTiming(timing: Pick<ScheduleTiming, 'cadence' | 'time' | 'weekday' | 'cron'>): string {
  if (timing.cadence === 'custom') {
    return timing.cron.trim();
  }
  if (timing.cadence === 'hourly') {
    return '0 * * * *';
  }

  const [hour = '9', minute = '0'] = timing.time.split(':');
  const minuteField = String(Number(minute));
  const hourField = String(Number(hour));
  if (timing.cadence === 'daily') {
    return `${minuteField} ${hourField} * * *`;
  }
  if (timing.cadence === 'weekdays') {
    return `${minuteField} ${hourField} * * 1-5`;
  }
  return `${minuteField} ${hourField} * * ${timing.weekday}`;
}

export function timingFromCron(cron: string): ScheduleTiming {
  const parts = cron.trim().split(/\s+/);
  const fallback: ScheduleTiming = {
    cadence: 'custom',
    time: '09:00',
    weekday: '1',
    cron,
  };
  if (parts.length !== 5) {
    return fallback;
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  if (minute === '0' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return { cadence: 'hourly', time: '09:00', weekday: '1', cron };
  }

  const clock =
    /^\d+$/.test(minute) && /^\d+$/.test(hour) && dayOfMonth === '*' && month === '*';
  if (!clock) {
    return fallback;
  }

  const time = padTime(hour, minute);
  if (dayOfWeek === '*') {
    return { cadence: 'daily', time, weekday: '1', cron };
  }
  if (dayOfWeek === '1-5') {
    return { cadence: 'weekdays', time, weekday: '1', cron };
  }
  if (WEEKDAY_LABELS[dayOfWeek]) {
    return { cadence: 'weekly', time, weekday: dayOfWeek, cron };
  }
  return fallback;
}

export function describeTiming(cron: string, timezone: string): string {
  const timing = timingFromCron(cron);
  if (timing.cadence === 'hourly') {
    return `Hourly (${timezone})`;
  }
  if (timing.cadence === 'daily') {
    return `Daily at ${timing.time} (${timezone})`;
  }
  if (timing.cadence === 'weekdays') {
    return `Weekdays at ${timing.time} (${timezone})`;
  }
  if (timing.cadence === 'weekly') {
    const day = WEEKDAY_LABELS[timing.weekday] ?? 'Weekly';
    return `Every ${day} at ${timing.time} (${timezone})`;
  }
  return `${cron} (${timezone})`;
}
