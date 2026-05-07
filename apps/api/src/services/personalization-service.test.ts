import { describe, expect, it } from 'vitest';
import { buildPersonalContext } from './personalization-service.js';
import type { PersonalizationState } from './personalization-service.js';

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
});
