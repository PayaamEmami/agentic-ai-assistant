import { z } from 'zod';
import { AUTOMATION_RUN_EVENT_KINDS, AUTOMATION_RUN_STATUSES } from '../automation.js';

export const AutomationRunStatusDto = z.enum(AUTOMATION_RUN_STATUSES);
export type AutomationRunStatusDto = z.infer<typeof AutomationRunStatusDto>;

export const AutomationRunEventKindDto = z.enum(AUTOMATION_RUN_EVENT_KINDS);
export type AutomationRunEventKindDto = z.infer<typeof AutomationRunEventKindDto>;

export const AutomationScheduleDto = z.object({
  id: z.string().uuid(),
  name: z.string(),
  prompt: z.string(),
  cron: z.string(),
  timezone: z.string(),
  enabled: z.boolean(),
  maxRunsPerDay: z.number().int().positive(),
  lastRunAt: z.string().nullable(),
  nextRunAt: z.string().nullable(),
});
export type AutomationScheduleDto = z.infer<typeof AutomationScheduleDto>;

export const CreateAutomationScheduleRequest = z.object({
  name: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(8_000),
  cron: z.string().trim().min(1).max(120),
  timezone: z.string().trim().min(1).max(64).default('UTC'),
  enabled: z.boolean().default(true),
  maxRunsPerDay: z.number().int().min(1).max(24).default(1),
});
export type CreateAutomationScheduleRequest = z.infer<typeof CreateAutomationScheduleRequest>;

export const UpdateAutomationScheduleRequest =
  CreateAutomationScheduleRequest.partial();
export type UpdateAutomationScheduleRequest = z.infer<typeof UpdateAutomationScheduleRequest>;

export const AutomationRunDto = z.object({
  id: z.string().uuid(),
  scheduleId: z.string().uuid().nullable(),
  conversationId: z.string().uuid().nullable(),
  status: AutomationRunStatusDto,
  currentStage: z.string().nullable(),
  trigger: z.enum(['schedule', 'manual']),
  dryRun: z.boolean(),
  boardId: z.string().nullable(),
  selectedCardId: z.string().nullable(),
  selectedCardTitle: z.string().nullable(),
  selectedRepo: z.string().nullable(),
  rationale: z.string().nullable(),
  pullRequestUrl: z.string().nullable(),
  skipReason: z.string().nullable(),
  error: z.string().nullable(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
});
export type AutomationRunDto = z.infer<typeof AutomationRunDto>;

export const AutomationRunEventDto = z.object({
  seq: z.number().int().positive(),
  at: z.string(),
  kind: AutomationRunEventKindDto,
  stage: z.string().nullable(),
  message: z.string(),
});
export type AutomationRunEventDto = z.infer<typeof AutomationRunEventDto>;

export const AutomationRunNowRequest = z.object({});
export type AutomationRunNowRequest = z.infer<typeof AutomationRunNowRequest>;

export const ConnectMcpServerRequest = z.object({
  serverUrl: z.string().url().max(500),
  apiKey: z.string().min(1).max(500),
  capability: z
    .string()
    .regex(/^[a-z][a-z0-9-]{0,63}$/, 'MCP capability must be a lowercase slug')
    .optional(),
});
export type ConnectMcpServerRequest = z.infer<typeof ConnectMcpServerRequest>;

export const McpConnectionStatusDto = z.object({
  capability: z.string(),
  serverUrl: z.string(),
  serverName: z.string().nullable(),
  connected: z.boolean(),
});
export type McpConnectionStatusDto = z.infer<typeof McpConnectionStatusDto>;

export const McpConnectionListDto = z.object({
  connections: z.array(McpConnectionStatusDto),
});
export type McpConnectionListDto = z.infer<typeof McpConnectionListDto>;

export const McpConnectionTestDto = z.object({
  connected: z.boolean(),
  capability: z.string().optional(),
  serverName: z.string().optional(),
  serverVersion: z.string().optional(),
  tools: z.array(z.string()),
  error: z.string().optional(),
});
export type McpConnectionTestDto = z.infer<typeof McpConnectionTestDto>;

