'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  api,
  type ConnectorSyncRunSummary,
  type ConnectorSummary,
  type GitHubRepositorySummary,
} from '@/lib/api-client';
import { reportClientError } from '@/lib/client-logging';

function formatSyncTimestamp(value: string | null): string {
  if (!value) {
    return 'Not synced yet';
  }

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return 'Not synced yet';
  }

  return timestamp.toLocaleString();
}

function formatRunTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return 'Unknown time';
  }

  return timestamp.toLocaleString();
}

function formatRunDuration(startedAt: string, completedAt: string | null): string {
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

function connectorLabel(kind: ConnectorSummary['kind']): string {
  return kind === 'google_docs' ? 'Google Docs' : 'GitHub';
}

function runStatusTone(status: ConnectorSyncRunSummary['status']): string {
  if (status === 'completed') {
    return 'text-success';
  }

  if (status === 'failed') {
    return 'text-error';
  }

  return 'text-foreground';
}

function runStatusLabel(status: ConnectorSyncRunSummary['status']): string {
  if (status === 'completed') {
    return 'Completed';
  }

  if (status === 'failed') {
    return 'Failed';
  }

  return 'Running';
}

function sourceKindLabel(kind: string): string {
  if (kind === 'code_repository') {
    return 'Code';
  }

  if (kind === 'document') {
    return 'Document';
  }

  if (kind === 'web_page') {
    return 'Web page';
  }

  if (kind === 'email') {
    return 'Email';
  }

  return kind;
}

export function ConnectorManager() {
  const searchParams = useSearchParams();
  const [connectors, setConnectors] = useState<ConnectorSummary[]>([]);
  const [githubRepos, setGitHubRepos] = useState<GitHubRepositorySummary[]>([]);
  const [selectedRepoIds, setSelectedRepoIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingRepos, setSavingRepos] = useState(false);
  const [disconnectingKind, setDisconnectingKind] = useState<ConnectorSummary['kind'] | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const connectorStatus = searchParams.get('connectorStatus');
  const connectorMessage = searchParams.get('connectorMessage');
  const connectorKind = searchParams.get('connector');

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) {
      setLoading(true);
    }

    try {
      const response = await api.connectors.list();
      setConnectors(response.connectors);

      const github = response.connectors.find((connector) => connector.kind === 'github');
      if (github?.status === 'connected') {
        const repoResponse = await api.connectors.listGitHubRepos();
        setGitHubRepos(repoResponse.repositories);
        setSelectedRepoIds(
          repoResponse.repositories
            .filter((repo) => repo.selected)
            .map((repo) => repo.id),
        );
      } else {
        setGitHubRepos([]);
        setSelectedRepoIds([]);
      }
    } catch (error) {
      void reportClientError({
        event: 'client.connectors.load_failed',
        component: 'connector-manager',
        message: 'Failed to load connectors',
        error,
      });
      setActionError(error instanceof Error ? error.message : 'Failed to load connectors');
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [connectorKind, connectorMessage, connectorStatus, load]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void load(false);
    }, 15000);

    return () => window.clearInterval(interval);
  }, [load]);

  const startConnection = async (kind: 'github' | 'google_docs') => {
    setActionError(null);
    try {
      const response = await api.connectors.start(kind);
      window.location.href = response.authorizationUrl;
    } catch (error) {
      void reportClientError({
        event: 'client.connectors.start_failed',
        component: 'connector-manager',
        message: `Failed to start ${kind} connector flow`,
        error,
      });
      setActionError(error instanceof Error ? error.message : 'Failed to start connector flow');
    }
  };

  const triggerSync = async (kind: 'github' | 'google_docs') => {
    setActionError(null);
    try {
      await api.connectors.sync(kind);
      await load(false);
    } catch (error) {
      void reportClientError({
        event: 'client.connectors.sync_failed',
        component: 'connector-manager',
        message: `Failed to queue ${kind} sync`,
        error,
      });
      setActionError(error instanceof Error ? error.message : 'Failed to queue sync');
    }
  };

  const saveRepoSelection = async () => {
    setSavingRepos(true);
    setActionError(null);
    try {
      await api.connectors.saveGitHubRepos(selectedRepoIds);
      const [connectorResponse, repoResponse] = await Promise.all([
        api.connectors.list(),
        api.connectors.listGitHubRepos(),
      ]);
      setConnectors(connectorResponse.connectors);
      setGitHubRepos(repoResponse.repositories);
    } catch (error) {
      void reportClientError({
        event: 'client.connectors.save_repos_failed',
        component: 'connector-manager',
        message: 'Failed to save GitHub repository selection',
        error,
      });
      setActionError(error instanceof Error ? error.message : 'Failed to save repository selection');
    } finally {
      setSavingRepos(false);
    }
  };

  const disconnect = async (kind: ConnectorSummary['kind']) => {
    const label = connectorLabel(kind);
    const confirmed = window.confirm(
      `Disconnect ${label} and remove its indexed data from this workspace?`,
    );
    if (!confirmed) {
      return;
    }

    setDisconnectingKind(kind);
    setActionError(null);
    try {
      await api.connectors.disconnect(kind);
      await load(false);
      if (kind === 'github') {
        setGitHubRepos([]);
        setSelectedRepoIds([]);
      }
    } catch (error) {
      void reportClientError({
        event: 'client.connectors.disconnect_failed',
        component: 'connector-manager',
        message: `Failed to disconnect ${kind} connector`,
        error,
      });
      setActionError(error instanceof Error ? error.message : 'Failed to disconnect connector');
    } finally {
      setDisconnectingKind(null);
    }
  };

  return (
    <div className="space-y-3">
      {connectorStatus && connectorKind ? (
        <p
          className={`rounded-lg px-3 py-2 text-xs ${
            connectorStatus === 'connected'
              ? 'bg-success/10 text-success'
              : 'bg-error/10 text-error'
          }`}
        >
          {connectorLabel(
            connectorKind === 'github' ? 'github' : 'google_docs',
          )}{' '}
          {connectorStatus === 'connected' ? 'connected.' : 'failed.'}
          {connectorMessage ? ` ${connectorMessage}` : ''}
        </p>
      ) : null}

      {actionError ? (
        <p className="rounded-lg bg-error/10 px-3 py-2 text-xs text-error">{actionError}</p>
      ) : null}

      {loading ? (
        <p className="text-xs text-foreground-muted">Loading connectors...</p>
      ) : (
        connectors.map((connector) => (
          <div key={connector.kind} className="rounded-xl border border-border bg-surface-overlay p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">{connectorLabel(connector.kind)}</p>
                <p className="mt-1 text-xs text-foreground-muted">
                  Status: {connector.status}
                  {connector.lastSyncStatus ? ` | sync ${connector.lastSyncStatus}` : ''}
                </p>
                <p className="mt-1 text-xs text-foreground-muted">
                  {formatSyncTimestamp(connector.lastSyncAt)}
                </p>
                {connector.kind === 'github' && connector.selectedRepoCount !== undefined ? (
                  <p className="mt-1 text-xs text-foreground-muted">
                    Selected repos: {connector.selectedRepoCount}
                  </p>
                ) : null}
                {connector.lastError ? (
                  <p className="mt-2 text-xs text-error">{connector.lastError}</p>
                ) : null}
              </div>
              <div className="flex flex-col gap-2">
                {!connector.hasCredentials || connector.status !== 'connected' ? (
                  <button
                    onClick={() => void startConnection(connector.kind)}
                    className="rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-accent-hover"
                  >
                    Connect
                  </button>
                ) : (
                  <button
                    onClick={() => void triggerSync(connector.kind)}
                    className="rounded-lg border border-border-subtle px-3 py-2 text-xs font-medium text-foreground hover:bg-surface-hover"
                  >
                    Sync now
                  </button>
                )}
                {connector.hasCredentials ? (
                  <button
                    onClick={() => void disconnect(connector.kind)}
                    disabled={disconnectingKind === connector.kind}
                    className="rounded-lg border border-border-subtle px-3 py-2 text-xs font-medium text-foreground-muted hover:bg-surface-hover hover:text-error disabled:opacity-50"
                  >
                    {disconnectingKind === connector.kind ? 'Disconnecting...' : 'Disconnect'}
                  </button>
                ) : null}
              </div>
            </div>

            <div className="mt-3 space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
                Recent Sync Runs
              </p>
              {connector.recentSyncRuns.length === 0 ? (
                <p className="text-xs text-foreground-muted">No sync history yet.</p>
              ) : (
                connector.recentSyncRuns.map((run) => (
                  <div
                    key={run.id}
                    className="rounded-lg border border-border px-3 py-2 text-xs"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className={`font-medium ${runStatusTone(run.status)}`}>
                          {runStatusLabel(run.status)}
                        </p>
                        <p className="mt-1 text-foreground-muted">
                          Started {formatRunTimestamp(run.startedAt)}
                        </p>
                      </div>
                      <p className="text-foreground-muted">
                        {formatRunDuration(run.startedAt, run.completedAt)}
                      </p>
                    </div>
                    <p className="mt-2 text-foreground-muted">
                      {run.itemsDiscovered} seen | {run.itemsQueued} queued | {run.itemsDeleted} deleted
                      {run.errorCount > 0 ? ` | ${run.errorCount} errors` : ''}
                    </p>
                    {run.errorSummary ? (
                      <p className="mt-2 text-error">{run.errorSummary}</p>
                    ) : null}
                  </div>
                ))
              )}
            </div>

            <div className="mt-3 space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
                Indexed Sources
              </p>
              {connector.recentSources.length === 0 ? (
                <p className="text-xs text-foreground-muted">No indexed sources yet.</p>
              ) : (
                connector.recentSources.map((source) => (
                  <div
                    key={source.id}
                    className="rounded-lg border border-border px-3 py-2 text-xs"
                  >
                    {source.uri ? (
                      <a
                        href={source.uri}
                        target="_blank"
                        rel="noreferrer"
                        className="block font-medium text-link underline underline-offset-4"
                      >
                        {source.title}
                      </a>
                    ) : (
                      <p className="font-medium text-foreground">{source.title}</p>
                    )}
                    <p className="mt-1 text-foreground-muted">
                      {sourceKindLabel(source.kind)}
                      {source.mimeType ? ` | ${source.mimeType}` : ''}
                    </p>
                    <p className="mt-1 text-foreground-muted">
                      Updated {formatRunTimestamp(source.updatedAt)}
                    </p>
                  </div>
                ))
              )}
            </div>

            {connector.kind === 'github' && connector.status === 'connected' ? (
              <div className="mt-3 space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
                  Repositories
                </p>
                {githubRepos.length === 0 ? (
                  <p className="text-xs text-foreground-muted">No repositories loaded yet.</p>
                ) : (
                  <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
                    {githubRepos.map((repo) => {
                      const checked = selectedRepoIds.includes(repo.id);
                      return (
                        <label
                          key={repo.id}
                          className="flex items-start gap-2 rounded-lg border border-border px-2 py-2 text-xs text-foreground"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) => {
                              setSelectedRepoIds((previous) =>
                                event.target.checked
                                  ? [...previous, repo.id]
                                  : previous.filter((id) => id !== repo.id),
                              );
                            }}
                            className="mt-0.5"
                          />
                          <span>
                            <span className="block font-medium text-foreground">{repo.fullName}</span>
                            <span className="block text-foreground-muted">
                              {repo.private ? 'Private' : 'Public'} | default branch {repo.defaultBranch}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
                <button
                  onClick={() => void saveRepoSelection()}
                  disabled={savingRepos}
                  className="rounded-lg bg-surface-input px-3 py-2 text-xs font-medium text-foreground ring-1 ring-border-subtle hover:bg-surface-hover disabled:opacity-50"
                >
                  {savingRepos ? 'Saving...' : 'Save repos'}
                </button>
              </div>
            ) : null}
          </div>
        ))
      )}
    </div>
  );
}
