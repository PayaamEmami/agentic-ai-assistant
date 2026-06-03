'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, type AppSummary, type GitHubRepositorySummary } from '@/lib/api-client';
import { GitHubRepositorySelector } from '@/components/apps/github-repository-selector';
import { IndexedSourcesSection } from '@/components/apps/indexed-sources-section';
import { AppSyncButton } from '@/components/apps/app-sync-button';
import { ConnectIcon, DisconnectIcon } from '@/components/icons';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { IconButton } from '@/components/ui/icon-button';
import { reportClientError } from '@/lib/client-logging';
import { useAppSync } from '@/lib/apps/use-app-sync';

function appLabel(kind: string): string {
  if (kind === 'github') {
    return 'GitHub';
  }

  if (kind === 'google') {
    return 'Google';
  }

  return kind;
}

function providerDescription(kind: AppSummary['kind']): string {
  if (kind === 'github') {
    return 'Ask about your codebase, reference files, and make changes in selected repositories.';
  }

  return 'Ask about your files, reference documents, and make edits from chat.';
}

export function AppManager() {
  const searchParams = useSearchParams();
  const [apps, setApps] = useState<AppSummary[]>([]);
  const [githubRepositories, setGitHubRepositories] = useState<GitHubRepositorySummary[]>([]);
  const [selectedRepoIds, setSelectedRepoIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingRepos, setSavingRepos] = useState(false);
  const [disconnectingKind, setDisconnectingKind] = useState<AppSummary['kind'] | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const appKind = searchParams.get('app');
  const appStatus = searchParams.get('appStatus');
  const appMessage = searchParams.get('appMessage');

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) {
      setLoading(true);
    }

    try {
      const appResponse = await api.apps.list();

      setApps(appResponse.apps);

      const githubApp = appResponse.apps.find((candidate) => candidate.kind === 'github');
      if (githubApp?.knowledge.hasCredentials) {
        const repositoryResponse = await api.apps.listGitHubRepositories();
        setGitHubRepositories(repositoryResponse.repositories);
        setSelectedRepoIds(
          repositoryResponse.repositories.filter((repo) => repo.selected).map((repo) => repo.id),
        );
      } else {
        setGitHubRepositories([]);
        setSelectedRepoIds([]);
      }
    } catch (error) {
      void reportClientError({
        event: 'client.apps.load_failed',
        component: 'app-manager',
        message: 'Failed to load apps',
        error,
      });
      setActionError(error instanceof Error ? error.message : 'Failed to load apps');
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, []);

  const { syncingKind, syncApp: runAppSync } = useAppSync(() => load(false));

  useEffect(() => {
    void load();
  }, [appKind, appMessage, appStatus, load]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void load(false);
    }, 15000);

    return () => window.clearInterval(interval);
  }, [load]);

  const connectApp = async (kind: AppSummary['kind']) => {
    setActionError(null);

    try {
      const response = await api.apps.connect(kind);
      window.location.href = response.authorizationUrl;
    } catch (error) {
      void reportClientError({
        event: 'client.apps.connect_failed',
        component: 'app-manager',
        message: `Failed to start ${kind} app connection`,
        error,
      });
      setActionError(error instanceof Error ? error.message : 'Failed to connect app');
    }
  };

  const handleSyncApp = async (kind: AppSummary['kind']) => {
    setActionError(null);

    const app = apps.find((candidate) => candidate.kind === kind);
    const displayName = app?.displayName ?? appLabel(kind);

    try {
      await runAppSync(kind, displayName);
    } catch (error) {
      void reportClientError({
        event: 'client.apps.sync_failed',
        component: 'app-manager',
        message: `Failed to queue ${kind} sync`,
        error,
      });
      setActionError(error instanceof Error ? error.message : 'Failed to queue sync');
    }
  };

  const saveGitHubRepositories = async () => {
    setSavingRepos(true);
    setActionError(null);

    try {
      await api.apps.saveGitHubRepositories(selectedRepoIds);
      const githubApp = apps.find((candidate) => candidate.kind === 'github');
      await runAppSync('github', githubApp?.displayName ?? 'GitHub');
    } catch (error) {
      void reportClientError({
        event: 'client.apps.save_repositories_failed',
        component: 'app-manager',
        message: 'Failed to save GitHub repositories',
        error,
      });
      setActionError(error instanceof Error ? error.message : 'Failed to save repositories');
    } finally {
      setSavingRepos(false);
    }
  };

  const disconnectApp = async (kind: AppSummary['kind']) => {
    const confirmed = window.confirm(
      `Disconnect ${appLabel(kind)} and remove its synced knowledge from this workspace?`,
    );
    if (!confirmed) {
      return;
    }

    setDisconnectingKind(kind);
    setActionError(null);

    try {
      await api.apps.disconnect(kind);
      await load(false);
    } catch (error) {
      void reportClientError({
        event: 'client.apps.disconnect_failed',
        component: 'app-manager',
        message: `Failed to disconnect ${kind} app`,
        error,
      });
      setActionError(error instanceof Error ? error.message : 'Failed to disconnect app');
    } finally {
      setDisconnectingKind(null);
    }
  };

  return (
    <div className="space-y-6">
      {appKind && appStatus ? (
        <Alert variant={appStatus === 'connected' ? 'success' : 'error'}>
          {appLabel(appKind)} {appStatus === 'connected' ? 'connected.' : 'failed.'}
          {appMessage ? ` ${appMessage}` : ''}
        </Alert>
      ) : null}

      {actionError ? (
        <Alert>{actionError}</Alert>
      ) : null}

      {loading ? (
        <p className="py-10 text-sm text-foreground-muted">Loading apps...</p>
      ) : (
        <div className="divide-y divide-border">
          {apps.map((app) => {
            const selectedRepoCount = app.selectedRepoCount ?? 0;
            const isConnected = app.hasCredentials;

            return (
              <section key={app.kind} className="py-6 first:pt-0">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="max-w-2xl">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-base font-medium text-foreground">{app.displayName}</p>
                      <Badge variant={isConnected ? 'success' : 'neutral'} className="font-normal">
                        {isConnected ? 'Connected' : 'Not connected'}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-foreground-muted">
                      {providerDescription(app.kind)}
                    </p>
                    {app.lastError ? (
                      <Alert className="mt-3">{app.lastError}</Alert>
                    ) : null}
                    {app.kind === 'github' && isConnected && selectedRepoCount === 0 ? (
                      <Alert variant="warning" className="mt-3">
                        Select at least one repository before syncing GitHub knowledge.
                      </Alert>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {!isConnected ? (
                      <IconButton
                        onClick={() => void connectApp(app.kind)}
                        title={`Connect ${app.displayName}`}
                        aria-label={`Connect ${app.displayName}`}
                      >
                        <ConnectIcon />
                      </IconButton>
                    ) : null}
                    {isConnected ? (
                      <AppSyncButton
                        app={app}
                        syncingKind={syncingKind}
                        onSync={(kind) => void handleSyncApp(kind)}
                      />
                    ) : null}
                    {isConnected ? (
                      <IconButton
                        variant="danger"
                        onClick={() => void disconnectApp(app.kind)}
                        disabled={disconnectingKind === app.kind}
                        title={
                          disconnectingKind === app.kind
                            ? `Disconnecting ${app.displayName}`
                            : `Disconnect ${app.displayName}`
                        }
                        aria-label={
                          disconnectingKind === app.kind
                            ? `Disconnecting ${app.displayName}`
                            : `Disconnect ${app.displayName}`
                        }
                      >
                        <DisconnectIcon />
                      </IconButton>
                    ) : null}
                  </div>
                </div>

                {isConnected ? (
                  <>
                    {app.kind === 'github' ? (
                      <GitHubRepositorySelector
                        repositories={githubRepositories}
                        selectedRepoIds={selectedRepoIds}
                        saving={savingRepos}
                        onSave={saveGitHubRepositories}
                        onSelectedRepoIdsChange={setSelectedRepoIds}
                      />
                    ) : null}

                    <IndexedSourcesSection app={app} />
                  </>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

