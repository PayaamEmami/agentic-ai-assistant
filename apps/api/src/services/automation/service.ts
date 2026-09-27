import { encryptCredentials } from '@aaa/knowledge-sources';
import {
  assertPublicHttpsUrl,
  inferMcpCapability,
  isValidMcpCapabilitySlug,
  mcpToolPrefixes,
  McpError,
} from '@aaa/mcp';
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
import { createMcpClient, getMcpConnection, getMcpConnections, invalidateMcpToolCache } from '../tools/index.js';
import { enqueueAutomationJob } from './queue.js';

export class AutomationValidationError extends AppError {
  constructor(message: string) {
    super(400, message, 'VALIDATION_ERROR');
    this.name = 'AutomationValidationError';
  }
}

export interface McpConnectionTestResult {
  connected: boolean;
  capability?: string;
  serverName?: string;
  serverVersion?: string;
  tools: string[];
  error?: string;
}

export interface McpConnectionStatusItem {
  capability: string;
  serverUrl: string;
  serverName: string | null;
  connected: boolean;
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
  async runNow(userId: string, scheduleId: string): Promise<AutomationRun | null> {
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
      });
    } catch (error) {
      if (isPgUniqueViolation(error)) {
        await conversationRepository.delete(conversation.id);
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

  /** Saves an MCP server connection and verifies it by listing its tools. */
  async connectMcpServer(
    userId: string,
    input: { serverUrl: string; apiKey: string; capability?: string },
  ): Promise<McpConnectionTestResult> {
    const serverUrl = assertSafeMcpUrl(input.serverUrl);
    if (!input.apiKey.trim()) {
      throw new AutomationValidationError('An MCP API key is required.');
    }

    const test = await this.testMcpConnection({
      serverUrl,
      apiKey: input.apiKey.trim(),
    });
    if (!test.connected) {
      return test;
    }

    const capability =
      input.capability?.trim() ||
      inferMcpCapability({ serverName: test.serverName, tools: test.tools });
    if (!capability || !isValidMcpCapabilitySlug(capability)) {
      throw new AutomationValidationError(
        'Could not identify this MCP server. It needs a name that is a lowercase slug.',
      );
    }

    await appCapabilityConfigRepository.upsert(
      userId,
      'mcp',
      capability,
      'connected',
      encryptCredentials({ apiKey: input.apiKey.trim() }),
      {
        serverUrl,
        serverName: test.serverName ?? null,
        toolPrefixes: mcpToolPrefixes(test.tools),
      },
    );

    await invalidateMcpToolCache(userId, capability);

    return { ...test, capability };
  }

  async disconnectMcpServer(userId: string, capability: string): Promise<boolean> {
    const connection = await getMcpConnection(userId, capability);
    if (!connection) {
      return false;
    }

    const config = await appCapabilityConfigRepository.findByUserAppAndCapability(
      userId,
      'mcp',
      connection.capability,
    );
    if (!config) {
      return false;
    }

    await appCapabilityConfigRepository.delete(config.id);
    await invalidateMcpToolCache(userId, connection.capability);
    return true;
  }

  /**
   * Verifies an MCP connection. A failure is returned rather than thrown so the
   * settings UI can show the server's own error message.
   */
  async testMcpConnection(connection: {
    capability?: string;
    serverUrl: string;
    apiKey: string;
  }): Promise<McpConnectionTestResult> {
    try {
      const { serverInfo, tools } = await createMcpClient({
        capability: connection.capability ?? 'mcp',
        serverUrl: connection.serverUrl,
        apiKey: connection.apiKey,
      }).testConnection();
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

  async testSavedMcpConnection(
    userId: string,
    capability: string,
  ): Promise<McpConnectionTestResult> {
    const connection = await getMcpConnection(userId, capability);
    if (!connection) {
      return { connected: false, tools: [], error: 'No MCP server is connected.' };
    }

    const result = await this.testMcpConnection(connection);
    return { ...result, capability: connection.capability };
  }

  async getMcpStatus(userId: string): Promise<{ connections: McpConnectionStatusItem[] }> {
    const connections = await getMcpConnections(userId);
    return {
      connections: connections.map((connection) => ({
        capability: connection.capability,
        serverUrl: connection.serverUrl,
        serverName: connection.serverName ?? null,
        connected: true,
      })),
    };
  }
}
