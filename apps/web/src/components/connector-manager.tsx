'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  api,
  type ConnectorSyncRunSummary,
  type ConnectorSummary,
  type GitHubRepositorySummary,
  type McpBrowserSessionSummary,
  type McpCatalogEntrySummary,
  type McpConnectionSummary,
} from '@/lib/api-client';
import { reportClientError } from '@/lib/client-logging';

const CONNECTOR_SECTION_STATE_STORAGE_KEY = 'connector-manager:collapsed-sections';

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
  switch (kind) {
    case 'google_docs':
      return 'Google Docs';
    case 'github':
      return 'GitHub';
    case 'google_drive_tools':
      return 'Google Drive';
    case 'github_tools':
      return 'GitHub';
    default:
      return kind;
  }
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

function indexedSourceSummary(connector: ConnectorSummary): string {
  const total = connector.totalSourceCount ?? 0;
  const searchable = connector.searchableSourceCount ?? 0;
  return `${searchable}/${total}`;
}

function isKnowledgeConnector(kind: ConnectorSummary['kind']): boolean {
  return kind === 'github' || kind === 'google_docs';
}

function isToolConnector(kind: ConnectorSummary['kind']): boolean {
  return kind === 'github_tools' || kind === 'google_drive_tools';
}

function mcpIntegrationLabel(kind: McpConnectionSummary['integrationKind']): string {
  switch (kind) {
    case 'playwright':
      return 'Playwright Browser';
    default:
      return kind;
  }
}

