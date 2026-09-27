'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CreateAutomationScheduleRequest } from '@aaa/shared';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  WEEKDAY_OPTIONS,
  cronForTiming,
  timingFromCron,
  type ScheduleCadence,
} from '@/lib/automation/schedule-cron';
import type { AutomationSchedule } from '@/lib/api-client';

const TIMEZONES = [
  'UTC',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'Europe/London',
  'Europe/Paris',
  'Asia/Tokyo',
];

const CADENCE_OPTIONS: Array<{ value: ScheduleCadence; label: string }> = [
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'custom', label: 'Custom cron' },
];

interface ScheduleFormProps {
  busy: boolean;
  initial?: AutomationSchedule | null;
  onCancel?: () => void;
  onSubmit: (input: CreateAutomationScheduleRequest) => Promise<unknown>;
  submitLabel: string;
}

export function ScheduleForm({
  busy,
  initial,
  onCancel,
  onSubmit,
  submitLabel,
}: ScheduleFormProps) {
  const initialTiming = timingFromCron(initial?.cron ?? '0 9 * * *');
  const [name, setName] = useState(initial?.name ?? '');
  const [prompt, setPrompt] = useState(initial?.prompt ?? '');
  const [cadence, setCadence] = useState<ScheduleCadence>(initialTiming.cadence);
  const [time, setTime] = useState(initialTiming.time);
  const [weekday, setWeekday] = useState(initialTiming.weekday);
  const [cron, setCron] = useState(initial?.cron ?? '0 9 * * *');
  const [timezone, setTimezone] = useState(initial?.timezone ?? 'America/Los_Angeles');
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [maxRunsPerDay, setMaxRunsPerDay] = useState(String(initial?.maxRunsPerDay ?? 1));

  useEffect(() => {
    if (!initial) {
      return;
    }

    const timing = timingFromCron(initial.cron);
    setName(initial.name);
    setPrompt(initial.prompt);
    setCadence(timing.cadence);
    setTime(timing.time);
    setWeekday(timing.weekday);
    setCron(initial.cron);
    setTimezone(initial.timezone);
    setEnabled(initial.enabled);
    setMaxRunsPerDay(String(initial.maxRunsPerDay));
  }, [initial]);

  const timezoneOptions = useMemo(
    () => (TIMEZONES.includes(timezone) ? TIMEZONES : [timezone, ...TIMEZONES]),
    [timezone],
  );
  const showsTime = cadence === 'daily' || cadence === 'weekdays' || cadence === 'weekly';

  const submit = async () => {
    const parsedMax = Number.parseInt(maxRunsPerDay, 10);
    await onSubmit({
      name: name.trim(),
      prompt: prompt.trim(),
      cron: cronForTiming({ cadence, time, weekday, cron }),
      timezone,
      enabled,
      maxRunsPerDay: Number.isInteger(parsedMax) && parsedMax > 0 ? parsedMax : 1,
    });
  };

  return (
    <div className="space-y-4">
      <Field label="Name">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={busy}
          placeholder="Morning digest"
        />
      </Field>

      <Field label="Prompt">
        <Textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          disabled={busy}
          rows={5}
          className="min-h-28 w-full"
          placeholder="What should the assistant do each time this runs?"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Cadence">
          <Select
            value={cadence}
            disabled={busy}
            onChange={(event) => {
              const next = event.target.value as ScheduleCadence;
              setCadence(next);
              if (next === 'hourly') {
                setMaxRunsPerDay((current) => (current === '1' ? '24' : current));
              }
            }}
          >
            {CADENCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Timezone">
          <Select
            value={timezone}
            disabled={busy}
            onChange={(event) => setTimezone(event.target.value)}
          >
            {timezoneOptions.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {showsTime ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Time">
            <Input
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
              disabled={busy}
            />
          </Field>
          {cadence === 'weekly' ? (
            <Field label="Day">
              <Select
                value={weekday}
                disabled={busy}
                onChange={(event) => setWeekday(event.target.value)}
              >
                {WEEKDAY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </div>
      ) : null}

      {cadence === 'custom' ? (
        <Field label="Cron expression">
          <Input
            value={cron}
            onChange={(event) => setCron(event.target.value)}
            disabled={busy}
            placeholder="0 9 * * *"
          />
        </Field>
      ) : null}

      <Field label="Max runs per day">
        <Input
          type="number"
          min={1}
          max={24}
          value={maxRunsPerDay}
          onChange={(event) => setMaxRunsPerDay(event.target.value)}
          disabled={busy}
        />
      </Field>

      <Switch
        checked={enabled}
        onCheckedChange={setEnabled}
        disabled={busy}
        label="Enabled"
        description="When off, the scheduler skips this prompt."
      />

      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => void submit()}
          disabled={busy || !name.trim() || !prompt.trim() || !cronForTiming({ cadence, time, weekday, cron }).trim()}
        >
          {submitLabel}
        </Button>
        {onCancel ? (
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  );
}
