'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CreateAutomationScheduleRequest, UpdateAutomationScheduleRequest } from '@aaa/shared';
import { useToast } from '@/components/ui/toast';
import { api, type AutomationRun, type AutomationSchedule } from '@/lib/api-client';
import { isRunActive } from './automation-status';

/**
 * While a run is in flight the list is refreshed periodically as a backstop: the
 * live WebSocket stream drives the activity log, but a dropped socket should
 * still converge on the run's real terminal state.
 */
const ACTIVE_RUN_POLL_MS = 10_000;

export function useAutomationSchedules() {
  const toast = useToast();
  const [schedules, setSchedules] = useState<AutomationSchedule[]>([]);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    const [scheduleResult, runResult] = await Promise.all([
      api.automation.listSchedules(),
      api.automation.listRuns(),
    ]);

    if (!mounted.current) {
      return;
    }

    setSchedules(scheduleResult.schedules);
    setRuns(runResult.runs);
  }, []);

  useEffect(() => {
    void reload()
      .catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : 'Failed to load automations');
      })
      .finally(() => {
        if (mounted.current) {
          setLoading(false);
        }
      });
  }, [reload, toast]);

  const hasActiveRun = runs.some(isRunActive);

  useEffect(() => {
    if (!hasActiveRun) {
      return;
    }

    const interval = setInterval(() => {
      void reload().catch(() => {
        // A failed background refresh is not worth interrupting the user.
      });
    }, ACTIVE_RUN_POLL_MS);

    return () => {
      clearInterval(interval);
    };
  }, [hasActiveRun, reload]);

  const withBusy = useCallback(
    async <T,>(action: () => Promise<T>, failureMessage: string): Promise<T | null> => {
      setBusy(true);
      try {
        return await action();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : failureMessage);
        return null;
      } finally {
        if (mounted.current) {
          setBusy(false);
        }
      }
    },
    [toast],
  );

  const createSchedule = useCallback(
    async (input: CreateAutomationScheduleRequest) =>
      withBusy(async () => {
        const { schedule } = await api.automation.createSchedule(input);
        await reload();
        toast.success(`Created "${schedule.name}".`);
        return schedule;
      }, 'Failed to create the automation'),
    [reload, toast, withBusy],
  );

  const updateSchedule = useCallback(
    async (id: string, update: UpdateAutomationScheduleRequest) =>
      withBusy(async () => {
        const { schedule } = await api.automation.updateSchedule(id, update);
        await reload();
        return schedule;
      }, 'Failed to update the automation'),
    [reload, withBusy],
  );

  const deleteSchedule = useCallback(
    async (id: string, name: string) =>
      withBusy(async () => {
        await api.automation.deleteSchedule(id);
        await reload();
        toast.success(`Deleted "${name}".`);
        return true;
      }, 'Failed to delete the automation'),
    [reload, toast, withBusy],
  );

  const runNow = useCallback(
    async (id: string, dryRun?: boolean) =>
      withBusy(async () => {
        const { run } = await api.automation.runNow(id, dryRun);
        await reload();
        toast.info(run.dryRun ? 'Started a dry run.' : 'Started a run.');
        return run;
      }, 'Failed to start the run'),
    [reload, toast, withBusy],
  );

  return {
    schedules,
    runs,
    loading,
    busy,
    reload,
    createSchedule,
    updateSchedule,
    deleteSchedule,
    runNow,
  };
}
