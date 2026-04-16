import {
  mcpProfileRepository,
  type McpProfile,
} from '@aaa/db';
import { decryptCredentials, encryptCredentials } from '@aaa/knowledge-sources';
import { getMcpRuntime } from '@aaa/mcp';
import { AppError } from '../lib/errors.js';

function hasCredentialMaterial(credentials: Record<string, unknown>): boolean {
  return Object.keys(credentials).length > 0;
}

function toProfileSummary(profile: McpProfile) {
  const credentials = decryptCredentials(profile.encryptedCredentials);
  return {
    id: profile.id,
    integrationKind: profile.integrationKind,
    profileLabel: profile.profileLabel,
    status: profile.status,
    hasCredentials: hasCredentialMaterial(credentials),
    lastError: profile.lastError,
    isDefault: profile.isDefault,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

async function requireOwnedProfile(userId: string, profileId: string): Promise<McpProfile> {
  const profile = await mcpProfileRepository.findByIdForUser(profileId, userId);
  if (!profile) {
    throw new AppError(404, 'MCP profile not found', 'MCP_PROFILE_NOT_FOUND');
  }
  return profile;
}

export class McpService {
  private readonly runtime = getMcpRuntime();

  listCatalog() {
    return this.runtime.listCatalog();
  }

  async listProfiles(userId: string) {
    const profiles = await mcpProfileRepository.listByUser(userId);
    return profiles.map(toProfileSummary);
  }

  async createProfile(
    userId: string,
    input: {
      integrationKind: string;
      profileLabel: string;
      authMode?: string;
      secretProfile?: Record<string, unknown>;
    },
  ) {
    const catalogEntry = this.runtime
      .listCatalog()
      .find((entry) => entry.kind === input.integrationKind);
    if (!catalogEntry) {
      throw new AppError(
        400,
        `Unsupported MCP integration: ${input.integrationKind}`,
        'MCP_INTEGRATION_UNSUPPORTED',
      );
    }

    const existing = await mcpProfileRepository.listByUser(userId);
    const hasDefaultForKind = existing.some(
      (profile) => profile.integrationKind === input.integrationKind && profile.isDefault,
    );

    const credentials: Record<string, unknown> = {};
    if (input.secretProfile) {
      credentials['secretProfiles'] = { default: input.secretProfile };
    }

    const profile = await mcpProfileRepository.create({
      userId,
      integrationKind: input.integrationKind,
      profileLabel: input.profileLabel,
      status: input.secretProfile ? 'connected' : 'pending',
      encryptedCredentials: encryptCredentials(credentials),
      settings: {},
      isDefault: !hasDefaultForKind,
    });

    return toProfileSummary(profile);
  }

  async setDefaultProfile(userId: string, profileId: string) {
    const profile = await mcpProfileRepository.setDefault(profileId, userId);
    if (!profile) {
      throw new AppError(404, 'MCP profile not found', 'MCP_PROFILE_NOT_FOUND');
    }

    return toProfileSummary(profile);
  }

  async deleteProfile(userId: string, profileId: string) {
    const profile = await requireOwnedProfile(userId, profileId);
    const deleted = await mcpProfileRepository.delete(profileId, userId);
    if (!deleted) {
      throw new AppError(404, 'MCP profile not found', 'MCP_PROFILE_NOT_FOUND');
    }

    if (profile.isDefault) {
      const remaining = await mcpProfileRepository.listByUser(userId);
      const replacement = remaining.find(
        (candidate) => candidate.integrationKind === profile.integrationKind,
      );
      if (replacement) {
        await mcpProfileRepository.setDefault(replacement.id, userId);
      }
    }

    await this.runtime.invalidateProfile(profileId);
    return { ok: true as const };
  }
}
