'use client';

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  api,
  type AppCapabilitySummary,
  type AppSummary,
  type GitHubRepositorySummary,
} from '@/lib/api-client';
import { reportClientError } from '@/lib/client-logging';

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
    return 'Sync selected repositories for retrieval and use GitHub tools in chat.';
  }

  return 'Sync Google Docs for retrieval and use Google Drive and Docs tools in chat.';
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return 'Never';
  }

  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? 'Unknown time' : timestamp.toLocaleString();
}

function formatDuration(startedAt: string, completedAt: string | null): string {
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
    return completedAt ? 'Completed' : 'Running';
  }

  const totalSeconds = Math.round((end - start) / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

function sourceLabel(kind: string): string {
  if (kind === 'code_repository') {
    return 'Code';
  }

  if (kind === 'document') {
    return 'Document';
  }

  return kind;
}

function statusLabel(status: 'pending' | 'connected' | 'failed'): string {
  return status === 'connected' ? 'Connected' : status === 'failed' ? 'Failed' : 'Pending';
}

function capabilityDescription(capability: AppCapabilitySummary): string {
  return capability.capability === 'knowledge'
    ? 'Synced retrieval context and citations.'
    : 'Live provider tools available during chat.';
}

function selectedRepositoryLabel(count: number): string {
  if (count === 0) {
    return 'Select repositories';
  }

  if (count === 1) {
    return '1 repository selected';
  }

  return `${count} repositories selected`;
}

function GitHubRepositorySelector({
  repositories,
  selectedRepoIds,
  saving,
  onSave,
  onSelectedRepoIdsChange,
}: {
  repositories: GitHubRepositorySummary[];
  selectedRepoIds: number[];
  saving: boolean;
  onSave: () => Promise<void>;
  onSelectedRepoIdsChange: Dispatch<SetStateAction<number[]>>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selectedRepoIdSet = useMemo(() => new Set(selectedRepoIds), [selectedRepoIds]);
  const filteredRepositories = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return repositories;
    }

    return repositories.filter((repository) =>
      repository.fullName.toLowerCase().includes(normalizedQuery),
    );
  }, [query, repositories]);

  const toggleRepository = (repositoryId: number, checked: boolean) => {
    onSelectedRepoIdsChange((previous) => {
      if (checked) {
        return previous.includes(repositoryId) ? previous : [...previous, repositoryId];
      }

      return previous.filter((id) => id !== repositoryId);
    });
  };

  const saveSelection = async () => {
    await onSave();
    setOpen(false);
  };

  return (
    <div className="relative mt-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium text-foreground">Repositories</p>
          <p className="mt-0.5 text-xs text-foreground-muted">Knowledge sync source</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((previous) => !previous)}
          disabled={repositories.length === 0}
          aria-expanded={open}
          aria-haspopup="listbox"
          className="inline-flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-3 py-2 text-left text-xs font-medium text-foreground transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60 sm:min-w-52"
        >
          <span>{selectedRepositoryLabel(selectedRepoIds.length)}</span>
          <span className="text-foreground-muted">v</span>
        </button>
      </div>

      {repositories.length === 0 ? (
        <p className="mt-2 text-xs text-foreground-muted">No repositories loaded yet.</p>
      ) : null}

      {open ? (
        <div className="absolute right-0 z-20 mt-2 w-full rounded-2xl border border-border bg-surface-elevated p-3 shadow-lg sm:w-96">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search repositories"
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-xs text-foreground outline-none placeholder:text-foreground-inactive focus:border-accent"
          />
          {filteredRepositories.length === 0 ? (
            <p className="py-4 text-xs text-foreground-muted">No repositories match this search.</p>
          ) : (
            <div className="mt-3 max-h-56 divide-y divide-border overflow-y-auto pr-1">
              {filteredRepositories.map((repository) => (
                <label
                  key={repository.id}
                  className="flex items-start gap-2 py-3 text-xs first:pt-0 last:pb-0"
                >
                  <input
                    type="checkbox"
                    checked={selectedRepoIdSet.has(repository.id)}
                    onChange={(event) => toggleRepository(repository.id, event.target.checked)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-foreground">
                      {repository.fullName}
                    </span>
                    <span className="block text-foreground-muted">
                      {repository.private ? 'Private' : 'Public'} | {repository.defaultBranch}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
          <div className="mt-3 flex items-center justify-end gap-2 border-t border-border pt-3">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-xl px-3 py-2 text-xs font-medium text-foreground-muted transition hover:bg-surface-hover hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void saveSelection()}
              disabled={saving}
              className="rounded-xl bg-accent px-3 py-2 text-xs font-medium text-white transition hover:bg-accent-hover disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save and sync'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
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

  const syncApp = async (kind: AppSummary['kind']) => {
    setActionError(null);

    try {
      await api.apps.sync(kind);
      await load(false);
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
      await api.apps.sync('github');
      await load(false);
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
        <p
          className={`rounded-xl border px-3 py-2 text-sm ${
            appStatus === 'connected'
              ? 'border-success/30 bg-success/10 text-success'
              : 'border-error/30 bg-error/10 text-error'
          }`}
        >
          {appLabel(appKind)} {appStatus === 'connected' ? 'connected.' : 'failed.'}
          {appMessage ? ` ${appMessage}` : ''}
        </p>
      ) : null}

      {actionError ? (
        <p className="rounded-xl border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
          {actionError}
        </p>
      ) : null}

      {loading ? (
        <p className="py-10 text-sm text-foreground-muted">Loading apps...</p>
      ) : (
        <div className="divide-y divide-border">
          {apps.map((app) => {
            const selectedRepoCount = app.selectedRepoCount ?? 0;
            const isConnected = app.hasCredentials;
            const syncDisabled =
              app.knowledge.status !== 'connected' ||
              (app.kind === 'github' && selectedRepoCount === 0);

            return (
              <section key={app.kind} className="py-6 first:pt-0">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="max-w-2xl">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-base font-medium text-foreground">{app.displayName}</p>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          isConnected
                            ? 'bg-success/10 text-success'
                            : 'bg-surface-elevated text-foreground-muted'
                        }`}
                      >
                        {isConnected ? 'Connected' : 'Not connected'}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-foreground-muted">
                      {providerDescription(app.kind)}
                    </p>
                    {app.lastError ? (
                      <p className="mt-3 rounded-xl border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
                        {app.lastError}
                      </p>
                    ) : null}
                    {isConnected ? (
                      <p className="mt-3 text-sm text-foreground-muted">
                        Knowledge: {statusLabel(app.knowledge.status)}. Tools:{' '}
                        {statusLabel(app.tools.status)}.
                      </p>
                    ) : null}
                    {app.kind === 'github' &&
                    isConnected &&
                    app.knowledge.status === 'connected' &&
                    selectedRepoCount === 0 ? (
                      <p className="mt-3 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
                        Select at least one repository before syncing GitHub knowledge.
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => void connectApp(app.kind)}
                      className="rounded-xl bg-accent px-3 py-2 text-sm font-medium text-white transition hover:bg-accent-hover"
                    >
                      {isConnected ? 'Reconnect' : 'Connect'}
                    </button>
                    {isConnected ? (
                      <button
                        onClick={() => void syncApp(app.kind)}
                        disabled={syncDisabled}
                        className="rounded-xl px-3 py-2 text-sm font-medium text-foreground-muted transition hover:bg-surface-hover hover:text-foreground disabled:opacity-50"
                      >
                        Sync
                      </button>
                    ) : null}
                    {isConnected ? (
                      <button
                        onClick={() => void disconnectApp(app.kind)}
                        disabled={disconnectingKind === app.kind}
                        className="rounded-xl px-3 py-2 text-sm font-medium text-foreground-muted transition hover:bg-surface-hover hover:text-error disabled:opacity-50"
                      >
                        {disconnectingKind === app.kind ? 'Disconnecting...' : 'Disconnect'}
                      </button>
                    ) : null}
                  </div>
                </div>

                {isConnected ? (
                  <>
                    <div className="mt-5 grid gap-4 sm:grid-cols-2">
                      {[app.knowledge, app.tools].map((capability) => (
                        <div
                          key={capability.capability}
                          className="border-t border-border pt-4"
                        >
                          <p className="text-sm font-medium text-foreground">
                            {capability.capability === 'knowledge' ? 'Knowledge' : 'Tools'}
                          </p>
                          <p className="mt-1 text-xs text-foreground-muted">
                            {capabilityDescription(capability)}
                          </p>
                          <div className="mt-3 grid gap-2 text-xs text-foreground-muted">
                            <p>Status: {statusLabel(capability.status)}</p>
                            <p>Last sync: {formatTimestamp(capability.lastSyncAt)}</p>
                            <p>
                              Searchable: {capability.searchableSourceCount}/
                              {capability.totalSourceCount}
                            </p>
                            <p>
                              Credentials: {capability.hasCredentials ? 'Available' : 'Missing'}
                            </p>
                          </div>
                          {app.kind === 'github' && capability.capability === 'knowledge' ? (
                            <GitHubRepositorySelector
                              repositories={githubRepositories}
                              selectedRepoIds={selectedRepoIds}
                              saving={savingRepos}
                              onSave={saveGitHubRepositories}
                              onSelectedRepoIdsChange={setSelectedRepoIds}
                            />
                          ) : null}
                          {capability.lastError ? (
                            <p className="mt-3 rounded-xl border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">
                              {capability.lastError}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>

                    <div className="mt-5 grid gap-6 border-t border-border pt-5 xl:grid-cols-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">Recent Sync Runs</p>
                        {app.knowledge.recentSyncRuns.length === 0 ? (
                          <p className="mt-2 text-xs text-foreground-muted">No sync history yet.</p>
                        ) : (
                          <div className="mt-3 divide-y divide-border">
                            {app.knowledge.recentSyncRuns.map((run) => (
                              <div
                                key={run.id}
                                className="min-w-0 py-3 text-xs first:pt-0 last:pb-0"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <p className="font-medium text-foreground">{run.status}</p>
                                  <p className="shrink-0 text-foreground-muted">
                                    {formatDuration(run.startedAt, run.completedAt)}
                                  </p>
                                </div>
                                <p className="mt-1 text-foreground-muted">
                                  Started {formatTimestamp(run.startedAt)}
                                </p>
                                <p className="mt-1 break-words text-foreground-muted">
                                  {run.itemsDiscovered} seen | {run.itemsQueued} queued
                                  {run.itemsDeleted > 0 ? ` | ${run.itemsDeleted} removed` : ''}
                                </p>
                                {run.errorSummary ? (
                                  <p className="mt-1 break-words text-error">{run.errorSummary}</p>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="min-w-0">
                        <p className="break-words text-sm font-medium text-foreground">
                          Indexed Sources ({app.knowledge.searchableSourceCount}/
                          {app.knowledge.totalSourceCount})
                        </p>
                        {app.knowledge.recentSources.length === 0 ? (
                          <p className="mt-2 text-xs text-foreground-muted">
                            No indexed sources yet.
                          </p>
                        ) : (
                          <div className="mt-3 divide-y divide-border">
                            {app.knowledge.recentSources.map((source) => (
                              <div
                                key={source.id}
                                className="min-w-0 py-3 text-xs first:pt-0 last:pb-0"
                              >
                                <p className="break-words font-medium text-foreground">
                                  {source.title}
                                </p>
                                <p className="mt-1 break-words text-foreground-muted">
                                  {sourceLabel(source.kind)}
                                  {source.mimeType ? ` | ${source.mimeType}` : ''}
                                </p>
                                <p className="mt-1 text-foreground-muted">
                                  Updated {formatTimestamp(source.updatedAt)}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
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
