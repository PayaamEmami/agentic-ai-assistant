import {
  MemoryServiceImpl,
  PgMemoryAdapter,
  type MemoryItem,
  type MemoryKind,
} from '@aaa/memory';
import { getPool } from '@aaa/db';
import { AppError } from '../lib/errors.js';

const MEMORY_KIND_ORDER: MemoryKind[] = [
  'fact',
  'preference',
  'relationship',
  'project',
  'person',
  'instruction',
];
const MEMORY_KIND_LABELS: Record<MemoryKind, string> = {
  fact: 'Facts',
  preference: 'Preferences',
  relationship: 'Relationships',
  project: 'Projects',
  person: 'People',
  instruction: 'Instructions',
};
const MAX_MEMORIES_PER_KIND = 2;
const MAX_MEMORY_CONTENT_CHARS = 180;
const MAX_PERSONAL_CONTEXT_CHARS = 2500;

export interface PersonalizationProfileState {
  writingStyle: string | null;
  tonePreference: string | null;
}

export interface PersonalizationState {
  profile: PersonalizationProfileState;
  memories: MemoryItem[];
}

function truncateText(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function truncateMultilineText(value: string, maxChars: number): string {
  const normalized = value.trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function trimNullable(value: string | null | undefined): string | null | undefined {
  if (typeof value === 'undefined') {
    return undefined;
  }

  const normalized = value?.trim() ?? '';
  return normalized.length > 0 ? normalized : null;
}

export function buildPersonalContext(state: PersonalizationState): string | undefined {
  const sections: string[] = [];

  const profileLines: string[] = [];
  if (state.profile.writingStyle) {
    profileLines.push(`- Writing style: ${truncateText(state.profile.writingStyle, 220)}`);
  }
  if (state.profile.tonePreference) {
    profileLines.push(`- Tone preference: ${truncateText(state.profile.tonePreference, 220)}`);
  }
  if (profileLines.length > 0) {
    sections.push(`User profile:\n${profileLines.join('\n')}`);
  }

  for (const kind of MEMORY_KIND_ORDER) {
    const items = state.memories
      .filter((memory) => memory.kind === kind)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, MAX_MEMORIES_PER_KIND);

    if (items.length === 0) {
      continue;
    }

    const lines = items.map(
      (memory) => `- ${truncateText(memory.content, MAX_MEMORY_CONTENT_CHARS)}`,
    );
    sections.push(`${MEMORY_KIND_LABELS[kind]}:\n${lines.join('\n')}`);
  }

  if (sections.length === 0) {
    return undefined;
  }

  const combined = sections.join('\n\n');
  return truncateMultilineText(combined, MAX_PERSONAL_CONTEXT_CHARS);
}

export class PersonalizationService {
  private readonly memoryService = new MemoryServiceImpl(
    new PgMemoryAdapter(getPool()),
  );

  async getPersonalization(userId: string): Promise<PersonalizationState> {
    const [profile, memories] = await Promise.all([
      this.memoryService.getProfile(userId),
      this.memoryService.listAll(userId),
    ]);

    return {
      profile: {
        writingStyle: profile.writingStyle,
        tonePreference: profile.tonePreference,
      },
      memories,
    };
  }

  async getPersonalContext(userId: string): Promise<string | undefined> {
    return buildPersonalContext(await this.getPersonalization(userId));
  }

  async updateProfile(
    userId: string,
    input: {
      writingStyle?: string | null;
      tonePreference?: string | null;
    },
  ): Promise<PersonalizationProfileState> {
    const profile = await this.memoryService.updateProfile(userId, {
      writingStyle: trimNullable(input.writingStyle),
      tonePreference: trimNullable(input.tonePreference),
    });

    return {
      writingStyle: profile.writingStyle,
      tonePreference: profile.tonePreference,
    };
  }

  async createMemory(
    userId: string,
    kind: MemoryKind,
    content: string,
  ): Promise<MemoryItem> {
    return this.memoryService.store(userId, kind, content.trim(), { source: 'manual' });
  }

  async updateMemory(
    userId: string,
    memoryId: string,
    content: string,
  ): Promise<MemoryItem> {
    const existing = await this.memoryService.get(userId, memoryId);
    if (!existing) {
      throw new AppError(404, 'Memory not found', 'MEMORY_NOT_FOUND');
    }

    return this.memoryService.update(userId, memoryId, content.trim(), existing.metadata);
  }

  async deleteMemory(userId: string, memoryId: string): Promise<void> {
    const existing = await this.memoryService.get(userId, memoryId);
    if (!existing) {
      throw new AppError(404, 'Memory not found', 'MEMORY_NOT_FOUND');
    }

    await this.memoryService.remove(userId, memoryId);
  }
}
