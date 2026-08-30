import { encryptCredentials } from '@aaa/knowledge-sources';
import { assertPublicHttpsUrl, McpError } from '@aaa/mcp';
import { computeNextRunAt, isValidCronExpression, isValidTimezone } from '@aaa/shared';
import {
  appCapabilityConfigRepository,
  automationRunEventRepository,
  automationRunRepository,
  automationScheduleRepository,
  conversationRepository,
  isPgUniqueViolation,
  type AutomationRun,
  type AutomationRunEvent,
  type AutomationSchedule,
  type AutomationScheduleInput,
  type AutomationScheduleUpdate,
} from '@aaa/db';
import { AppError } from '../../lib/errors.js';
import { createMcpClient, getMcpConnection, invalidateMcpToolCache } from '../tools/index.js';
import { enqueueAutomationJob } from './queue.js';

export class AutomationValidationError extends AppError {
  constructor(message: string) {
    super(400, message, 'VALIDATION_ERROR');
    this.name = 'AutomationValidationError';
  }
}

export interface McpConnectionTestResult {
  connected: boolean;
  serverName?: string;
  serverVersion?: string;
  tools: string[];
  error?: string;
}

export interface AutomationBoardSummary {
  boardId: string;
  name: string;
  lists: Array<{ listId: string; name: string }>;
}

function assertValidSchedule(input: {
  cron?: string;
  timezone?: string;
  maxRunsPerDay?: number;
}): void {
  if (input.timezone !== undefined && !isValidTimezone(input.timezone)) {
    throw new AutomationValidationError(`"${input.timezone}" is not a recognized timezone.`);
  }

  if (input.cron !== undefined && !isValidCronExpression(input.cron, input.timezone ?? 'UTC')) {
    throw new AutomationValidationError(`"${input.cron}" is not a valid cron expression.`);
  }

  if (
    input.maxRunsPerDay !== undefined &&
    (!Number.isInteger(input.maxRunsPerDay) || input.maxRunsPerDay < 1)
  ) {
    throw new AutomationValidationError('"maxRunsPerDay" must be a positive integer.');
  }
}

function assertSafeMcpUrl(serverUrl: string): string {
  try {
    return assertPublicHttpsUrl(serverUrl);
  } catch (error) {
    throw new AutomationValidationError(
      error instanceof McpError ? error.message : 'The MCP server URL is not valid.',
    );
  }
}

export class AutomationService {
  async listSchedules(userId: string): Promise<AutomationSchedule[]> {
    return automationScheduleRepository.listByUser(userId);
  }

  async createSchedule(
    userId: string,
    input: AutomationScheduleInput,
  ): Promise<AutomationSchedule> {
    assertValidSchedule(input);

    const timezone = input.timezone ?? 'UTC';
    return automationScheduleRepository.create(userId, {
      ...input,
      timezone,
      // Only an enabled schedule gets a next run time; disabling one clears it so
      // the scheduler query never has to filter on both columns.
      nextRunAt:
        input.enabled === false ? null : computeNextRunAt(input.cron, timezone),
    });
  }

  async updateSchedule(
    userId: string,
    scheduleId: string,
    update: AutomationScheduleUpdate,
  ): Promise<AutomationSchedule | null> {
    const existing = await automationScheduleRepository.findById(scheduleId);
    if (!existing || existing.userId !== userId) {
      return null;
    }

    if (update.cron !== undefined || update.timezone !== undefined) {
      assertValidSchedule({
        cron: update.cron ?? existing.cron,
        timezone: update.timezone ?? existing.timezone,
        maxRunsPerDay: update.maxRunsPerDay,
      });
    } else {
      assertValidSchedule({ maxRunsPerDay: update.maxRunsPerDay });
    }

    const cron = update.cron ?? existing.cron;
    const timezone = update.timezone ?? existing.timezone;
    const enabled = update.enabled ?? existing.enabled;
    const scheduleChanged =
      (update.cron !== undefined && update.cron !== existing.cron) ||
      (update.timezone !== undefined && update.timezone !== existing.timezone);
    const enabledChanged = update.enabled !== undefined && update.enabled !== existing.enabled;

    let nextRunAt = existing.nextRunAt;
    if (!enabled) {
      nextRunAt = null;
    } else if (scheduleChanged || (enabledChanged && enabled)) {
      nextRunAt = computeNextRunAt(cron, timezone);
    }

    return automationScheduleRepository.update(scheduleId, userId, {
      ...update,
      nextRunAt,
    });
  }

  async deleteSchedule(userId: string, scheduleId: string): Promise<boolean> {
    const existing = await automationScheduleRepository.findById(scheduleId);
    if (!existing || existing.userId !== userId) {
      return false;
    }

    const deleted = await automationScheduleRepository.delete(scheduleId, userId);
    if (deleted) {
      return true;
    }

    if (await automationRunRepository.hasActiveRunForSchedule(scheduleId)) {
      throw new AutomationValidationError(
        'Cannot delete a schedule while a run is in progress. Wait for it to finish.',
      );
    }

    return false;
  }

  async listRuns(userId: string, limit?: number, offset?: number): Promise<AutomationRun[]> {
    return automationRunRepository.listByUser(userId, limit, offset);
  }

  async listRunEvents(
    userId: string,
    runId: string,
    afterSeq?: number,
  ): Promise<AutomationRunEvent[] | null> {
    const run = await automationRunRepository.findById(runId);
    if (!run || run.userId !== userId) {
      return null;
    }

    return automationRunEventRepository.listByRun(runId, afterSeq);
  }

