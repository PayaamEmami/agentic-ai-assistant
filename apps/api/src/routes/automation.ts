import type { FastifyInstance, FastifyReply } from 'fastify';
import type {
  AutomationRun,
  AutomationRunEvent,
  AutomationSchedule,
} from '@aaa/db';
import {
  AutomationRunNowRequest,
  ConnectMcpServerRequest,
  CreateAutomationScheduleRequest,
  UpdateAutomationScheduleRequest,
  type AutomationRunDto,
  type AutomationRunEventDto,
  type AutomationScheduleDto,
} from '@aaa/shared';
import { authenticate } from '../middleware/auth.js';
import { AutomationService } from '../services/automation/index.js';

interface AutomationRouteOptions {
  automationService?: AutomationService;
}

function toScheduleDto(schedule: AutomationSchedule): AutomationScheduleDto {
  return {
    id: schedule.id,
    name: schedule.name,
    cron: schedule.cron,
    timezone: schedule.timezone,
    enabled: schedule.enabled,
    boardId: schedule.boardId,
    sourceListId: schedule.sourceListId,
    repoAllowlist: schedule.repoAllowlist,
    dryRun: schedule.dryRun,
    maxRunsPerDay: schedule.maxRunsPerDay,
    lastRunAt: schedule.lastRunAt?.toISOString() ?? null,
    nextRunAt: schedule.nextRunAt?.toISOString() ?? null,
  };
}

function toRunDto(run: AutomationRun): AutomationRunDto {
  return {
    id: run.id,
    scheduleId: run.scheduleId,
    conversationId: run.conversationId,
    status: run.status,
    currentStage: run.currentStage,
    trigger: run.trigger,
    dryRun: run.dryRun,
    boardId: run.boardId,
    selectedCardId: run.selectedCardId,
    selectedCardTitle: run.selectedCardTitle,
    selectedRepo: run.selectedRepo,
    rationale: run.rationale,
    pullRequestUrl: run.pullRequestUrl,
    skipReason: run.skipReason,
    error: run.error,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
  };
}

function toRunEventDto(event: AutomationRunEvent): AutomationRunEventDto {
  return {
    seq: event.seq,
    at: event.at.toISOString(),
    kind: event.kind,
    stage: event.stage,
    message: event.message,
  };
}

function sendValidationError(reply: FastifyReply, message: string): FastifyReply {
  return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message } });
}

function sendNotFound(reply: FastifyReply, message: string): FastifyReply {
  return reply.status(404).send({ error: { code: 'NOT_FOUND', message } });
}

export async function automationRoutes(
  app: FastifyInstance,
  options: AutomationRouteOptions = {},
) {
  const automationService = options.automationService ?? new AutomationService();

  await app.register(async (userApp) => {
    userApp.addHook('preHandler', authenticate);

    userApp.get('/automation/schedules', async (request, reply) => {
      const schedules = await automationService.listSchedules(request.user!.id);
      return reply.status(200).send({ schedules: schedules.map(toScheduleDto) });
    });

    userApp.post('/automation/schedules', async (request, reply) => {
      const parsed = CreateAutomationScheduleRequest.safeParse(request.body);
      if (!parsed.success) {
        return sendValidationError(reply, parsed.error.message);
      }

      const schedule = await automationService.createSchedule(request.user!.id, {
        ...parsed.data,
        sourceListId: parsed.data.sourceListId ?? null,
        repoAllowlist: parsed.data.repoAllowlist ?? null,
      });
      return reply.status(201).send({ schedule: toScheduleDto(schedule) });
    });

    userApp.patch<{ Params: { id: string } }>(
      '/automation/schedules/:id',
      async (request, reply) => {
        const parsed = UpdateAutomationScheduleRequest.safeParse(request.body);
        if (!parsed.success) {
          return sendValidationError(reply, parsed.error.message);
        }

        const schedule = await automationService.updateSchedule(
          request.user!.id,
          request.params.id,
          parsed.data,
        );
        if (!schedule) {
          return sendNotFound(reply, 'Schedule not found');
        }
        return reply.status(200).send({ schedule: toScheduleDto(schedule) });
      },
    );

    userApp.delete<{ Params: { id: string } }>(
      '/automation/schedules/:id',
      async (request, reply) => {
        const deleted = await automationService.deleteSchedule(
          request.user!.id,
          request.params.id,
        );
        if (!deleted) {
          return sendNotFound(reply, 'Schedule not found');
        }
        return reply.status(200).send({ deleted: true });
      },
    );

    userApp.post<{ Params: { id: string } }>(
      '/automation/schedules/:id/run',
      async (request, reply) => {
        const parsed = AutomationRunNowRequest.safeParse(request.body ?? {});
        if (!parsed.success) {
          return sendValidationError(reply, parsed.error.message);
        }

        const run = await automationService.runNow(
          request.user!.id,
          request.params.id,
          parsed.data,
        );
        if (!run) {
          return sendNotFound(reply, 'Schedule not found');
        }
        return reply.status(202).send({ run: toRunDto(run) });
      },
    );

    userApp.get<{ Querystring: { limit?: string; offset?: string } }>(
      '/automation/runs',
      async (request, reply) => {
        const limit = Math.min(Number(request.query.limit ?? 20) || 20, 100);
        const offset = Math.max(Number(request.query.offset ?? 0) || 0, 0);
        const runs = await automationService.listRuns(request.user!.id, limit, offset);
        return reply.status(200).send({ runs: runs.map(toRunDto) });
      },
    );

    // Replays a run's persisted activity so a client can render history before
    // following the live WebSocket stream.
    userApp.get<{ Params: { id: string }; Querystring: { afterSeq?: string } }>(
      '/automation/runs/:id/events',
      async (request, reply) => {
        const afterSeq = Math.max(Number(request.query.afterSeq ?? 0) || 0, 0);
        const events = await automationService.listRunEvents(
          request.user!.id,
          request.params.id,
          afterSeq,
        );
        if (!events) {
          return sendNotFound(reply, 'Run not found');
        }
        return reply.status(200).send({ events: events.map(toRunEventDto) });
      },
    );

    userApp.get('/automation/boards', async (request, reply) => {
      try {
        const boards = await automationService.listBoards(request.user!.id);
        return reply.status(200).send({ boards });
      } catch (error) {
        return reply.status(502).send({
          error: {
            code: 'MCP_UNAVAILABLE',
            message:
              error instanceof Error
                ? error.message
                : 'Could not read boards from the MCP server',
          },
        });
      }
    });

    userApp.get('/automation/mcp', async (request, reply) => {
      const status = await automationService.getMcpStatus(request.user!.id);
      return reply.status(200).send(status);
    });

    userApp.put('/automation/mcp', async (request, reply) => {
      const parsed = ConnectMcpServerRequest.safeParse(request.body);
      if (!parsed.success) {
        return sendValidationError(reply, parsed.error.message);
      }

      const result = await automationService.connectMcpServer(request.user!.id, parsed.data);
      return reply.status(200).send(result);
    });

    userApp.delete('/automation/mcp', async (request, reply) => {
      const disconnected = await automationService.disconnectMcpServer(request.user!.id);
      return reply.status(200).send({ disconnected });
    });

    userApp.post('/automation/mcp/test', async (request, reply) => {
      const result = await automationService.testSavedMcpConnection(request.user!.id);
      return reply.status(200).send(result);
    });
  });
}
