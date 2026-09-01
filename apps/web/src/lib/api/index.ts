import { appsApi } from './apps';
import { approvalsApi } from './approvals';
import { automationApi } from './automation';
import { authApi } from './auth';
import { chatApi } from './chat';
import { personalizationApi } from './personalization';
import { uploadApi } from './upload';
import { voiceApi } from './voice';
import { listenerApi } from './listener';

export {
  API_BASE,
  ApiError,
  buildWebSocketUrl,
  clearStoredAuthToken,
  getStoredAuthToken,
  setStoredAuthToken,
} from './client';

export type { ConversationSummaryResponse } from './chat';
export type {
  AppCapabilitySummary,
  AppSourceSummary,
  AppSummary,
  AppSyncRunSummary,
  GitHubRepositorySummary,
} from './apps';
export type {
  AutomationBoard,
  AutomationRun,
  AutomationRunEvent,
  AutomationSchedule,
  McpConnectionList,
  McpConnectionStatus,
  McpConnectionTest,
} from './automation';
export type {
  PersonalizationMemory,
  PersonalizationMemoryKind,
  PersonalizationProfile,
} from './personalization';

export const api = {
  auth: authApi,
  chat: chatApi,
  upload: uploadApi,
  approvals: approvalsApi,
  apps: appsApi,
  automation: automationApi,
  voice: voiceApi,
  listener: listenerApi,
  personalization: personalizationApi,
};
