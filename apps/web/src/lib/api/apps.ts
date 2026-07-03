import type {
  AppCapabilitySummaryDto,
  AppSourceDto,
  AppSummaryDto,
  AppSyncRunDto,
  GitHubRepositoryDto,
} from '@aaa/shared';
import { request } from './client';

export type AppSyncRunSummary = AppSyncRunDto;
export type AppSourceSummary = AppSourceDto;
export type GitHubRepositorySummary = GitHubRepositoryDto;
export type AppCapabilitySummary = AppCapabilitySummaryDto;
export type AppSummary = AppSummaryDto;

export const appsApi = {
  list() {
    return request<{ apps: AppSummary[] }>('/api/apps');
  },
  connect(kind: 'github' | 'google') {
    return request<{ authorizationUrl: string }>(`/api/apps/${kind}/connect`, {
      method: 'POST',
    });
  },
  sync(kind: 'github' | 'google') {
    return request<{ queued: boolean }>(`/api/apps/${kind}/sync`, {
      method: 'POST',
    });
  },
  disconnect(kind: 'github' | 'google') {
    return request<{ ok: boolean }>(`/api/apps/${kind}`, {
      method: 'DELETE',
    });
  },
  listGitHubRepositories() {
    return request<{ repositories: GitHubRepositorySummary[] }>('/api/apps/github/repositories');
  },
  saveGitHubRepositories(repositoryIds: number[]) {
    return request<{ ok: boolean }>('/api/apps/github/repositories', {
      method: 'PUT',
      body: JSON.stringify({ repositoryIds }),
    });
  },
};
