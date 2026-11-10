import { describe, expect, it } from 'vitest';
import { codingTaskCardContent } from './coding-task-card';

describe('codingTaskCardContent', () => {
  it('reads a summary without requiring a pull request', () => {
    expect(codingTaskCardContent({ summary: 'Merged the fix.', repo: 'owner/repo' })).toEqual({
      summary: 'Merged the fix.',
    });
  });

  it('keeps a branch and pull request when they are present', () => {
    expect(
      codingTaskCardContent({
        summary: 'Pushed the branch.',
        branch: 'agent/fix',
        pullRequestUrl: 'https://github.com/owner/repo/pull/3',
      }),
    ).toEqual({
      summary: 'Pushed the branch.',
      branch: 'agent/fix',
      pullRequestUrl: 'https://github.com/owner/repo/pull/3',
    });
  });

  it('ignores a non-http link', () => {
    expect(codingTaskCardContent({ summary: 'Done.', pullRequestUrl: 'cursor://agent' })).toEqual({
      summary: 'Done.',
    });
  });
});