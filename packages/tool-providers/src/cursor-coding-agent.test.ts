import { describe, expect, it, vi } from 'vitest';
import { CodingAgentError } from './coding-agent.js';
import { createCodingAgent } from './coding-agent-factory.js';
import { CursorCodingAgent, snapshotFromRun } from './cursor-coding-agent.js';

describe('createCodingAgent', () => {
  it('rejects an unknown provider', () => {
    expect(() => createCodingAgent({ provider: 'other', apiKey: 'key' })).toThrow(
      /Unsupported coding agent provider/,
    );
  });

  it('rejects a missing API key', () => {
    expect(() => createCodingAgent({ provider: 'cursor', apiKey: '  ' })).toThrow(CodingAgentError);
  });
});

describe('CursorCodingAgent', () => {
  it('starts a run without asking the provider to open a pull request', async () => {
    const request = vi.fn().mockResolvedValue({ agent: { id: 'bc-1' } });
    const agent = new CursorCodingAgent('secret', request);

    await expect(
      agent.start({
        repo: 'owner/repo',
        task: 'Fix the flaky test',
        baseBranch: 'main',
      }),
    ).resolves.toEqual({ externalId: 'bc-1' });

    const [url, init] = request.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.cursor.com/v1/agents');
    const body = JSON.parse(String(init.body)) as {
      autoCreatePR?: boolean;
      prompt: { text: string };
      repos: Array<{ url: string; startingRef?: string; prUrl?: string }>;
    };
    expect(body.autoCreatePR).toBeUndefined();
    expect(body.prompt.text).toContain('Fix the flaky test');
    expect(body.prompt.text).toContain('Run the repository\'s normal checks');
    expect(body.prompt.text).not.toMatch(/pull request/i);
    expect(body.repos).toEqual([
      { url: 'https://github.com/owner/repo', startingRef: 'main' },
    ]);
    expect(String(init.headers && (init.headers as Record<string, string>).Authorization)).toMatch(
      /^Basic /,
    );
  });

  it('passes an existing pull request only as context', async () => {
    const request = vi.fn().mockResolvedValue({ agent: { id: 'bc-2' } });
    const agent = new CursorCodingAgent('secret', request);

    await agent.start({
      repo: 'owner/repo',
      task: 'Address the review',
      pullRequestUrl: 'https://github.com/owner/repo/pull/4',
    });

    const body = JSON.parse(String((request.mock.calls[0] as [string, RequestInit])[1].body)) as {
      repos: Array<{ prUrl?: string }>;
    };
    expect(body.repos[0]?.prUrl).toBe('https://github.com/owner/repo/pull/4');
  });

  it('maps a finished run that only has a summary', () => {
    expect(snapshotFromRun({ status: 'FINISHED', result: 'Merged the fix.' })).toEqual({
      status: 'finished',
      summary: 'Merged the fix.',
    });
  });

  it('keeps branch and pull request links when the run produced them', () => {
    expect(
      snapshotFromRun({
        status: 'FINISHED',
        result: 'Opened the change.',
        git: {
          branches: [{ branch: 'agent/fix', prUrl: 'https://github.com/owner/repo/pull/9' }],
        },
      }),
    ).toEqual({
      status: 'finished',
      summary: 'Opened the change.',
      branch: 'agent/fix',
      pullRequestUrl: 'https://github.com/owner/repo/pull/9',
    });
  });

  it('reads the latest run when fetching', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ latestRunId: 'run-1' })
      .mockResolvedValueOnce({ status: 'RUNNING' });
    const agent = new CursorCodingAgent('secret', request);

    await expect(agent.fetch('bc-1')).resolves.toEqual({ status: 'running' });
    expect(request.mock.calls[1]?.[0]).toBe('https://api.cursor.com/v1/agents/bc-1/runs/run-1');
  });

  it('turns a missing repository into a generic failure', async () => {
    const request = vi.fn().mockRejectedValue(new Error('HTTP 404: Not Found - repository not found'));
    const agent = new CursorCodingAgent('secret', request);

    await expect(agent.start({ repo: 'owner/missing', task: 'Look around' })).rejects.toMatchObject({
      userMessage: 'That repository is not available to the coding agent.',
    });
  });
});
