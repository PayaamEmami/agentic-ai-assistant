import { describe, expect, it } from 'vitest';
import { WORKSPACE_TEXT_BOOST_CAP, scoreWorkspaceMatch } from './score.js';

describe('scoreWorkspaceMatch', () => {
  it('keeps a clearly closer chunk ahead of a farther chunk with a stronger title', () => {
    const closer = scoreWorkspaceMatch({
      distance: 0.05,
      query: 'quarterly roadmap',
      content: 'unrelated notes about the office kettle',
      title: 'Kitchen inventory',
    });
    const farther = scoreWorkspaceMatch({
      distance: 0.45,
      query: 'quarterly roadmap',
      content: 'quarterly roadmap for the platform rewrite',
      title: 'quarterly roadmap',
    });

    expect(closer).toBeGreaterThan(farther);
    expect(farther).toBeLessThanOrEqual(1 - 0.45 + WORKSPACE_TEXT_BOOST_CAP);
  });

  it('lets wording reorder only near neighbors', () => {
    const plain = scoreWorkspaceMatch({
      distance: 0.2,
      query: 'quarterly roadmap',
      content: 'notes',
      title: 'notes',
    });
    const titled = scoreWorkspaceMatch({
      distance: 0.22,
      query: 'quarterly roadmap',
      content: 'quarterly roadmap',
      title: 'quarterly roadmap',
    });

    expect(titled).toBeGreaterThan(plain);
    expect(titled).toBeCloseTo(1 - 0.22 + WORKSPACE_TEXT_BOOST_CAP, 10);
  });
});
