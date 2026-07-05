export type AppKind = 'github' | 'google';
export type AppCapability = 'knowledge' | 'tools';

export interface OAuthStatePayload {
  flowId: string;
  userId: string;
  appKind: AppKind;
  issuedAt: number;
  expiresAt: number;
}

export interface AppCapabilitySummary {
  capability: AppCapability;
  status: 'pending' | 'connected' | 'failed';
  lastSyncAt: string | null;
  lastSyncStatus: 'pending' | 'running' | 'completed' | 'failed' | null;
  lastError: string | null;
  hasCredentials: boolean;
  totalSourceCount: number;
  searchableSourceCount: number;
  recentSyncRuns: Array<{
    id: string;
    trigger: string;
    status: 'running' | 'completed' | 'failed';
    itemsDiscovered: number;
    itemsQueued: number;
    itemsDeleted: number;
    errorCount: number;
    errorSummary: string | null;
    startedAt: string;
    completedAt: string | null;
  }>;
  recentSources: Array<{
    id: string;
    kind: string;
    title: string;
    uri: string | null;
    mimeType: string | null;
    updatedAt: string;
  }>;
}

export interface AppSummary {
  kind: AppKind;
  displayName: string;
  status: 'pending' | 'connected' | 'failed';
  hasCredentials: boolean;
  lastError: string | null;
  selectedRepoCount?: number;
  knowledge: AppCapabilitySummary;
  tools: AppCapabilitySummary;
}

export interface GitHubRepositorySummary {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  defaultBranch: string;
  private: boolean;
  selected: boolean;
}