  /**
   * Queues an immediate run for a schedule.
   *
   * The conversation and run row are created here rather than in the worker so
   * the caller can subscribe to the run's activity before the job is picked up.
   */
  async runNow(
    userId: string,
    scheduleId: string,
    overrides?: { dryRun?: boolean },
  ): Promise<AutomationRun | null> {
    const schedule = await automationScheduleRepository.findById(scheduleId);
    if (!schedule || schedule.userId !== userId) {
      return null;
    }

    if (await automationRunRepository.hasActiveRunForSchedule(schedule.id)) {
      throw new AutomationValidationError(
        'A run is already in progress for this schedule. Wait for it to finish.',
      );
    }

    const conversation = await conversationRepository.create(
      userId,
      `Automation: ${schedule.name}`,
      true,
    );
    let run: AutomationRun;
    try {
      run = await automationRunRepository.create({
        scheduleId: schedule.id,
        userId,
        conversationId: conversation.id,
        trigger: 'manual',
        dryRun: overrides?.dryRun ?? schedule.dryRun,
        boardId: schedule.boardId,
      });
    } catch (error) {
      if (isPgUniqueViolation(error)) {
        throw new AutomationValidationError(
          'A run is already in progress for this schedule. Wait for it to finish.',
        );
      }
      throw error;
    }

    try {
      await enqueueAutomationJob({
        runId: run.id,
        scheduleId: schedule.id,
        userId,
        correlationId: `automation-${run.id}`,
      });
    } catch (error) {
      await automationRunRepository.failIfActive(
        run.id,
        'Could not enqueue the automation job.',
      );
      throw error;
    }

    return run;
  }

  /** Saves the MCP server connection and verifies it by listing its tools. */
  async connectMcpServer(
    userId: string,
    input: { serverUrl: string; apiKey: string },
  ): Promise<McpConnectionTestResult> {
    const serverUrl = assertSafeMcpUrl(input.serverUrl);
    if (!input.apiKey.trim()) {
      throw new AutomationValidationError('An MCP API key is required.');
    }

    const test = await this.testMcpConnection({ serverUrl, apiKey: input.apiKey.trim() });
    if (!test.connected) {
      return test;
    }

    await appCapabilityConfigRepository.upsert(
      userId,
      'mcp',
      'tools',
      'connected',
      encryptCredentials({ apiKey: input.apiKey.trim() }),
      { serverUrl },
    );
    await invalidateMcpToolCache(userId);

    return test;
  }

  async disconnectMcpServer(userId: string): Promise<boolean> {
    const config = await appCapabilityConfigRepository.findByUserAppAndCapability(
      userId,
      'mcp',
      'tools',
    );
    if (!config) {
      return false;
    }

    await appCapabilityConfigRepository.delete(config.id);
    await invalidateMcpToolCache(userId);
    return true;
  }

  /**
   * Verifies an MCP connection. A failure is returned rather than thrown so the
   * settings UI can show the server's own error message.
   */
  async testMcpConnection(connection: {
    serverUrl: string;
    apiKey: string;
  }): Promise<McpConnectionTestResult> {
    try {
      const { serverInfo, tools } = await createMcpClient(connection).testConnection();
      return {
        connected: true,
        serverName: serverInfo.name,
        serverVersion: serverInfo.version,
        tools: tools.map((tool) => tool.name),
      };
    } catch (error) {
      return {
        connected: false,
        tools: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async testSavedMcpConnection(userId: string): Promise<McpConnectionTestResult> {
    const connection = await getMcpConnection(userId);
    if (!connection) {
      return { connected: false, tools: [], error: 'No MCP server is connected.' };
    }

    return this.testMcpConnection(connection);
  }

  async getMcpStatus(
    userId: string,
  ): Promise<{ connected: boolean; serverUrl: string | null }> {
    const connection = await getMcpConnection(userId);
    return {
      connected: connection !== null,
      serverUrl: connection?.serverUrl ?? null,
    };
  }

  /**
   * Lists boards from the connected MCP server so the settings form can offer
   * real pickers instead of asking the user to type opaque IDs.
   */
  async listBoards(userId: string): Promise<AutomationBoardSummary[]> {
    const connection = await getMcpConnection(userId);
    if (!connection) {
      return [];
    }

    const result = await createMcpClient(connection).callTool('tasks_list_boards');
    return parseBoardSummaries(result.data);
  }
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseBoardSummaries(data: unknown): AutomationBoardSummary[] {
  if (typeof data !== 'object' || data === null || !('boards' in data)) {
    return [];
  }

  const boards = (data as { boards?: unknown }).boards;
  if (!Array.isArray(boards)) {
    return [];
  }

  return boards.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      return [];
    }

    const board = entry as { boardId?: unknown; name?: unknown; lists?: unknown };
    const boardId = asNonEmptyString(board.boardId);
    if (!boardId) {
      return [];
    }

    const lists = Array.isArray(board.lists)
      ? board.lists.flatMap((listEntry) => {
          if (typeof listEntry !== 'object' || listEntry === null) {
            return [];
          }

          const list = listEntry as { listId?: unknown; name?: unknown };
          const listId = asNonEmptyString(list.listId);
          if (!listId) {
            return [];
          }

          return [{ listId, name: asNonEmptyString(list.name) ?? listId }];
        })
      : [];

    return [{ boardId, name: asNonEmptyString(board.name) ?? boardId, lists }];
  });
}
