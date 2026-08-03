import { describe, expect, it } from 'vitest';
import { selectionInside } from '@/lib/listener/selection';

describe('selectionInside', () => {
  it('returns text only when both selection ends belong to the transcript', () => {
    const inside = {} as Node;
    const outside = {} as Node;
    const root = {
      contains: (node: Node) => node === inside,
    } as unknown as Node;

    expect(
      selectionInside(root, {
        anchorNode: inside,
        focusNode: inside,
        toString: () => ' selected concept ',
      }),
    ).toBe('selected concept');
    expect(
      selectionInside(root, {
        anchorNode: inside,
        focusNode: outside,
        toString: () => 'not contained',
      }),
    ).toBe('');
  });
});
