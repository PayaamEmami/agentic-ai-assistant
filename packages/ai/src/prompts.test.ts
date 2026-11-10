import { describe, expect, it } from 'vitest';
import { buildChatTurnPrompt, buildSystemPrompt } from './prompts.js';

describe('buildChatTurnPrompt', () => {
  it('does not tell the model that excerpts are already in the prompt', () => {
    const prompt = buildChatTurnPrompt({
      availableTools: [{ name: 'search_workspace', description: 'Search notes' }],
    });

    expect(prompt).not.toContain('already present');
    expect(prompt).toContain('Call search_workspace');
    expect(prompt).toContain('[Source N]');
  });
});

describe('buildSystemPrompt', () => {
  it('keeps the injected-context guidance when a caller pastes excerpts in', () => {
    const prompt = buildSystemPrompt({});

    expect(prompt).toContain('already present');
  });
});
