'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { useSearchParams } from 'next/navigation';
import {
  api,
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
    return 'Ask about your codebase, reference files, and make changes in selected repositories.';
  }

  return 'Ask about your files, reference documents, and make edits from chat.';
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return 'Never';
  }

  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? 'Unknown time' : timestamp.toLocaleString().replace(',', '');
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

function ChevronDownIcon({
  animated = false,
  collapsed = false,
}: {
  animated?: boolean;
  collapsed?: boolean;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 text-foreground-muted ${animated ? 'transition-transform' : ''} ${
        collapsed ? 'rotate-90' : ''
      }`}
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function IndexedSourcesSection({ app }: { app: AppSummary }) {
  const [open, setOpen] = useState(false);
  const sourcesId = `${app.kind}-indexed-sources`;

  return (
    <div className="mt-5 min-w-0">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
        aria-controls={sourcesId}
        className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-surface-hover hover:text-foreground"
      >
        <span className="min-w-0">
          <span className="block break-words text-sm font-medium text-foreground">
            Indexed Sources ({app.knowledge.searchableSourceCount}/
            {app.knowledge.totalSourceCount})
          </span>
          <span className="mt-1 block text-xs text-foreground-muted">
            {open ? 'Hide indexed source details' : 'Show indexed source details'}
          </span>
        </span>
        <ChevronDownIcon animated collapsed={!open} />
      </button>

      {open ? (
        <div id={sourcesId} className="pl-6 pr-3">
          {app.knowledge.recentSources.length === 0 ? (
            <p className="mt-3 text-xs text-foreground-muted">No indexed sources yet.</p>
          ) : (
            <div className="mt-3">
              {app.knowledge.recentSources.map((source) => (
                <div key={source.id} className="min-w-0 py-3 text-xs first:pt-0 last:pb-0">
                  <p className="break-words font-medium text-foreground">{source.title}</p>
                  <p className="mt-1 text-foreground-muted">{formatTimestamp(source.updatedAt)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
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
  const containerRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!open) {
      return;
    }

    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', closeOnOutsidePointerDown);

    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointerDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative mt-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium text-foreground">Repositories</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((previous) => !previous)}
          disabled={repositories.length === 0}
          aria-expanded={open}
          aria-haspopup="listbox"
          className="inline-flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-elevated px-3 py-2 text-left text-xs font-medium text-foreground transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60 sm:min-w-52"
        >
          <span>{selectedRepositoryLabel(selectedRepoIds.length)}</span>
          <ChevronDownIcon />
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
            <div className="mt-3 max-h-56 space-y-1 overflow-y-auto pr-1">
              {filteredRepositories.map((repository) => {
                const selected = selectedRepoIdSet.has(repository.id);

                return (
                  <label
                    key={repository.id}
                    className={`flex cursor-pointer items-start gap-2 rounded-xl px-3 py-2 text-xs font-medium transition ${
                      selected
                        ? 'bg-surface-accent text-foreground'
                        : 'text-foreground-muted hover:bg-surface-hover hover:text-foreground'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={(event) => toggleRepository(repository.id, event.target.checked)}
                      className="mt-0.5"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-foreground">{repository.fullName}</span>
                      <span className="block font-normal text-foreground-muted">
                        {repository.private ? 'Private' : 'Public'} | {repository.defaultBranch}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
          <div className="mt-3 flex items-center justify-end gap-2 pt-3">
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
              className="rounded-xl border border-border bg-surface-elevated px-3 py-2 text-sm font-medium text-foreground-muted transition hover:border-accent/50 hover:bg-surface-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
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
                    {!isConnected ? (
                      <button
                        onClick={() => void connectApp(app.kind)}
                        className="rounded-xl border border-border bg-surface-elevated px-3 py-2 text-sm font-medium text-foreground-muted transition hover:border-accent/50 hover:bg-surface-hover hover:text-foreground"
                      >
                        Connect
                      </button>
                    ) : null}
                    {isConnected ? (
                      <button
                        onClick={() => void syncApp(app.kind)}
                        disabled={syncDisabled}
                        className="rounded-xl border border-border bg-surface-elevated px-3 py-2 text-sm font-medium text-foreground-muted transition hover:border-accent/50 hover:bg-surface-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Sync
                      </button>
                    ) : null}
                    {isConnected ? (
                      <button
                        onClick={() => void disconnectApp(app.kind)}
                        disabled={disconnectingKind === app.kind}
                        className="rounded-xl border border-border bg-surface-elevated px-3 py-2 text-sm font-medium text-foreground-muted transition hover:border-error/40 hover:bg-error/10 hover:text-error disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {disconnectingKind === app.kind ? 'Disconnecting...' : 'Disconnect'}
                      </button>
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
