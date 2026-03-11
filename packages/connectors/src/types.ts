export type ConnectorKind = 'github' | 'google_drive' | 'google_docs' | 'proton_mail';

export interface ConnectorAuth {
  kind: ConnectorKind;
  credentials: Record<string, unknown>;
}

export interface ConnectorItem {
  externalId: string;
  title: string;
  content: string | null;
  mimeType: string;
  uri: string | null;
  updatedAt: Date | null;
  metadata: Record<string, unknown>;
}

export interface SyncResult {
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
