'use client';

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { ChevronDownIcon } from '@/components/icons';
import { type GitHubRepositorySummary } from '@/lib/api-client';
import { useDismissOnOutsidePointerDown } from '@/lib/use-dismiss-on-outside-pointer-down';
import { selectedRepositoryLabel } from './labels';

interface GitHubRepositorySelectorProps {
  repositories: GitHubRepositorySummary[];
  selectedRepoIds: number[];
  saving: boolean;
  onSave: () => Promise<void>;
  onSelectedRepoIdsChange: Dispatch<SetStateAction<number[]>>;
}

export function GitHubRepositorySelector({
  repositories,
  selectedRepoIds,
  saving,
  onSave,
  onSelectedRepoIdsChange,
}: GitHubRepositorySelectorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

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

  useDismissOnOutsidePointerDown(containerRef, open, close);

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
    <div ref={containerRef} className="relative mt-4">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        disabled={repositories.length === 0}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-surface-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="min-w-0">
          <span className="block break-words text-sm font-medium text-foreground">
            Repositories
          </span>
          <span className="mt-1 block text-xs text-foreground-muted">
            {selectedRepositoryLabel(selectedRepoIds.length)}
          </span>
        </span>
        <ChevronDownIcon />
      </button>

      {repositories.length === 0 ? (
        <p className="mt-2 px-3 text-xs text-foreground-muted">No repositories loaded yet.</p>
      ) : null}

      {open ? (
        <div className="absolute right-0 z-20 mt-2 w-full rounded-2xl border border-border bg-surface-elevated p-3 shadow-lg">
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
