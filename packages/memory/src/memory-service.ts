import type { MemoryItem, MemoryKind, PersonalizationProfile } from './types.js';
import type { MemoryDbAdapter, MemoryRow } from './db-adapter.js';

export interface MemoryService {
  store(userId: string, kind: MemoryKind, content: string, metadata?: Record<string, unknown>): Promise<MemoryItem>;
  recall(userId: string, query: string, limit?: number): Promise<MemoryItem[]>;
  listByKind(userId: string, kind: MemoryKind): Promise<MemoryItem[]>;
  remove(id: string): Promise<void>;
  getProfile(userId: string): Promise<PersonalizationProfile>;
}

const VALID_MEMORY_KINDS: ReadonlySet<MemoryKind> = new Set([
  'fact',
  'preference',
  'relationship',
  'project',
  'person',
  'instruction',
]);

function toMemoryKind(kind: string): MemoryKind {
  if (VALID_MEMORY_KINDS.has(kind as MemoryKind)) {
    return kind as MemoryKind;
  }

  throw new Error(`Unknown memory kind: ${kind}`);
}

function toMemoryItem(row: MemoryRow): MemoryItem {
  return {
    id: row.id,
    userId: row.userId,
    kind: toMemoryKind(row.kind),
    content: row.content,
    metadata: row.metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toUniqueValues(values: string[]): string[] {
  const unique = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      unique.add(trimmed);
    }
  }
  return Array.from(unique);
}

export class MemoryServiceImpl implements MemoryService {
  constructor(private readonly adapter: MemoryDbAdapter) {}

  async store(userId: string, kind: MemoryKind, content: string, metadata?: Record<string, unknown>): Promise<MemoryItem> {
    const row = await this.adapter.insertMemory(userId, kind, content, metadata ?? {});
    return toMemoryItem(row);
  }

  async recall(userId: string, query: string, limit?: number): Promise<MemoryItem[]> {
    const rows = await this.adapter.searchMemories(userId, query, limit);
    return rows.map(toMemoryItem);
  }

  async listByKind(userId: string, kind: MemoryKind): Promise<MemoryItem[]> {
    const rows = await this.adapter.findMemories(userId, kind);
    return rows.map(toMemoryItem);
  }

  async remove(id: string): Promise<void> {
    await this.adapter.deleteMemory(id);
  }

  async getProfile(userId: string): Promise<PersonalizationProfile> {
    const [writingStylePref, tonePreferencePref, projectRows, instructionRows] = await Promise.all([
      this.adapter.getPreference(userId, 'writing_style'),
      this.adapter.getPreference(userId, 'tone_preference'),
      this.adapter.findMemories(userId, 'project', 10),
      this.adapter.findMemories(userId, 'instruction', 10),
    ]);

    return {
      userId,
      writingStyle: writingStylePref?.value ?? null,
      tonePreference: tonePreferencePref?.value ?? null,
      domainContext: toUniqueValues(projectRows.map((row) => row.content)),
      recentTopics: toUniqueValues(instructionRows.map((row) => row.content)),
    };
  }
}
