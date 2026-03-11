import type { MemoryItem, MemoryKind, PersonalizationProfile } from './types.js';

export interface MemoryService {
  store(userId: string, kind: MemoryKind, content: string, metadata?: Record<string, unknown>): Promise<MemoryItem>;
  recall(userId: string, query: string, limit?: number): Promise<MemoryItem[]>;
  listByKind(userId: string, kind: MemoryKind): Promise<MemoryItem[]>;
  remove(id: string): Promise<void>;
  getProfile(userId: string): Promise<PersonalizationProfile>;
}

export class MemoryServiceImpl implements MemoryService {
  async store(userId: string, kind: MemoryKind, content: string, metadata?: Record<string, unknown>): Promise<MemoryItem> {
    // TODO: implement with database and vector search
    const now = new Date();
    return {
      id: '',
      userId,
      kind,
      content,
      metadata: metadata ?? {},
      createdAt: now,
      updatedAt: now,
    };
  }

  async recall(_userId: string, _query: string, _limit?: number): Promise<MemoryItem[]> {
    // TODO: implement with database and vector search
    return [];
  }

  async listByKind(_userId: string, _kind: MemoryKind): Promise<MemoryItem[]> {
    // TODO: implement with database and vector search
    return [];
  }

  async remove(_id: string): Promise<void> {
    // TODO: implement with database and vector search
  }

  async getProfile(userId: string): Promise<PersonalizationProfile> {
    // TODO: implement with database and vector search
    return {
      userId,
      writingStyle: null,
      tonePreference: null,
      domainContext: [],
      recentTopics: [],
    };
  }
}
