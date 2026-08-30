import type {
  AutomationBoardListDto,
  AutomationRunDto,
  AutomationRunEventDto,
  AutomationScheduleDto,
  CreateAutomationScheduleRequest,
  McpConnectionStatusDto,
  McpConnectionTestDto,
  UpdateAutomationScheduleRequest,
} from '@aaa/shared';
import { request } from './client';

export type AutomationSchedule = AutomationScheduleDto;
export type AutomationRun = AutomationRunDto;
export type AutomationRunEvent = AutomationRunEventDto;
export type AutomationBoard = AutomationBoardListDto;
export type McpConnectionStatus = McpConnectionStatusDto;
export type McpConnectionTest = McpConnectionTestDto;

export const automationApi = {
  listSchedules() {
    return request<{ schedules: AutomationSchedule[] }>('/api/automation/schedules');
  },
  createSchedule(input: CreateAutomationScheduleRequest) {
    return request<{ schedule: AutomationSchedule }>('/api/automation/schedules', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  updateSchedule(id: string, update: UpdateAutomationScheduleRequest) {
    return request<{ schedule: AutomationSchedule }>(`/api/automation/schedules/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(update),
    });
  },
  deleteSchedule(id: string) {
    return request<{ deleted: boolean }>(`/api/automation/schedules/${id}`, {
      method: 'DELETE',
    });
  },
  runNow(id: string, dryRun?: boolean) {
    return request<{ run: AutomationRun }>(`/api/automation/schedules/${id}/run`, {
      method: 'POST',
      body: JSON.stringify(dryRun === undefined ? {} : { dryRun }),
    });
  },
  listRuns(limit = 20) {
    return request<{ runs: AutomationRun[] }>(`/api/automation/runs?limit=${limit}`);
  },
  listRunEvents(runId: string, afterSeq = 0) {
    return request<{ events: AutomationRunEvent[] }>(
      `/api/automation/runs/${runId}/events?afterSeq=${afterSeq}`,
    );
  },
  listBoards() {
    return request<{ boards: AutomationBoard[] }>('/api/automation/boards');
  },
  getMcpStatus() {
    return request<McpConnectionStatus>('/api/automation/mcp');
  },
  connectMcp(serverUrl: string, apiKey: string) {
    return request<McpConnectionTest>('/api/automation/mcp', {
      method: 'PUT',
      body: JSON.stringify({ serverUrl, apiKey }),
    });
  },
  disconnectMcp() {
    return request<{ disconnected: boolean }>('/api/automation/mcp', {
      method: 'DELETE',
    });
  },
  testMcp() {
    return request<McpConnectionTest>('/api/automation/mcp/test', { method: 'POST' });
  },
};
