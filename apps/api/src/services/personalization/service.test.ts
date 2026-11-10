import type { MemoryItem, MemoryKind } from '@aaa/memory';
import { describe, expect, it } from 'vitest';
import { buildPersonalContext, selectMemoriesForContext } from './service.js';
import type { PersonalizationState } from './service.js';

function state(overrides: Partial<PersonalizationState>): PersonalizationState {
  return {
    profile: {
      writingStyle: null,
      tonePreference: null,
    },
    memories: [],
    ...overrides,
  };
}

describe('buildPersonalContext', () => {
  it('returns undefined when no personalization data exists', () => {
    expect(buildPersonalContext(state({}))).toBeUndefined();
  });

  it('includes profile preferences and recent memories by kind', () => {
    const context = buildPersonalContext(
      state({
        profile: {
          writingStyle: 'Concise and direct',
          tonePreference: 'Warm',
        },
        memories: [
          {
            id: 'memory-old',
            userId: 'user-1',
            kind: 'project',
            content: 'Old project note',
            metadata: {},
            createdAt: new Date('2024-01-01T00:00:00Z'),
            updatedAt: new Date('2024-01-01T00:00:00Z'),
          },
          {
            id: 'memory-new',
            userId: 'user-1',
            kind: 'project',
            content: 'New project note',
            metadata: {},
            createdAt: new Date('2024-02-01T00:00:00Z'),
            updatedAt: new Date('2024-02-01T00:00:00Z'),
          },
        ],
      }),
    );

    expect(context).toContain('User profile:');
    expect(context).toContain('- Writing style: Concise and direct');
    expect(context).toContain('- Tone preference: Warm');
    expect(context).toContain('Projects:\n- New project note\n- Old project note');
  });

  it('puts a matching older fact ahead of newer unrelated memories', () => {
    const memories = [
      memory('sister', 'fact', 'Sister lives in Seattle', '2020-01-01T00:00:00Z'),
      memory('kettle', 'fact', 'Bought a new kettle', '2024-06-01T00:00:00Z'),
      memory('piano', 'fact', 'Learning piano this year', '2025-01-01T00:00:00Z'),
    ];
    const selected = selectMemoriesForContext(memories, 'Where does my sister live?');

    expect(selected.map((item) => item.id)).toEqual(['sister', 'piano', 'kettle']);

    const context = buildPersonalContext(
      state({
        memories,
      }),
      'Where does my sister live?',
    );
    expect(context?.indexOf('Seattle')).toBeGreaterThan(-1);
    expect(context?.indexOf('Seattle')).toBeLessThan(context?.indexOf('kettle') ?? -1);
  });

  it('keeps a few recent memories when the message shares no words', () => {
    const memories = [
      memory('older', 'project', 'Older project note', '2024-01-01T00:00:00Z'),
      memory('newer', 'project', 'Newer project note', '2025-01-01T00:00:00Z'),
    ];

    expect(selectMemoriesForContext(memories, 'zzzzqqqq').map((item) => item.id)).toEqual([
      'newer',
      'older',
    ]);
  });

  it('always includes instruction memories', () => {
    const memories = [
      memory('instruction', 'instruction', 'Always answer briefly', '2020-01-01T00:00:00Z'),
      memory('fact', 'fact', 'Bought a new kettle', '2025-01-01T00:00:00Z'),
    ];
    const selected = selectMemoriesForContext(memories, 'zzzzqqqq');

    expect(selected.map((item) => item.id)).toEqual(['instruction', 'fact']);
  });
});

function memory(id: string, kind: MemoryKind, content: string, updatedAt: string): MemoryItem {
  const timestamp = new Date(updatedAt);
  return {
    id,
    userId: 'user-1',
    kind,
    content,
    metadata: {},
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