export function ConnectorManager() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [connectors, setConnectors] = useState<ConnectorSummary[]>([]);
  const [mcpCatalog, setMcpCatalog] = useState<McpCatalogEntrySummary[]>([]);
  const [mcpConnections, setMcpConnections] = useState<McpConnectionSummary[]>([]);
  const [mcpBrowserSessionsByConnection, setMcpBrowserSessionsByConnection] = useState<
    Record<string, McpBrowserSessionSummary>
  >({});
  const [githubRepos, setGitHubRepos] = useState<GitHubRepositorySummary[]>([]);
  const [selectedRepoIds, setSelectedRepoIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingRepos, setSavingRepos] = useState(false);
  const [disconnectingKind, setDisconnectingKind] = useState<ConnectorSummary['kind'] | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [hasLoadedCollapsedSections, setHasLoadedCollapsedSections] = useState(false);

  const connectorStatus = searchParams.get('connectorStatus');
  const connectorMessage = searchParams.get('connectorMessage');
  const connectorKind = searchParams.get('connector');

  const isSectionCollapsed = (kind: ConnectorSummary['kind'], section: string) =>
    collapsedSections[`${kind}:${section}`] ?? false;

  const toggleSection = (kind: ConnectorSummary['kind'], section: string) => {
    const key = `${kind}:${section}`;
    setCollapsedSections((previous) => ({
      ...previous,
      [key]: !(previous[key] ?? false),
    }));
  };

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) {
      setLoading(true);
    }

    try {
      const [
        connectorResponse,
        mcpCatalogResponse,
        mcpConnectionsResponse,
        mcpBrowserSessionsResponse,
      ] = await Promise.all([
        api.connectors.list(),
        api.mcp.catalog(),
        api.mcp.listConnections(),
        api.mcp.listBrowserSessions(),
      ]);
      const response = connectorResponse;
      setConnectors(response.connectors);
      setMcpCatalog(mcpCatalogResponse.integrations);
      setMcpConnections(mcpConnectionsResponse.connections);
      setMcpBrowserSessionsByConnection(
        Object.fromEntries(
          mcpBrowserSessionsResponse.sessions.map((session) => [session.mcpConnectionId, session]),
        ),
      );

      const github = response.connectors.find((connector) => connector.kind === 'github');
      if (github?.status === 'connected') {
        const repoResponse = await api.connectors.listGitHubRepos();
        setGitHubRepos(repoResponse.repositories);
        setSelectedRepoIds(
          repoResponse.repositories.filter((repo) => repo.selected).map((repo) => repo.id),
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
    try {
      const storedValue = window.localStorage.getItem(CONNECTOR_SECTION_STATE_STORAGE_KEY);
      if (!storedValue) {
        setHasLoadedCollapsedSections(true);
        return;
      }

      const parsed = JSON.parse(storedValue) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object') {
        setHasLoadedCollapsedSections(true);
        return;
      }

      setCollapsedSections(
        Object.fromEntries(
          Object.entries(parsed).filter(
            (entry): entry is [string, boolean] => typeof entry[1] === 'boolean',
          ),
        ),
      );
    } catch {
      // Ignore malformed local state and fall back to defaults.
    } finally {
      setHasLoadedCollapsedSections(true);
    }
  }, []);

  useEffect(() => {
    if (!hasLoadedCollapsedSections) {
      return;
    }

    window.localStorage.setItem(
      CONNECTOR_SECTION_STATE_STORAGE_KEY,
      JSON.stringify(collapsedSections),
    );
  }, [collapsedSections, hasLoadedCollapsedSections]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void load(false);
    }, 15000);

    return () => window.clearInterval(interval);
  }, [load]);

  useEffect(() => {
    const activeSessions = Object.values(mcpBrowserSessionsByConnection).filter(
      (session) => session.status === 'active' || session.status === 'pending',
    );
    if (activeSessions.length === 0) {
      return;
    }

    const interval = window.setInterval(() => {
      void Promise.all(
        activeSessions.map(async (session) => {
          try {
            const response = await api.mcp.getBrowserSession(session.id);
            setMcpBrowserSessionsByConnection((previous) => ({
              ...previous,
              [response.session.mcpConnectionId]: response.session,
            }));
          } catch {
            // Ignore background polling failures; explicit actions surface them.
          }
        }),
      );
    }, 5000);

    return () => window.clearInterval(interval);
  }, [mcpBrowserSessionsByConnection]);

  const startConnection = async (
    kind: 'github' | 'google_docs' | 'github_tools' | 'google_drive_tools',
  ) => {
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

  const triggerSync = async (
    kind: 'github' | 'google_docs' | 'github_tools' | 'google_drive_tools',
  ) => {
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
      await api.connectors.sync('github');
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
      setActionError(
        error instanceof Error ? error.message : 'Failed to save repository selection',
      );
    } finally {
      setSavingRepos(false);
    }
  };

  const disconnect = async (kind: ConnectorSummary['kind']) => {
    const label = connectorLabel(kind);
    const removesIndexedData = kind === 'github' || kind === 'google_docs';
    const confirmed = window.confirm(
      removesIndexedData
        ? `Disconnect ${label} and remove its indexed data from this workspace?`
        : `Disconnect ${label} from this workspace?`,
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

  const createMcpConnection = async (catalogEntry: McpCatalogEntrySummary) => {
    const instanceLabel = window.prompt(
      `Name this ${catalogEntry.displayName} instance`,
      `${catalogEntry.displayName} ${mcpConnections.filter((connection) => connection.integrationKind === catalogEntry.kind).length + 1}`,
    );
    if (!instanceLabel || !instanceLabel.trim()) {
      return;
    }

    const secretProfileInput = window.prompt(
      'Optional: paste a JSON secret profile for stored-secret login. Leave blank to create a manual sign-in connection.',
      '',
    );

    let secretProfile: Record<string, unknown> | undefined;
    if (secretProfileInput && secretProfileInput.trim()) {
      try {
        const parsed = JSON.parse(secretProfileInput) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('Secret profile must be a JSON object');
        }
        secretProfile = parsed as Record<string, unknown>;
      } catch (error) {
        setActionError(error instanceof Error ? error.message : 'Invalid secret profile JSON');
        return;
      }
    }

    setActionError(null);
    try {
      await api.mcp.createConnection({
        integrationKind: catalogEntry.kind,
        instanceLabel: instanceLabel.trim(),
        authMode: secretProfile ? 'stored_secret' : 'manual_browser',
        secretProfile,
      });
      await load(false);
    } catch (error) {
      void reportClientError({
        event: 'client.mcp.create_failed',
        component: 'connector-manager',
        message: `Failed to create ${catalogEntry.kind} MCP connection`,
        error,
      });
      setActionError(error instanceof Error ? error.message : 'Failed to create MCP connection');
    }
  };

  const openEmbeddedBrowser = async (
    connection: McpConnectionSummary,
    purpose: 'auth' | 'manual' | 'tool_takeover' = 'auth',
  ) => {
    setActionError(null);
    try {
      const response = await api.mcp.createBrowserSession(connection.id, { purpose });
      setMcpBrowserSessionsByConnection((previous) => ({
        ...previous,
        [connection.id]: response.session,
      }));
      router.push(`/chat/browser/${response.session.id}`);
      await load(false);
    } catch (error) {
      void reportClientError({
        event: 'client.mcp.browser_session_start_failed',
        component: 'connector-manager',
        message: `Failed to start browser session for ${connection.id}`,
        error,
      });
      setActionError(error instanceof Error ? error.message : 'Failed to start browser session');
    }
  };

  const setDefaultMcpConnection = async (connectionId: string) => {
    setActionError(null);
    try {
      await api.mcp.setDefaultConnection(connectionId);
      await load(false);
    } catch (error) {
      void reportClientError({
        event: 'client.mcp.set_default_failed',
        component: 'connector-manager',
        message: `Failed to set default MCP connection ${connectionId}`,
        error,
      });
      setActionError(error instanceof Error ? error.message : 'Failed to set default browser');
    }
  };

  const deleteMcpConnection = async (connection: McpConnectionSummary) => {
    const confirmed = window.confirm(
      `Remove the ${mcpIntegrationLabel(connection.integrationKind)} instance "${connection.instanceLabel}"?`,
    );
    if (!confirmed) {
      return;
    }

    setActionError(null);
    try {
      await api.mcp.deleteConnection(connection.id);
      setMcpBrowserSessionsByConnection((previous) => {
        const next = { ...previous };
        delete next[connection.id];
        return next;
      });
      await load(false);
    } catch (error) {
      void reportClientError({
        event: 'client.mcp.delete_failed',
        component: 'connector-manager',
        message: `Failed to delete MCP connection ${connection.id}`,
        error,
      });
      setActionError(error instanceof Error ? error.message : 'Failed to remove browser');
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
            connectorKind === 'github'
              ? 'github'
              : connectorKind === 'github_tools'
                ? 'github_tools'
                : connectorKind === 'google_drive_tools'
                  ? 'google_drive_tools'
                  : 'google_docs',
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
        <>
          {[
            {
              id: 'knowledge',
              title: 'Knowledge',
              description:
                'These connectors sync content into your workspace for retrieval-augmented generation and reference during chat.',
              connectors: connectors.filter((connector) => isKnowledgeConnector(connector.kind)),
            },
            {
              id: 'tools',
              title: 'Tools',
              description:
                'These connectors let the assistant use connected provider APIs during chat to perform tasks in those services.',
              connectors: connectors.filter((connector) => isToolConnector(connector.kind)),
            },
          ].map((group) =>
            group.connectors.length === 0 ? null : (
              <section key={group.id} className="space-y-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.2em] text-accent">
                    {group.title}
                  </p>
                  <p className="mt-1 text-sm text-foreground-muted">{group.description}</p>
                </div>
                <div className="space-y-3">
                  {group.connectors.map((connector) => (
                    <div
                      key={connector.kind}
                      className="rounded-xl border border-border bg-surface-overlay p-3"
                    >
                      {(() => {
                        const requiresRepoSelection = connector.kind === 'github';
                        const supportsSync = isKnowledgeConnector(connector.kind);
                        const selectedRepoCount = connector.selectedRepoCount ?? 0;
                        const showRepoWarning =
                          connector.kind === 'github' &&
                          connector.hasCredentials &&
                          connector.status === 'connected' &&
                          selectedRepoCount === 0;
                        const showMeta = showRepoWarning || Boolean(connector.lastError);
                        const syncDisabled =
                          !supportsSync ||
                          connector.status !== 'connected' ||
                          (requiresRepoSelection && selectedRepoCount === 0);

                        return (
                          <div className={showMeta ? 'space-y-2' : undefined}>
                            <div className="flex items-center justify-between gap-3">
                              <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                                <span>{connectorLabel(connector.kind)}</span>
                                {connector.hasCredentials && connector.status === 'connected' ? (
                                  <ConnectedIcon />
                                ) : (
                                  <DisconnectedIcon />
                                )}
                              </p>
                              <div className="flex flex-wrap items-center justify-end gap-2">
                                {!connector.hasCredentials || connector.status !== 'connected' ? (
                                  <button
                                    onClick={() => void startConnection(connector.kind)}
                                    className="rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-accent-hover"
                                  >
                                    Connect
                                  </button>
                                ) : supportsSync ? (
                                  <button
                                    onClick={() => void triggerSync(connector.kind)}
                                    disabled={syncDisabled}
                                    className="rounded-lg border border-border-subtle px-3 py-2 text-xs font-medium text-foreground hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {connector.kind === 'github' && selectedRepoCount === 0
                                      ? 'Select repos first'
                                      : 'Sync now'}
                                  </button>
                                ) : null}
                                {connector.hasCredentials ? (
                                  <button
                                    onClick={() => void disconnect(connector.kind)}
                                    disabled={disconnectingKind === connector.kind}
                                    className="rounded-lg border border-border-subtle px-3 py-2 text-xs font-medium text-foreground-muted hover:bg-surface-hover hover:text-error disabled:opacity-50"
                                  >
                                    {disconnectingKind === connector.kind
                                      ? 'Disconnecting...'
                                      : 'Disconnect'}
                                  </button>
                                ) : null}
                              </div>
                            </div>
                            {showMeta ? (
                              <div>
                                {showRepoWarning ? (
                                  <p className="mt-1 text-xs text-warning">
                                    Select and save at least one repository before syncing.
                                  </p>
                                ) : null}
                                {connector.lastError ? (
                                  <p className="mt-2 text-xs text-error">{connector.lastError}</p>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        );
                      })()}

                      {isKnowledgeConnector(connector.kind) ? (
                        <div className="mt-3 space-y-2">
                          <button
                            type="button"
                            onClick={() => toggleSection(connector.kind, 'sync-runs')}
                            className="flex w-full items-center justify-between gap-2 text-left text-xs font-medium uppercase tracking-wide text-foreground-muted transition hover:text-foreground"
                          >
                            <span>Recent Sync Runs</span>
                            {isSectionCollapsed(connector.kind, 'sync-runs') ? (
                              <ChevronLeftIcon />
                            ) : (
                              <ChevronDownIcon />
                            )}
                          </button>
                          {isSectionCollapsed(connector.kind, 'sync-runs') ? null : connector
                              .recentSyncRuns.length === 0 ? (
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
                                  {run.itemsDiscovered} seen | {run.itemsQueued} queued
                                  {run.itemsDeleted > 0 ? ` | ${run.itemsDeleted} removed` : ''}
                                  {run.errorCount > 0 ? ` | ${run.errorCount} errors` : ''}
                                </p>
                                {run.errorSummary ? (
                                  <p className="mt-2 text-error">{run.errorSummary}</p>
                                ) : null}
                              </div>
                            ))
                          )}
                        </div>
                      ) : null}

                      {isKnowledgeConnector(connector.kind) ? (
                        <div className="mt-3 space-y-2">
                          <button
                            type="button"
                            onClick={() => toggleSection(connector.kind, 'sources')}
                            className="flex w-full items-center justify-between gap-2 text-left text-xs font-medium uppercase tracking-wide text-foreground-muted transition hover:text-foreground"
                          >
                            <span>Indexed Sources ({indexedSourceSummary(connector)})</span>
                            {isSectionCollapsed(connector.kind, 'sources') ? (
                              <ChevronLeftIcon />
                            ) : (
                              <ChevronDownIcon />
                            )}
                          </button>
                          {isSectionCollapsed(connector.kind, 'sources') ? null : connector
                              .recentSources.length === 0 ? (
                            <p className="text-xs text-foreground-muted">No indexed sources yet.</p>
                          ) : (
                            <>
                              <p className="text-xs text-foreground-muted">
                                Searchable means the source has finished chunking and embedding for
                                retrieval.
                              </p>
                              {connector.recentSources.map((source) => (
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
                              ))}
                            </>
                          )}
                        </div>
                      ) : null}

                      {connector.kind === 'github' && connector.status === 'connected' ? (
                        <div className="mt-3 space-y-2">
                          <button
                            type="button"
                            onClick={() => toggleSection(connector.kind, 'repositories')}
                            className="flex w-full items-center justify-between gap-2 text-left text-xs font-medium uppercase tracking-wide text-foreground-muted transition hover:text-foreground"
                          >
                            <span>Repositories ({connector.selectedRepoCount ?? 0} selected)</span>
                            {isSectionCollapsed(connector.kind, 'repositories') ? (
                              <ChevronLeftIcon />
                            ) : (
                              <ChevronDownIcon />
                            )}
                          </button>
                          {isSectionCollapsed(connector.kind, 'repositories') ? null : (
                            <>
                              <p className="text-xs text-foreground-muted">
                                Save your repository selection to update what GitHub indexes. Saving
                                will automatically queue a sync.
                              </p>
                              {githubRepos.length === 0 ? (
                                <p className="text-xs text-foreground-muted">
                                  No repositories loaded yet.
                                </p>
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
                                          <span className="block font-medium text-foreground">
                                            {repo.fullName}
                                          </span>
                                          <span className="block text-foreground-muted">
                                            {repo.private ? 'Private' : 'Public'} | default branch{' '}
                                            {repo.defaultBranch}
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
                            </>
                          )}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>
            ),
          )}
          {mcpCatalog.length > 0 ? (
            <section className="space-y-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-accent">
                  Environments
                </p>
                <p className="mt-1 text-sm text-foreground-muted">
                  These connectors add extra environments powered by Model Context Protocol (MCP).
                </p>
              </div>
              <div className="space-y-3">
                {mcpCatalog.map((catalogEntry) => {
                  const connectionsForKind = mcpConnections.filter(
                    (connection) => connection.integrationKind === catalogEntry.kind,
                  );
                  return (
                    <div
                      key={catalogEntry.kind}
                      className="rounded-xl border border-border bg-surface-overlay p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {catalogEntry.displayName}
                          </p>
                          <p className="mt-1 text-xs text-foreground-muted">
                            {catalogEntry.description}
                          </p>
                        </div>
                        <button
                          onClick={() => void createMcpConnection(catalogEntry)}
                          className="rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-accent-hover"
                        >
                          Add instance
                        </button>
                      </div>
                      <div className="mt-3 space-y-3">
                        {connectionsForKind.length === 0 ? (
                          <p className="text-xs text-foreground-muted">
                            No instances configured yet.
                          </p>
                        ) : (
                          connectionsForKind.map((connection) => {
                            const browserSession = mcpBrowserSessionsByConnection[connection.id];
                            return (
                              <div
                                key={connection.id}
                                className="rounded-lg border border-border px-3 py-3 text-xs"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <p className="font-medium text-foreground">
                                      {connection.instanceLabel}
                                    </p>
                                    <p className="mt-1 text-foreground-muted">
                                      {connection.status === 'connected'
                                        ? 'Ready for chat tool use'
                                        : connection.status === 'failed'
                                          ? 'Needs attention'
                                          : 'Waiting for sign-in or credentials'}
                                      {connection.isDefaultActive ? ' | Default active' : ''}
                                    </p>
                                    {connection.lastError ? (
                                      <p className="mt-2 text-error">{connection.lastError}</p>
                                    ) : null}
                                  </div>
                                  <div className="flex flex-wrap justify-end gap-2">
                                    {!connection.isDefaultActive ? (
                                      <button
                                        onClick={() => void setDefaultMcpConnection(connection.id)}
                                        className="rounded-lg border border-border-subtle px-3 py-2 text-xs font-medium text-foreground hover:bg-surface-hover"
                                      >
                                        Make default
                                      </button>
                                    ) : null}
                                    <button
                                      onClick={() => void openEmbeddedBrowser(connection, 'auth')}
                                      className="rounded-lg border border-border-subtle px-3 py-2 text-xs font-medium text-foreground hover:bg-surface-hover"
                                    >
                                      Open embedded sign-in
                                    </button>
                                    <button
                                      onClick={() => void deleteMcpConnection(connection)}
                                      className="rounded-lg border border-border-subtle px-3 py-2 text-xs font-medium text-foreground-muted hover:bg-surface-hover hover:text-error"
                                    >
                                      Remove
                                    </button>
                                  </div>
                                </div>
                                {browserSession ? (
                                  <div className="mt-3 rounded-lg bg-surface px-3 py-2 text-xs text-foreground-muted">
                                    <p className="font-medium text-foreground">
                                      Browser session: {browserSession.status}
                                    </p>
                                    <p className="mt-1">
                                      Expires {formatRunTimestamp(browserSession.expiresAt)}
                                    </p>
                                    {browserSession.status === 'active' ||
                                    browserSession.status === 'pending' ? (
                                      <button
                                        onClick={() =>
                                          router.push(`/chat/browser/${browserSession.id}`)
                                        }
                                        className="mt-2 rounded-lg bg-surface-input px-3 py-2 text-xs font-medium text-foreground ring-1 ring-border-subtle hover:bg-surface-hover"
                                      >
                                        Reopen browser workspace
                                      </button>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function ChevronLeftIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function ConnectedIcon() {
  return (
    <span
      className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-success/15 text-success"
      aria-label="Connected"
      title="Connected"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </span>
  );
}

function DisconnectedIcon() {
  return (
    <span
      className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-error/15 text-error"
      aria-label="Not connected"
      title="Not connected"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m18 6-12 12" />
        <path d="m6 6 12 12" />
      </svg>
    </span>
  );
}
