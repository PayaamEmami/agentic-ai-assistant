import { appCapabilityConfigRepository } from '@aaa/db';
import { decryptCredentials, encryptCredentials } from '@aaa/knowledge-sources';
import { McpClient } from '@aaa/mcp';
import { GitHubToolProvider, GoogleDriveToolProvider } from '@aaa/tool-providers';
import type { ToolExecutionResult } from './types.js';
import { asString, requireString } from './validation.js';

export async function resolveGitHubRepo(
  repo: string,
  provider: GitHubToolProvider,
): Promise<string> {
  const trimmedRepo = repo.trim();
  if (!trimmedRepo) {
    throw new Error('Expected "repo" to be a non-empty string');
  }

  if (trimmedRepo.includes('/')) {
    return trimmedRepo;
  }

  const normalizedRepo = trimmedRepo.toLowerCase();
  const accessibleRepos = await provider.listRepositories();
  const accessibleMatches = accessibleRepos.filter((repoRef) => {
    const normalizedName = repoRef.name.toLowerCase();
    const normalizedFullName = repoRef.fullName.toLowerCase();
    return (
      normalizedName === normalizedRepo ||
      normalizedFullName === normalizedRepo ||
      normalizedFullName.endsWith(`/${normalizedRepo}`)
    );
  });

  if (accessibleMatches.length === 1) {
    return accessibleMatches[0]!.fullName;
  }

  if (accessibleMatches.length > 1) {
    throw new Error(
      `Repository "${trimmedRepo}" is ambiguous. Use the full GitHub repository name (owner/repo). Matches: ${accessibleMatches
        .map((repoRef) => repoRef.fullName)
        .join(', ')}`,
    );
  }

  throw new Error(
    `Repository "${trimmedRepo}" did not match any GitHub repository accessible to this app. Use the full GitHub repository name (owner/repo).`,
  );
}

/** Reads the user's GitHub access token, throwing when the app is not connected. */
export async function resolveGitHubToken(userId: string): Promise<string> {
  const config = await appCapabilityConfigRepository.findByUserAppAndCapability(
    userId,
    'github',
    'tools',
  );
  if (!config) {
    throw new Error('GitHub app is not connected');
  }

  return requireString(decryptCredentials(config.encryptedCredentials), 'accessToken');
}

export async function withGitHubProvider(
  userId: string,
  handler: (provider: GitHubToolProvider, token: string) => Promise<unknown>,
): Promise<ToolExecutionResult> {
  try {
    const token = await resolveGitHubToken(userId);
    const provider = new GitHubToolProvider(token);
    return { success: true, result: await handler(provider, token) };
  } catch (error) {
    return {
      success: false,
      result: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Builds an MCP client from the user's stored connection. Kept separate from
 * `withMcpClient` so automation jobs can reuse the client without the
 * ToolExecutionResult wrapper.
 */
export async function resolveMcpClient(userId: string): Promise<McpClient> {
  const config = await appCapabilityConfigRepository.findByUserAppAndCapability(
    userId,
    'mcp',
    'tools',
  );
  if (!config || config.status !== 'connected') {
    throw new Error('No MCP server is connected');
  }

  const credentials = decryptCredentials(config.encryptedCredentials);
  return new McpClient({
    serverUrl: requireString(config.settings, 'serverUrl'),
    apiKey: requireString(credentials, 'apiKey'),
  });
}

export async function withMcpClient(
  userId: string,
  handler: (client: McpClient) => Promise<unknown>,
): Promise<ToolExecutionResult> {
  try {
    return { success: true, result: await handler(await resolveMcpClient(userId)) };
  } catch (error) {
    return {
      success: false,
      result: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function withGoogleProvider(
  userId: string,
  handler: (provider: GoogleDriveToolProvider) => Promise<unknown>,
): Promise<ToolExecutionResult> {
  try {
    const config = await appCapabilityConfigRepository.findByUserAppAndCapability(
      userId,
      'google',
      'tools',
    );
    if (!config) {
      throw new Error('Google app is not connected');
    }

    const credentials = decryptCredentials(config.encryptedCredentials);
    const provider = new GoogleDriveToolProvider({
      credentials: {
        accessToken: requireString(credentials, 'accessToken'),
        refreshToken: asString(credentials['refreshToken']),
        expiresAt: asString(credentials['expiresAt']),
      },
      onRefresh: async (refreshedCredentials) => {
        await appCapabilityConfigRepository.updateCredentialsByUserAndApp(
          userId,
          'google',
          encryptCredentials(refreshedCredentials as unknown as Record<string, unknown>),
        );
      },
    });

    return { success: true, result: await handler(provider) };
  } catch (error) {
    return {
      success: false,
      result: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
