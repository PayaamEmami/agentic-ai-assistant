import { z } from 'zod';
import { AppCapabilityValues, AppKindValues } from './enum-values.js';

export const AppKindDto = z.enum(AppKindValues);
export type AppKindDto = z.infer<typeof AppKindDto>;

export const AppCapabilityDto = z.enum(AppCapabilityValues);
export type AppCapabilityDto = z.infer<typeof AppCapabilityDto>;

export const AppStatusDto = z.enum(['pending', 'connected', 'failed']);
export type AppStatusDto = z.infer<typeof AppStatusDto>;

export const AppSyncStatusDto = z.enum(['pending', 'running', 'completed', 'failed']);
export type AppSyncStatusDto = z.infer<typeof AppSyncStatusDto>;

export const AppSyncRunDto = z.object({
  id: z.string().uuid(),
  trigger: z.string(),
  status: z.enum(['running', 'completed', 'failed']),
  itemsDiscovered: z.number().int().nonnegative(),
  itemsQueued: z.number().int().nonnegative(),
  itemsDeleted: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  errorSummary: z.string().nullable(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});
export type AppSyncRunDto = z.infer<typeof AppSyncRunDto>;

export const AppSourceDto = z.object({
  id: z.string().uuid(),
  kind: z.string(),
  title: z.string(),
  uri: z.string().nullable(),
  mimeType: z.string().nullable(),
  updatedAt: z.string().datetime(),
});
export type AppSourceDto = z.infer<typeof AppSourceDto>;

export const AppCapabilitySummaryDto = z.object({
  capability: AppCapabilityDto,
  status: AppStatusDto,
  lastSyncAt: z.string().datetime().nullable(),
  lastSyncStatus: AppSyncStatusDto.nullable(),
  lastError: z.string().nullable(),
  hasCredentials: z.boolean(),
  totalSourceCount: z.number().int().nonnegative().default(0),
  searchableSourceCount: z.number().int().nonnegative().default(0),
  recentSyncRuns: z.array(AppSyncRunDto).default([]),
  recentSources: z.array(AppSourceDto).default([]),
});
export type AppCapabilitySummaryDto = z.infer<typeof AppCapabilitySummaryDto>;

export const AppSummaryDto = z.object({
  kind: AppKindDto,
  displayName: z.string(),
  status: AppStatusDto,
  hasCredentials: z.boolean(),
  lastError: z.string().nullable(),
  selectedRepoCount: z.number().int().nonnegative().optional(),
  knowledge: AppCapabilitySummaryDto,
  tools: AppCapabilitySummaryDto,
});
export type AppSummaryDto = z.infer<typeof AppSummaryDto>;

export const AppListResponse = z.object({
  apps: z.array(AppSummaryDto),
});
export type AppListResponse = z.infer<typeof AppListResponse>;

export const AppConnectResponse = z.object({
  authorizationUrl: z.string().url(),
});
export type AppConnectResponse = z.infer<typeof AppConnectResponse>;

export const AppSyncResponse = z.object({
  queued: z.boolean(),
});
export type AppSyncResponse = z.infer<typeof AppSyncResponse>;

export const AppDisconnectResponse = z.object({
  ok: z.literal(true),
});
export type AppDisconnectResponse = z.infer<typeof AppDisconnectResponse>;

export const GitHubRepositoryDto = z.object({
  id: z.number().int(),
  name: z.string(),
  fullName: z.string(),
  owner: z.string(),
  defaultBranch: z.string(),
  private: z.boolean(),
  selected: z.boolean(),
});
export type GitHubRepositoryDto = z.infer<typeof GitHubRepositoryDto>;

export const GitHubRepositoriesResponse = z.object({
  repositories: z.array(GitHubRepositoryDto),
});
export type GitHubRepositoriesResponse = z.infer<typeof GitHubRepositoriesResponse>;

export const GitHubRepoSelectionRequest = z.object({
  repositoryIds: z.array(z.number().int()).max(100),
});
export type GitHubRepoSelectionRequest = z.infer<typeof GitHubRepoSelectionRequest>;
