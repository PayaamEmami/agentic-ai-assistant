export type ConnectorKind = 'github' | 'google_docs';

export interface ConnectorAuth {
  kind: ConnectorKind;
  credentials: Record<string, unknown>;
  settings?: Record<string, unknown>;
}

export interface ConnectorItem {
  externalId: string;
  sourceKind: 'document' | 'web_page' | 'email' | 'code_repository';
  title: string;
  content: string | null;
  mimeType: string;
  uri: string | null;
  updatedAt: Date | null;
  metadata: Record<string, unknown>;
}

export interface SyncResult {
  items: ConnectorItem[];
  itemsSynced: number;
  errors: Array<{ externalId: string; error: string }>;
  nextCursor: string | null;
}

export interface Connector {
  kind: ConnectorKind;
  initialize(auth: ConnectorAuth): Promise<void>;
  list(cursor?: string, limit?: number): Promise<{ items: ConnectorItem[]; nextCursor: string | null }>;
  read(externalId: string): Promise<ConnectorItem | null>;
  search(query: string, limit?: number): Promise<ConnectorItem[]>;
  sync(cursor?: string): Promise<SyncResult>;
}
