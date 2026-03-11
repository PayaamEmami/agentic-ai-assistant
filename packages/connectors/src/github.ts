import type { Connector, ConnectorAuth, ConnectorItem, SyncResult } from './types.js';

export class GitHubConnector implements Connector {
  kind = 'github' as const;

  async initialize(_auth: ConnectorAuth): Promise<void> {
    // TODO: initialize GitHub API client with token from auth.credentials
  }

  async list(_cursor?: string, _limit?: number): Promise<{ items: ConnectorItem[]; nextCursor: string | null }> {
    // TODO: list repositories or files
    return { items: [], nextCursor: null };
  }

  async read(_externalId: string): Promise<ConnectorItem | null> {
    // TODO: read file content from GitHub
    return null;
  }

  async search(_query: string, _limit?: number): Promise<ConnectorItem[]> {
    // TODO: use GitHub search API
    return [];
  }

  async sync(_cursor?: string): Promise<SyncResult> {
    // TODO: sync repositories/files incrementally
    return { itemsSynced: 0, errors: [], nextCursor: null };
  }
}
