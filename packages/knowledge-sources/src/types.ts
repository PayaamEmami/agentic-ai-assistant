export type KnowledgeSourceKind = 'github' | 'google';

export interface KnowledgeSourceAuth {
  kind: KnowledgeSourceKind;
  credentials: Record<string, unknown>;
  settings?: Record<string, unknown>;
  onRefresh?: (credentials: Record<string, unknown>) => Promise<void>;
}

export interface KnowledgeSourceItem {
  externalId: string;
  sourceKind: 'document' | 'web_page' | 'email' | 'code_repository';
  title: string;
  content: string | null;
  mimeType: string;
  uri: string | null;
  updatedAt: Date | null;
  metadata: Record<string, unknown>;
}

export interface KnowledgeSyncResult {
  items: KnowledgeSourceItem[];
  itemsSynced: number;
  errors: Array<{ externalId: string; error: string }>;
  nextCursor: string | null;
}

export interface KnowledgeSource {
  kind: KnowledgeSourceKind;
  initialize(auth: KnowledgeSourceAuth): Promise<void>;
  list(
    cursor?: string,
    limit?: number,
  ): Promise<{ items: KnowledgeSourceItem[]; nextCursor: string | null }>;
  read(externalId: string): Promise<KnowledgeSourceItem | null>;
  search(query: string, limit?: number): Promise<KnowledgeSourceItem[]>;
  sync(cursor?: string): Promise<KnowledgeSyncResult>;
}
