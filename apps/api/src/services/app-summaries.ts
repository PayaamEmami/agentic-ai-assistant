import { appCapabilityConfigRepository, appSyncRunRepository, sourceRepository } from '@aaa/db';
import type { AppCapability, AppCapabilitySummary, AppKind, AppSummary } from './app-service-types.js';

export function appLabel(kind: AppKind): string {
  return kind === 'github' ? 'GitHub' : 'Google';
}

function getSelectedRepoCount(settings: Record<string, unknown>): number | undefined {
  const selectedRepos = settings['selectedRepos'];
  return Array.isArray(selectedRepos) ? selectedRepos.length : undefined;
}

async function toRecentSyncRuns(userId: string, appKind: AppKind) {
  const runs = await appSyncRunRepository.listRecentByUserAndAppAndCapability(
    userId,
    appKind,
    'knowledge',
    5,
  );
  return runs.map((run) => ({
    id: run.id,
    trigger: run.trigger,
    status: run.status,
    itemsDiscovered: run.itemsDiscovered,
    itemsQueued: run.itemsQueued,
    itemsDeleted: run.itemsDeleted,
    errorCount: run.errorCount,
    errorSummary: run.errorSummary,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
  }));
}

async function toRecentSources(userId: string, appKind: AppKind) {
  const sources = await sourceRepository.listIndexedByUserAndApp(userId, appKind, 8);
  return sources.map((source) => ({
    id: source.id,
    kind: source.kind,
    title: source.title,
    uri: source.uri,
    mimeType: source.mimeType,
    updatedAt: source.updatedAt.toISOString(),
  }));
}

function toCapabilitySummary(
  capability: AppCapability,
  config:
    | Awaited<ReturnType<typeof appCapabilityConfigRepository.findByUserAppAndCapability>>
    | undefined,
  sourceStats = { totalSources: 0, searchableSources: 0 },
  recentSyncRuns: Awaited<ReturnType<typeof toRecentSyncRuns>> = [],
  recentSources: Awaited<ReturnType<typeof toRecentSources>> = [],
): AppCapabilitySummary {
  return {
    capability,
    status: config?.status ?? 'pending',
    lastSyncAt: config?.lastSyncAt?.toISOString() ?? null,
    lastSyncStatus: config?.lastSyncStatus ?? null,
    lastError: config?.lastError ?? null,
    hasCredentials: Boolean(config?.encryptedCredentials),
    totalSourceCount: sourceStats.totalSources,
    searchableSourceCount: sourceStats.searchableSources,
    recentSyncRuns,
    recentSources,
  };
}

export async function listAppSummaries(userId: string): Promise<AppSummary[]> {
  const configs = await appCapabilityConfigRepository.listByUser(userId);
  const byKey = new Map(configs.map((config) => [`${config.appKind}:${config.capability}`, config]));

  const recentRunsByApp = new Map<AppKind, Awaited<ReturnType<typeof toRecentSyncRuns>>>();
  const recentSourcesByApp = new Map<AppKind, Awaited<ReturnType<typeof toRecentSources>>>();
  const sourceStatsByApp = new Map<AppKind, Awaited<ReturnType<typeof sourceRepository.getAppSourceStats>>>();

  for (const appKind of ['github', 'google'] as const) {
    const [recentRuns, recentSources, sourceStats] = await Promise.all([
      toRecentSyncRuns(userId, appKind),
      toRecentSources(userId, appKind),
      sourceRepository.getAppSourceStats(userId, appKind),
    ]);
    recentRunsByApp.set(appKind, recentRuns);
    recentSourcesByApp.set(appKind, recentSources);
    sourceStatsByApp.set(appKind, sourceStats);
  }

  return (['github', 'google'] as const).map((appKind) => {
    const knowledgeConfig = byKey.get(`${appKind}:knowledge`);
    const toolsConfig = byKey.get(`${appKind}:tools`);
    const knowledge = toCapabilitySummary(
      'knowledge',
      knowledgeConfig,
      sourceStatsByApp.get(appKind),
      recentRunsByApp.get(appKind),
      recentSourcesByApp.get(appKind),
    );
    const tools = toCapabilitySummary('tools', toolsConfig);
    const hasCredentials = knowledge.hasCredentials || tools.hasCredentials;
    const status =
      knowledge.status === 'connected' && tools.status === 'connected'
        ? 'connected'
        : knowledge.status === 'failed' || tools.status === 'failed'
          ? 'failed'
          : 'pending';
    const lastError = knowledge.lastError ?? tools.lastError ?? null;

    return {
      kind: appKind,
      displayName: appLabel(appKind),
      status,
      hasCredentials,
      lastError,
      selectedRepoCount:
        appKind === 'github' && knowledgeConfig
          ? getSelectedRepoCount(knowledgeConfig.settings)
          : undefined,
      knowledge,
      tools,
    };
  });
}
