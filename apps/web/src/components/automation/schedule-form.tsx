'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CreateAutomationScheduleRequest } from '@aaa/shared';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { AutomationBoard, AutomationSchedule } from '@/lib/api-client';

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

const CRON_PRESETS = [
  { label: 'Daily at 09:00', value: '0 9 * * *' },
  { label: 'Daily at 08:00', value: '0 8 * * *' },
  { label: 'Weekdays at 09:00', value: '0 9 * * 1-5' },
  { label: 'Custom', value: 'custom' },
];

interface ScheduleFormProps {
  boards: AutomationBoard[];
  busy: boolean;
  disabled?: boolean;
  initial?: AutomationSchedule | null;
  onCancel?: () => void;
  onSubmit: (input: CreateAutomationScheduleRequest) => Promise<unknown>;
  submitLabel: string;
}

function cronPresetFor(cron: string): string {
  return CRON_PRESETS.some((preset) => preset.value === cron) ? cron : 'custom';
}

export function ScheduleForm({
  boards,
  busy,
  disabled = false,
  initial,
  onCancel,
  onSubmit,
  submitLabel,
}: ScheduleFormProps) {
  const [name, setName] = useState(initial?.name ?? 'Daily board task');
  const [cron, setCron] = useState(initial?.cron ?? '0 9 * * *');
  const [cronPreset, setCronPreset] = useState(cronPresetFor(initial?.cron ?? '0 9 * * *'));
  const [timezone, setTimezone] = useState(initial?.timezone ?? 'America/Los_Angeles');
  const [boardId, setBoardId] = useState(initial?.boardId ?? '');
  const [sourceListId, setSourceListId] = useState(initial?.sourceListId ?? '');
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [dryRun, setDryRun] = useState(initial?.dryRun ?? true);
  const [maxRunsPerDay, setMaxRunsPerDay] = useState(String(initial?.maxRunsPerDay ?? 1));
  const [repoAllowlist, setRepoAllowlist] = useState(
    (initial?.repoAllowlist ?? []).join(', '),
  );

  useEffect(() => {
    if (!initial) {
      return;
    }

    setName(initial.name);
    setCron(initial.cron);
    setCronPreset(cronPresetFor(initial.cron));
    setTimezone(initial.timezone);
    setBoardId(initial.boardId);
    setSourceListId(initial.sourceListId ?? '');
    setEnabled(initial.enabled);
    setDryRun(initial.dryRun);
    setMaxRunsPerDay(String(initial.maxRunsPerDay));
    setRepoAllowlist((initial.repoAllowlist ?? []).join(', '));
  }, [initial]);

  const selectedBoard = useMemo(
    () => boards.find((board) => board.boardId === boardId) ?? null,
    [boardId, boards],
  );
  const timezoneOptions = useMemo(
    () => (TIMEZONES.includes(timezone) ? TIMEZONES : [timezone, ...TIMEZONES]),
    [timezone],
  );

  useEffect(() => {
    if (boards.length === 0 || boardId) {
      return;
    }

    setBoardId(boards[0]!.boardId);
  }, [boardId, boards]);

  const submit = async () => {
    const parsedMax = Number.parseInt(maxRunsPerDay, 10);
    const allowlist = repoAllowlist
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);

    await onSubmit({
      name: name.trim(),
      cron: cron.trim(),
      timezone,
      enabled,
      boardId: boardId.trim(),
      sourceListId: sourceListId.trim() || null,
      repoAllowlist: allowlist.length > 0 ? allowlist : null,
      dryRun,
      maxRunsPerDay: Number.isInteger(parsedMax) && parsedMax > 0 ? parsedMax : 1,
    });
  };

  return (
    <div className="space-y-4">
      <Field label="Name">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={disabled || busy}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Cadence">
          <Select
            value={cronPreset}
            disabled={disabled || busy}
            onChange={(event) => {
              const next = event.target.value;
              setCronPreset(next);
              if (next !== 'custom') {
                setCron(next);
              }
            }}
          >
            {CRON_PRESETS.map((preset) => (
              <option key={preset.value} value={preset.value}>
                {preset.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Timezone">
          <Select
            value={timezone}
            disabled={disabled || busy}
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

      {cronPreset === 'custom' ? (
        <Field label="Cron expression">
          <Input
            value={cron}
            onChange={(event) => setCron(event.target.value)}
            disabled={disabled || busy}
            placeholder="0 9 * * *"
          />
        </Field>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Board">
          {boards.length > 0 && (!boardId || boards.some((board) => board.boardId === boardId)) ? (
            <Select
              value={boardId}
              disabled={disabled || busy}
              onChange={(event) => {
                setBoardId(event.target.value);
                setSourceListId('');
              }}
            >
              {boards.map((board) => (
                <option key={board.boardId} value={board.boardId}>
                  {board.name}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              value={boardId}
              onChange={(event) => setBoardId(event.target.value)}
              disabled={disabled || busy}
              placeholder="Board ID"
            />
          )}
        </Field>

        <Field label="Source list">
          {selectedBoard && selectedBoard.lists.length > 0 ? (
            <Select
              value={sourceListId}
              disabled={disabled || busy}
              onChange={(event) => setSourceListId(event.target.value)}
            >
              <option value="">Any list</option>
              {selectedBoard.lists.map((list) => (
                <option key={list.listId} value={list.listId}>
                  {list.name}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              value={sourceListId}
              onChange={(event) => setSourceListId(event.target.value)}
              disabled={disabled || busy}
              placeholder="Optional list ID"
            />
          )}
        </Field>
      </div>

      <Field label="Repo allowlist">
        <Input
          value={repoAllowlist}
          onChange={(event) => setRepoAllowlist(event.target.value)}
          disabled={disabled || busy}
          placeholder="owner/repo, owner/other — leave blank for all"
        />
      </Field>

      <Field label="Max runs per day">
        <Input
          type="number"
          min={1}
          max={24}
          value={maxRunsPerDay}
          onChange={(event) => setMaxRunsPerDay(event.target.value)}
          disabled={disabled || busy}
        />
      </Field>

      <Switch
        checked={enabled}
        onCheckedChange={setEnabled}
        disabled={disabled || busy}
        label="Enabled"
        description="When off, the scheduler skips this automation."
      />
      <Switch
        checked={dryRun}
        onCheckedChange={setDryRun}
        disabled={disabled || busy}
        label="Dry run"
        description="Pick a card and repo, but do not write code or open a pull request."
      />

      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => void submit()}
          disabled={disabled || busy || !name.trim() || !boardId.trim() || !cron.trim()}
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
