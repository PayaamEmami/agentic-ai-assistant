import { describe, expect, it, vi } from 'vitest';
import { GitHubApiClient, buildGitHubHeaders, type GitHubHttpClient } from './github.js';

describe('buildGitHubHeaders', () => {
  it('includes auth and versioned accept headers', () => {
    expect(buildGitHubHeaders('tok')).toEqual({
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer tok',
      'User-Agent': 'agentic-ai-assistant',
      'X-GitHub-Api-Version': '2022-11-28',
    });
  });

  it('merges and overrides with extra headers', () => {
    expect(buildGitHubHeaders('tok', { Accept: 'application/vnd.github.raw+json' }).Accept).toBe(
      'application/vnd.github.raw+json',
    );
  });
});

describe('GitHubApiClient.listRepositories', () => {
  it('paginates until a short page and maps to canonical shape', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: index,
      name: `repo-${index}`,
      full_name: `owner/repo-${index}`,
      private: false,
      default_branch: 'main',
      owner: { login: 'owner' },
    }));
    const secondPage = [
      {
        id: 100,
        name: 'last',
        full_name: 'owner/last',
        private: true,
        default_branch: 'develop',
        owner: { login: 'owner' },
      },
    ];
    const requestJson = vi
      .fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(secondPage);
    const http: GitHubHttpClient = { requestJson, requestText: vi.fn() };

    const client = new GitHubApiClient('tok', http);
    const repos = await client.listRepositories();

    expect(requestJson).toHaveBeenCalledTimes(2);
    expect(repos).toHaveLength(101);
    expect(repos[100]).toEqual({
      id: 100,
      name: 'last',
      fullName: 'owner/last',
      owner: 'owner',
      defaultBranch: 'develop',
      private: true,
    });
  });

  it('stops on an empty page', async () => {
    const requestJson = vi.fn().mockResolvedValueOnce([]);
    const http: GitHubHttpClient = { requestJson, requestText: vi.fn() };

    const repos = await new GitHubApiClient('tok', http).listRepositories();

    expect(requestJson).toHaveBeenCalledTimes(1);
    expect(repos).toEqual([]);
  });
});

describe('GitHubApiClient.getFileContent', () => {
  it('decodes base64 content without a second request', async () => {
    const requestJson = vi.fn().mockResolvedValue({
      encoding: 'base64',
      content: Buffer.from('hello world').toString('base64'),
      sha: 'abc',
      size: 11,
    });
    const requestText = vi.fn();
    const http: GitHubHttpClient = { requestJson, requestText };

    const result = await new GitHubApiClient('tok', http).getFileContent('owner/repo', 'a/b.ts');

    expect(result).toEqual({ content: 'hello world', sha: 'abc', size: 11 });
    expect(requestText).not.toHaveBeenCalled();
  });

  it('falls back to raw text when content is not inlined', async () => {
    const requestJson = vi.fn().mockResolvedValue({ sha: 'def', size: 3 });
    const requestText = vi.fn().mockResolvedValue('raw');
    const http: GitHubHttpClient = { requestJson, requestText };

    const result = await new GitHubApiClient('tok', http).getFileContent(
      'owner/repo',
      'dir/name.txt',
      'main',
    );

    expect(result).toEqual({ content: 'raw', sha: 'def', size: 3 });
    expect(requestText).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/repo/contents/dir/name.txt?ref=main',
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: 'application/vnd.github.raw+json' }),
      }),
    );
  });
});
