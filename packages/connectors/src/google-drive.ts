import type { Connector, ConnectorAuth, ConnectorItem, SyncResult } from './types.js';

export class GoogleDriveConnector implements Connector {
  kind = 'google_drive' as const;

  async initialize(_auth: ConnectorAuth): Promise<void> {
    // TODO: initialize Google Drive API client with OAuth credentials
  }

  async list(_cursor?: string, _limit?: number): Promise<{ items: ConnectorItem[]; nextCursor: string | null }> {
    // TODO: list files from Google Drive
    return { items: [], nextCursor: null };
  }

  async read(_externalId: string): Promise<ConnectorItem | null> {
    // TODO: download and read file content
    return null;
  }

  async search(_query: string, _limit?: number): Promise<ConnectorItem[]> {
    // TODO: use Google Drive search API
    return [];
  }

  async sync(_cursor?: string): Promise<SyncResult> {
    // TODO: sync files incrementally using changes API
    return { itemsSynced: 0, errors: [], nextCursor: null };
  }
}
