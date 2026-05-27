import { type PersonalizationMemory, type PersonalizationMemoryKind } from '@/lib/api-client';

export const MEMORY_KIND_ORDER: PersonalizationMemoryKind[] = [
  'fact',
  'preference',
  'relationship',
  'project',
  'person',
  'instruction',
];

export const MEMORY_KIND_LABELS: Record<PersonalizationMemoryKind, string> = {
  fact: 'Facts',
  preference: 'Preferences',
  relationship: 'Relationships',
  project: 'Projects',
  person: 'People',
  instruction: 'Instructions',
};

export const MEMORY_KIND_SINGULAR_LABELS: Record<PersonalizationMemoryKind, string> = {
  fact: 'fact',
  preference: 'preference',
  relationship: 'relationship',
  project: 'project',
  person: 'person',
  instruction: 'instruction',
};

export function sortMemories(memories: PersonalizationMemory[]) {
  return [...memories].sort((left, right) => {
    const kindDelta = MEMORY_KIND_ORDER.indexOf(left.kind) - MEMORY_KIND_ORDER.indexOf(right.kind);
    if (kindDelta !== 0) {
      return kindDelta;
    }

    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });
}
