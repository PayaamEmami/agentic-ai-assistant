import type { Connector, ConnectorAuth, ConnectorItem, SyncResult } from './types.js';

/**
 * Proton integration requires custom implementation.
 * This is an abstraction boundary for future Proton Bridge or API integration.
 */
export class ProtonConnector implements Connector {
  kind = 'proton_mail' as const;

  async initialize(_auth: ConnectorAuth): Promise<void> {
    // TODO: initialize Proton Bridge or API client
  }

  async list(_cursor?: string, _limit?: number): Promise<{ items: ConnectorItem[]; nextCursor: string | null }> {
    // TODO: list emails
    return { items: [], nextCursor: null };
  }

  async read(_externalId: string): Promise<ConnectorItem | null> {
    // TODO: read email content
    return null;
  }

  async search(_query: string, _limit?: number): Promise<ConnectorItem[]> {
    // TODO: search emails
    return [];
  }

  async sync(_cursor?: string): Promise<SyncResult> {
    // TODO: sync emails incrementally
    return { items: [], itemsSynced: 0, errors: [], nextCursor: null };
  }
}
