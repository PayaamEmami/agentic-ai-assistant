import {
  MemoryServiceImpl,
  PgMemoryAdapter,
  type MemoryItem,
  type MemoryKind,
  type MemoryService,
} from '@aaa/memory';
import { getPool } from '@aaa/db';
import { AppError } from '../../lib/errors.js';

const MEMORY_KIND_LABELS: Record<MemoryKind, string> = {
  fact: 'Facts',
  preference: 'Preferences',
  relationship: 'Relationships',
  project: 'Projects',
  person: 'People',
  instruction: 'Instructions',
};
const MAX_INSTRUCTIONS = 4;
const MIN_CONTEXT_MEMORIES = 4;
const MAX_MEMORY_CONTENT_CHARS = 180;
const MAX_PERSONAL_CONTEXT_CHARS = 2500;
const QUERY_STOPWORDS = new Set([
  'about',
  'does',
  'from',
  'have',
  'info',
  'information',
  'know',
  'like',
  'show',
  'tell',
  'that',
  'them',
  'they',
  'this',
  'what',
  'when',
  'where',
  'which',
  'with',
  'would',
  'your',
  'you',
  'me',
  'my',
]);

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

function queryTokens(query: string | undefined): string[] {
  if (!query) {
    return [];
  }

  return Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3 && !QUERY_STOPWORDS.has(token)),
    ),
  );
}

function tokenOverlap(tokens: string[], content: string): number {
  if (tokens.length === 0) {
    return 0;
  }

  const contentTokens = new Set(
    content
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3),
  );
  let matches = 0;
  for (const token of tokens) {
    if (contentTokens.has(token)) {
      matches += 1;
    }
  }
  return matches / tokens.length;
}

function byUpdatedDesc(left: MemoryItem, right: MemoryItem): number {
  return right.updatedAt.getTime() - left.updatedAt.getTime();
}

export function selectMemoriesForContext(
  memories: MemoryItem[],
  query?: string,
): MemoryItem[] {
  const instructions = memories
    .filter((memory) => memory.kind === 'instruction')
    .sort(byUpdatedDesc)
    .slice(0, MAX_INSTRUCTIONS);
  const others = memories.filter((memory) => memory.kind !== 'instruction');
  const tokens = queryTokens(query);
  if (tokens.length === 0) {
    return [...instructions, ...others.sort(byUpdatedDesc).slice(0, MIN_CONTEXT_MEMORIES)];
  }

  const ranked = others
    .map((memory) => ({ memory, overlap: tokenOverlap(tokens, memory.content) }))
    .sort((left, right) => {
      if (right.overlap !== left.overlap) {
        return right.overlap - left.overlap;
      }
      return byUpdatedDesc(left.memory, right.memory);
    });
  const matched = ranked.filter((item) => item.overlap > 0).map((item) => item.memory);
  const unmatched = ranked.filter((item) => item.overlap === 0).map((item) => item.memory);

  return [...instructions, ...matched, ...unmatched];
}

function appendMemorySection(sections: string[], kind: MemoryKind, items: MemoryItem[]): void {
  if (items.length === 0) {
    return;
  }

  const lines = items.map(
    (memory) => `- ${truncateText(memory.content, MAX_MEMORY_CONTENT_CHARS)}`,
  );
  sections.push(`${MEMORY_KIND_LABELS[kind]}:\n${lines.join('\n')}`);
}

export function buildPersonalContext(
  state: PersonalizationState,
  query?: string,
): string | undefined {
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

  const selected = selectMemoriesForContext(state.memories, query);
  appendMemorySection(
    sections,
    'instruction',
    selected.filter((memory) => memory.kind === 'instruction'),
  );

  const groups: Array<{ kind: MemoryKind; items: MemoryItem[] }> = [];
  for (const memory of selected) {
    if (memory.kind === 'instruction') {
      continue;
    }
    const group = groups.find((candidate) => candidate.kind === memory.kind);
    if (group) {
      group.items.push(memory);
      continue;
    }
    groups.push({ kind: memory.kind, items: [memory] });
  }
  for (const group of groups) {
    appendMemorySection(sections, group.kind, group.items);
  }

  if (sections.length === 0) {
    return undefined;
  }

  const combined = sections.join('\n\n');
  return truncateMultilineText(combined, MAX_PERSONAL_CONTEXT_CHARS);
}

export class PersonalizationService {
  private readonly memoryService: MemoryService;

  constructor(memoryService?: MemoryService) {
    this.memoryService = memoryService ?? new MemoryServiceImpl(new PgMemoryAdapter(getPool()));
  }

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

  async getPersonalContext(userId: string, query?: string): Promise<string | undefined> {
    return buildPersonalContext(await this.getPersonalization(userId), query);
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

  async createMemory(userId: string, kind: MemoryKind, content: string): Promise<MemoryItem> {
    return this.memoryService.store(userId, kind, content.trim(), { source: 'manual' });
  }

  async updateMemory(userId: string, memoryId: string, content: string): Promise<MemoryItem> {
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
