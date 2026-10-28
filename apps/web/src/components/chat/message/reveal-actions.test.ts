import { describe, expect, it } from 'vitest';
import { shouldRevealMessageActions } from './reveal-actions';

describe('shouldRevealMessageActions', () => {
  it('reveals on a touch tap when nothing is selected', () => {
    expect(
      shouldRevealMessageActions({
        pointerType: 'touch',
        startX: 10,
        startY: 20,
        endX: 12,
        endY: 21,
        selectedText: '',
      }),
    ).toBe(true);
  });

  it('leaves a mouse pointer to hover', () => {
    expect(
      shouldRevealMessageActions({
        pointerType: 'mouse',
        startX: 0,
        startY: 0,
        endX: 0,
        endY: 0,
        selectedText: '',
      }),
    ).toBe(false);
  });

  it('keeps a drag that selected text from opening edit', () => {
    expect(
      shouldRevealMessageActions({
        pointerType: 'touch',
        startX: 0,
        startY: 0,
        endX: 40,
        endY: 4,
        selectedText: 'copy this',
      }),
    ).toBe(false);
    expect(
      shouldRevealMessageActions({
        pointerType: 'pen',
        startX: 0,
        startY: 0,
        endX: 4,
        endY: 2,
        selectedText: 'word',
      }),
    ).toBe(false);
  });
});
