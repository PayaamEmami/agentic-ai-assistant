'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  api,
  type ConnectorSummary,
  type GitHubRepositorySummary,
} from '@/lib/api-client';

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

function connectorLabel(kind: ConnectorSummary['kind']): string {
  return kind === 'google_docs' ? 'Google Docs' : 'GitHub';
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

  useEffect(() => {
    async function load() {
      setLoading(true);
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
        setActionError(error instanceof Error ? error.message : 'Failed to load connectors');
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [connectorKind, connectorMessage, connectorStatus]);

  const startConnection = async (kind: 'github' | 'google_docs') => {
    setActionError(null);
    try {
      const response = await api.connectors.start(kind);
      window.location.href = response.authorizationUrl;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to start connector flow');
    }
  };

  const triggerSync = async (kind: 'github' | 'google_docs') => {
    setActionError(null);
    try {
      await api.connectors.sync(kind);
      const refreshed = await api.connectors.list();
      setConnectors(refreshed.connectors);
    } catch (error) {
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
      const refreshed = await api.connectors.list();
      setConnectors(refreshed.connectors);
      if (kind === 'github') {
        setGitHubRepos([]);
        setSelectedRepoIds([]);
      }
    } catch (error) {
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
                  {connector.lastSyncStatus ? ` • sync ${connector.lastSyncStatus}` : ''}
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
                              {repo.private ? 'Private' : 'Public'} • default branch {repo.defaultBranch}
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
