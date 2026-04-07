'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  api,
  type AppCapabilitySummary,
  type AppSummary,
  type GitHubRepositorySummary,
  type McpBrowserSessionSummary,
  type McpCatalogEntrySummary,
  type McpConnectionSummary,
} from '@/lib/api-client';
import { useChatContext } from '@/lib/chat-context';
import { reportClientError } from '@/lib/client-logging';

function appLabel(kind: string): string {
  if (kind === 'github') {
    return 'GitHub';
  }

  if (kind === 'google') {
    return 'Google';
  }

  if (kind === 'playwright') {
    return 'Playwright Browser';
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

function mcpStatusSummary(connection: McpConnectionSummary): string {
  if (connection.status === 'connected') {
    return connection.isDefaultActive ? 'Ready in chat and default active.' : 'Ready in chat.';
  }

  if (connection.status === 'failed') {
    return 'Needs attention before it can be used.';
  }

  return 'Waiting for sign-in or credentials.';
}

export function AppManager() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentConversationId } = useChatContext();
  const [apps, setApps] = useState<AppSummary[]>([]);
  const [githubRepositories, setGitHubRepositories] = useState<GitHubRepositorySummary[]>([]);
  const [selectedRepoIds, setSelectedRepoIds] = useState<number[]>([]);
  const [mcpCatalog, setMcpCatalog] = useState<McpCatalogEntrySummary[]>([]);
  const [mcpConnections, setMcpConnections] = useState<McpConnectionSummary[]>([]);
  const [mcpSessionsByConnection, setMcpSessionsByConnection] = useState<
    Record<string, McpBrowserSessionSummary>
  >({});
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
      const [appResponse, catalogResponse, connectionResponse, sessionResponse] =
        await Promise.all([
          api.apps.list(),
          api.mcp.catalog(),
          api.mcp.listConnections(),
          api.mcp.listBrowserSessions(),
        ]);

      setApps(appResponse.apps);
      setMcpCatalog(catalogResponse.integrations);
      setMcpConnections(connectionResponse.connections);
      setMcpSessionsByConnection(
        Object.fromEntries(
          sessionResponse.sessions.map((session) => [session.mcpConnectionId, session]),
        ),
      );

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

  const createMcpConnection = async (entry: McpCatalogEntrySummary) => {
    const instanceLabel = window.prompt(`Name this ${entry.displayName} instance`, entry.displayName);
    if (!instanceLabel || !instanceLabel.trim()) {
      return;
    }

    setActionError(null);

    try {
      await api.mcp.createConnection({
        integrationKind: entry.kind,
        instanceLabel: instanceLabel.trim(),
        authMode: 'manual_browser',
      });
      await load(false);
    } catch (error) {
      void reportClientError({
        event: 'client.mcp.create_failed',
        component: 'app-manager',
        message: `Failed to create ${entry.kind} MCP connection`,
        error,
      });
      setActionError(error instanceof Error ? error.message : 'Failed to create app');
    }
  };

  const openEmbeddedBrowser = async (connection: McpConnectionSummary) => {
    setActionError(null);

    try {
      const response = await api.mcp.createBrowserSession(connection.id, {
        purpose: 'auth',
        conversationId: currentConversationId,
      });
      router.push(`/chat?browserSessionId=${response.session.id}`);
      await load(false);
    } catch (error) {
      void reportClientError({
        event: 'client.mcp.browser_session_start_failed',
        component: 'app-manager',
        message: `Failed to start browser session for ${connection.id}`,
        error,
      });
      setActionError(error instanceof Error ? error.message : 'Failed to open browser session');
    }
  };

  const setDefaultMcpConnection = async (connectionId: string) => {
    setActionError(null);

    try {
      await api.mcp.setDefaultConnection(connectionId);
      await load(false);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to set default browser');
    }
  };

  const deleteMcpConnection = async (connection: McpConnectionSummary) => {
    const confirmed = window.confirm(`Remove "${connection.instanceLabel}"?`);
    if (!confirmed) {
      return;
    }

    setActionError(null);

    try {
      await api.mcp.deleteConnection(connection.id);
      await load(false);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to remove app');
    }
  };

  return (
    <div className="space-y-4">
      {appKind && appStatus ? (
        <p
          className={`rounded-xl px-3 py-2 text-xs ${
            appStatus === 'connected' ? 'bg-success/10 text-success' : 'bg-error/10 text-error'
          }`}
        >
          {appLabel(appKind)} {appStatus === 'connected' ? 'connected.' : 'failed.'}
          {appMessage ? ` ${appMessage}` : ''}
        </p>
      ) : null}

      {actionError ? (
        <p className="rounded-xl bg-error/10 px-3 py-2 text-xs text-error">{actionError}</p>
      ) : null}

      {loading ? (
        <p className="text-xs text-foreground-muted">Loading apps...</p>
      ) : (
        <div className="space-y-4">
          {apps.map((app) => {
            const selectedRepoCount = app.selectedRepoCount ?? 0;
            const isConnected = app.hasCredentials;
            const syncDisabled =
              app.knowledge.status !== 'connected' ||
              (app.kind === 'github' && selectedRepoCount === 0);

            return (
              <section
                key={app.kind}
                className="rounded-3xl border border-border bg-surface-overlay p-4"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="max-w-2xl">
                    <p className="text-lg font-semibold text-foreground">{app.displayName}</p>
                    <p className="mt-1 text-sm text-foreground-muted">
                      {providerDescription(app.kind)}
                    </p>
                    {app.lastError ? (
                      <p className="mt-3 rounded-xl bg-error/10 px-3 py-2 text-xs text-error">
                        {app.lastError}
                      </p>
                    ) : null}
                    {isConnected ? (
                      <p className="mt-3 text-xs text-foreground-muted">
                        Knowledge: {statusLabel(app.knowledge.status)}. Tools:{' '}
                        {statusLabel(app.tools.status)}.
                      </p>
                    ) : null}
                    {app.kind === 'github' &&
                    isConnected &&
                    app.knowledge.status === 'connected' &&
                    selectedRepoCount === 0 ? (
                      <p className="mt-3 rounded-xl bg-warning/10 px-3 py-2 text-xs text-warning">
                        Select at least one repository before syncing GitHub knowledge.
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => void connectApp(app.kind)}
                      className="rounded-xl bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-accent-hover"
                    >
                      {isConnected ? 'Reconnect' : 'Connect'}
                    </button>
                    {isConnected ? (
                      <button
                        onClick={() => void syncApp(app.kind)}
                        disabled={syncDisabled}
                        className="rounded-xl border border-border-subtle px-3 py-2 text-xs font-medium text-foreground hover:bg-surface-hover disabled:opacity-50"
                      >
                        Sync knowledge
                      </button>
                    ) : null}
                    {isConnected ? (
                      <button
                        onClick={() => void disconnectApp(app.kind)}
                        disabled={disconnectingKind === app.kind}
                        className="rounded-xl border border-border-subtle px-3 py-2 text-xs font-medium text-foreground-muted hover:bg-surface-hover hover:text-error disabled:opacity-50"
                      >
                        {disconnectingKind === app.kind ? 'Disconnecting...' : 'Disconnect'}
                      </button>
                    ) : null}
                  </div>
                </div>

                {isConnected ? (
                  <>
                    <div className="mt-4 grid gap-3 lg:grid-cols-2">
                      {[app.knowledge, app.tools].map((capability) => (
                        <div
                          key={capability.capability}
                          className="rounded-2xl border border-border bg-surface px-4 py-3"
                        >
                          <p className="text-sm font-medium text-foreground">
                            {capability.capability === 'knowledge' ? 'Knowledge' : 'Tools'}
                          </p>
                          <p className="mt-1 text-xs text-foreground-muted">
                            {capabilityDescription(capability)}
                          </p>
                          <div className="mt-3 grid gap-2 text-xs text-foreground-muted sm:grid-cols-2">
                            <p>Status: {statusLabel(capability.status)}</p>
                            <p>Last sync: {formatTimestamp(capability.lastSyncAt)}</p>
                            <p>
                              Searchable: {capability.searchableSourceCount}/
                              {capability.totalSourceCount}
                            </p>
                            <p>Credentials: {capability.hasCredentials ? 'Available' : 'Missing'}</p>
                          </div>
                          {capability.lastError ? (
                            <p className="mt-3 rounded-xl bg-error/10 px-3 py-2 text-xs text-error">
                              {capability.lastError}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>

                    <div className="mt-4 grid gap-4 xl:grid-cols-2">
                      <div className="rounded-2xl border border-border bg-surface px-4 py-3">
                        <p className="text-sm font-medium text-foreground">Recent Sync Runs</p>
                        {app.knowledge.recentSyncRuns.length === 0 ? (
                          <p className="mt-2 text-xs text-foreground-muted">No sync history yet.</p>
                        ) : (
                          <div className="mt-3 space-y-2">
                            {app.knowledge.recentSyncRuns.map((run) => (
                              <div
                                key={run.id}
                                className="rounded-xl border border-border px-3 py-2 text-xs"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <p className="font-medium text-foreground">{run.status}</p>
                                  <p className="text-foreground-muted">
                                    {formatDuration(run.startedAt, run.completedAt)}
                                  </p>
                                </div>
                                <p className="mt-1 text-foreground-muted">
                                  Started {formatTimestamp(run.startedAt)}
                                </p>
                                <p className="mt-1 text-foreground-muted">
                                  {run.itemsDiscovered} seen | {run.itemsQueued} queued
                                  {run.itemsDeleted > 0 ? ` | ${run.itemsDeleted} removed` : ''}
                                </p>
                                {run.errorSummary ? (
                                  <p className="mt-1 text-error">{run.errorSummary}</p>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="rounded-2xl border border-border bg-surface px-4 py-3">
                        <p className="text-sm font-medium text-foreground">
                          Indexed Sources ({app.knowledge.searchableSourceCount}/
                          {app.knowledge.totalSourceCount})
                        </p>
                        {app.knowledge.recentSources.length === 0 ? (
                          <p className="mt-2 text-xs text-foreground-muted">
                            No indexed sources yet.
                          </p>
                        ) : (
                          <div className="mt-3 space-y-2">
                            {app.knowledge.recentSources.map((source) => (
                              <div
                                key={source.id}
                                className="rounded-xl border border-border px-3 py-2 text-xs"
                              >
                                <p className="font-medium text-foreground">{source.title}</p>
                                <p className="mt-1 text-foreground-muted">
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

                    {app.kind === 'github' ? (
                      <div className="mt-4 rounded-2xl border border-border bg-surface px-4 py-3">
                        <p className="text-sm font-medium text-foreground">
                          Repositories ({selectedRepoIds.length} selected)
                        </p>
                        {githubRepositories.length === 0 ? (
                          <p className="mt-2 text-xs text-foreground-muted">
                            No repositories loaded yet.
                          </p>
                        ) : (
                          <div className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
                            {githubRepositories.map((repository) => (
                              <label
                                key={repository.id}
                                className="flex items-start gap-2 rounded-xl border border-border px-3 py-2 text-xs"
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedRepoIds.includes(repository.id)}
                                  onChange={(event) => {
                                    setSelectedRepoIds((previous) =>
                                      event.target.checked
                                        ? [...previous, repository.id]
                                        : previous.filter((id) => id !== repository.id),
                                    );
                                  }}
                                  className="mt-0.5"
                                />
                                <span>
                                  <span className="block font-medium text-foreground">
                                    {repository.fullName}
                                  </span>
                                  <span className="block text-foreground-muted">
                                    {repository.private ? 'Private' : 'Public'} |{' '}
                                    {repository.defaultBranch}
                                  </span>
                                </span>
                              </label>
                            ))}
                          </div>
                        )}
                        <button
                          onClick={() => void saveGitHubRepositories()}
                          disabled={savingRepos}
                          className="mt-3 rounded-xl bg-surface-input px-3 py-2 text-xs font-medium text-foreground ring-1 ring-border-subtle hover:bg-surface-hover disabled:opacity-50"
                        >
                          {savingRepos ? 'Saving...' : 'Save repositories'}
                        </button>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </section>
            );
          })}

          {mcpCatalog.map((entry) => {
            const connections = mcpConnections.filter(
              (connection) => connection.integrationKind === entry.kind,
            );

            return (
              <section
                key={entry.kind}
                className="rounded-3xl border border-border bg-surface-overlay p-4"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="max-w-2xl">
                    <p className="text-lg font-semibold text-foreground">{entry.displayName}</p>
                    <p className="mt-1 text-sm text-foreground-muted">{entry.description}</p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => void createMcpConnection(entry)}
                      className="rounded-xl bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-accent-hover"
                    >
                      Add instance
                    </button>
                  </div>
                </div>

                {connections.length > 0 ? (
                  <div className="mt-4 space-y-3">
                    {connections.map((connection) => {
                      const session = mcpSessionsByConnection[connection.id];

                      return (
                        <div
                          key={connection.id}
                          className="rounded-2xl border border-border bg-surface px-4 py-3 text-xs"
                        >
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                            <div>
                              <p className="font-medium text-foreground">{connection.instanceLabel}</p>
                              <p className="mt-1 text-foreground-muted">
                                {mcpStatusSummary(connection)}
                              </p>
                              {connection.lastError ? (
                                <p className="mt-2 text-error">{connection.lastError}</p>
                              ) : null}
                            </div>

                            <div className="flex flex-wrap gap-2">
                              {!connection.isDefaultActive ? (
                                <button
                                  onClick={() => void setDefaultMcpConnection(connection.id)}
                                  className="rounded-xl border border-border-subtle px-3 py-2 text-xs font-medium text-foreground hover:bg-surface-hover"
                                >
                                  Make default
                                </button>
                              ) : null}
                              <button
                                onClick={() => void openEmbeddedBrowser(connection)}
                                className="rounded-xl border border-border-subtle px-3 py-2 text-xs font-medium text-foreground hover:bg-surface-hover"
                              >
                                Open sign-in
                              </button>
                              <button
                                onClick={() => void deleteMcpConnection(connection)}
                                className="rounded-xl border border-border-subtle px-3 py-2 text-xs font-medium text-foreground-muted hover:bg-surface-hover hover:text-error"
                              >
                                Remove
                              </button>
                            </div>
                          </div>

                          {session ? (
                            <p className="mt-3 text-foreground-muted">
                              Browser session: {session.status} until{' '}
                              {formatTimestamp(session.expiresAt)}
                            </p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
