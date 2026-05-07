import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withGitHubProvider, withGoogleProvider } from './providers.js';

const mocks = vi.hoisted(() => ({
  findByUserAppAndCapability: vi.fn(),
  updateCredentialsByUserAndApp: vi.fn(),
  decryptCredentials: vi.fn(),
  encryptCredentials: vi.fn(),
  githubProvider: vi.fn(),
  googleProvider: vi.fn(),
}));

vi.mock('@aaa/db', () => ({
  appCapabilityConfigRepository: {
    findByUserAppAndCapability: mocks.findByUserAppAndCapability,
    updateCredentialsByUserAndApp: mocks.updateCredentialsByUserAndApp,
  },
}));

vi.mock('@aaa/knowledge-sources', () => ({
  decryptCredentials: mocks.decryptCredentials,
  encryptCredentials: mocks.encryptCredentials,
}));

vi.mock('@aaa/tool-providers', () => ({
  GitHubToolProvider: mocks.githubProvider,
  GoogleDriveToolProvider: mocks.googleProvider,
}));

describe('tool execution provider wrappers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a failed result when GitHub tools are not connected', async () => {
    mocks.findByUserAppAndCapability.mockResolvedValue(null);

    const result = await withGitHubProvider('user-1', async () => ({ ok: true }));

    expect(result).toEqual({
      success: false,
      result: null,
      error: 'GitHub app is not connected',
    });
    expect(mocks.findByUserAppAndCapability).toHaveBeenCalledWith('user-1', 'github', 'tools');
    expect(mocks.decryptCredentials).not.toHaveBeenCalled();
    expect(mocks.githubProvider).not.toHaveBeenCalled();
  });

  it('returns a failed result when Google tools are not connected', async () => {
    mocks.findByUserAppAndCapability.mockResolvedValue(null);

    const result = await withGoogleProvider('user-1', async () => ({ ok: true }));

    expect(result).toEqual({
      success: false,
      result: null,
      error: 'Google app is not connected',
    });
    expect(mocks.findByUserAppAndCapability).toHaveBeenCalledWith('user-1', 'google', 'tools');
    expect(mocks.decryptCredentials).not.toHaveBeenCalled();
    expect(mocks.googleProvider).not.toHaveBeenCalled();
  });
});
