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

  return (
    <div className="space-y-3">
      {connectorStatus && connectorKind ? (
        <p
          className={`rounded-lg px-3 py-2 text-xs ${
            connectorStatus === 'connected'
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-red-50 text-red-700'
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
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{actionError}</p>
      ) : null}

      {loading ? (
        <p className="text-xs text-gray-400">Loading connectors...</p>
      ) : (
        connectors.map((connector) => (
          <div key={connector.kind} className="rounded-xl border border-gray-200 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-gray-900">{connectorLabel(connector.kind)}</p>
                <p className="mt-1 text-xs text-gray-500">
                  Status: {connector.status}
                  {connector.lastSyncStatus ? ` • sync ${connector.lastSyncStatus}` : ''}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  {formatSyncTimestamp(connector.lastSyncAt)}
                </p>
                {connector.kind === 'github' && connector.selectedRepoCount !== undefined ? (
                  <p className="mt-1 text-xs text-gray-500">
                    Selected repos: {connector.selectedRepoCount}
                  </p>
                ) : null}
                {connector.lastError ? (
                  <p className="mt-2 text-xs text-red-600">{connector.lastError}</p>
                ) : null}
              </div>
              <div className="flex flex-col gap-2">
                {!connector.hasCredentials || connector.status !== 'connected' ? (
                  <button
                    onClick={() => void startConnection(connector.kind)}
                    className="rounded-lg bg-gray-900 px-3 py-2 text-xs font-medium text-white hover:bg-gray-800"
                  >
                    Connect
                  </button>
                ) : (
                  <button
                    onClick={() => void triggerSync(connector.kind)}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:border-gray-400 hover:text-gray-900"
                  >
                    Sync now
                  </button>
                )}
              </div>
            </div>

            {connector.kind === 'github' && connector.status === 'connected' ? (
              <div className="mt-3 space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Repositories
                </p>
                {githubRepos.length === 0 ? (
                  <p className="text-xs text-gray-400">No repositories loaded yet.</p>
                ) : (
                  <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
                    {githubRepos.map((repo) => {
                      const checked = selectedRepoIds.includes(repo.id);
                      return (
                        <label
                          key={repo.id}
                          className="flex items-start gap-2 rounded-lg border border-gray-100 px-2 py-2 text-xs text-gray-700"
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
                            <span className="block font-medium text-gray-900">{repo.fullName}</span>
                            <span className="block text-gray-500">
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
                  className="rounded-lg bg-white px-3 py-2 text-xs font-medium text-gray-700 ring-1 ring-gray-300 hover:bg-gray-50 disabled:opacity-50"
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
