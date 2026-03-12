export interface MemoryRow {
  id: string;
  userId: string;
  kind: string;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface PreferenceRow {
  key: string;
  value: string;
  updatedAt: Date;
}

export interface MemoryDbAdapter {
  insertMemory(
    userId: string,
    kind: string,
    content: string,
    metadata: Record<string, unknown>,
  ): Promise<MemoryRow>;
  findMemories(userId: string, kind?: string, limit?: number): Promise<MemoryRow[]>;
  searchMemories(userId: string, query: string, limit?: number): Promise<MemoryRow[]>;
  deleteMemory(id: string): Promise<void>;
  getPreferences(userId: string): Promise<PreferenceRow[]>;
  getPreference(userId: string, key: string): Promise<PreferenceRow | null>;
  upsertPreference(userId: string, key: string, value: string): Promise<void>;
}
