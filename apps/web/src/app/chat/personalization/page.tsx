'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { api, type PersonalizationMemory, type PersonalizationMemoryKind } from '@/lib/api-client';

const MEMORY_KIND_ORDER: PersonalizationMemoryKind[] = [
  'fact',
  'preference',
  'relationship',
  'project',
  'person',
  'instruction',
];
const MEMORY_KIND_LABELS: Record<PersonalizationMemoryKind, string> = {
  fact: 'Facts',
  preference: 'Preferences',
  relationship: 'Relationships',
  project: 'Projects',
  person: 'People',
  instruction: 'Instructions',
};
const MEMORY_KIND_SINGULAR_LABELS: Record<PersonalizationMemoryKind, string> = {
  fact: 'fact',
  preference: 'preference',
  relationship: 'relationship',
  project: 'project',
  person: 'person',
  instruction: 'instruction',
};

function sortMemories(memories: PersonalizationMemory[]) {
  return [...memories].sort((left, right) => {
    const kindDelta = MEMORY_KIND_ORDER.indexOf(left.kind) - MEMORY_KIND_ORDER.indexOf(right.kind);
    if (kindDelta !== 0) {
      return kindDelta;
    }

    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });
}

function MemoryKindSelector({
  value,
  onChange,
}: {
  value: PersonalizationMemoryKind;
  onChange: (value: PersonalizationMemoryKind) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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
    <div ref={containerRef} className="relative sm:min-w-52">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="inline-flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-surface-elevated px-3 py-2 text-left text-xs font-medium text-foreground transition hover:bg-surface-hover"
      >
        <span>{MEMORY_KIND_LABELS[value]}</span>
        <ChevronDownIcon />
      </button>

      {open ? (
        <div
          role="listbox"
          className="absolute right-0 z-20 mt-2 w-full rounded-2xl border border-border bg-surface-elevated p-1 shadow-lg"
        >
          {MEMORY_KIND_ORDER.map((kind) => (
            <button
              key={kind}
              type="button"
              role="option"
              aria-selected={kind === value}
              onClick={() => {
                onChange(kind);
                setOpen(false);
              }}
              className={`w-full rounded-xl px-3 py-2 text-left text-xs font-medium transition ${
                kind === value
                  ? 'bg-surface-accent text-foreground'
                  : 'text-foreground-muted hover:bg-surface-hover hover:text-foreground'
              }`}
            >
              {MEMORY_KIND_LABELS[kind]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function PersonalizationPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [writingStyle, setWritingStyle] = useState('');
  const [tonePreference, setTonePreference] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  const [memories, setMemories] = useState<PersonalizationMemory[]>([]);
  const [newMemoryKind, setNewMemoryKind] = useState<PersonalizationMemoryKind>('fact');
  const [newMemoryContent, setNewMemoryContent] = useState('');
  const [isCreatingMemory, setIsCreatingMemory] = useState(false);
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [editingMemoryContent, setEditingMemoryContent] = useState('');
  const [pendingMemoryId, setPendingMemoryId] = useState<string | null>(null);
  const memoryGroups = useMemo(
    () =>
      MEMORY_KIND_ORDER.map((kind) => ({
        kind,
        memories: memories.filter((memory) => memory.kind === kind),
      })).filter((group) => group.memories.length > 0),
    [memories],
  );

  const loadPersonalization = async () => {
    setError(null);
    setIsLoading(true);

    try {
      const response = await api.personalization.get();
      setWritingStyle(response.profile.writingStyle ?? '');
      setTonePreference(response.profile.tonePreference ?? '');
      setMemories(sortMemories(response.memories));
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : 'Failed to load personalization.',
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadPersonalization();
  }, []);

  const handleSaveProfile = async () => {
    setError(null);
    setIsSavingProfile(true);

    try {
      const response = await api.personalization.updateProfile({
        writingStyle: writingStyle.trim() || null,
        tonePreference: tonePreference.trim() || null,
      });
      setWritingStyle(response.profile.writingStyle ?? '');
      setTonePreference(response.profile.tonePreference ?? '');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to save profile.');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleCreateMemory = async () => {
    const content = newMemoryContent.trim();
    if (!content) {
      return;
    }

    setError(null);
    setIsCreatingMemory(true);

    try {
      const response = await api.personalization.createMemory({
        kind: newMemoryKind,
        content,
      });
      setMemories((previous) => sortMemories([...previous, response.memory]));
      setNewMemoryContent('');
      setNewMemoryKind('fact');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to create memory.');
    } finally {
      setIsCreatingMemory(false);
    }
  };

  const beginEditingMemory = (memory: PersonalizationMemory) => {
    setEditingMemoryId(memory.id);
    setEditingMemoryContent(memory.content);
  };

  const cancelEditingMemory = () => {
    setEditingMemoryId(null);
    setEditingMemoryContent('');
  };

  const handleSaveMemory = async (memoryId: string) => {
    const content = editingMemoryContent.trim();
    if (!content) {
      return;
    }

    setError(null);
    setPendingMemoryId(memoryId);

    try {
      const response = await api.personalization.updateMemory(memoryId, { content });
      setMemories((previous) =>
        sortMemories(previous.map((memory) => (memory.id === memoryId ? response.memory : memory))),
      );
      cancelEditingMemory();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to update memory.');
    } finally {
      setPendingMemoryId(null);
    }
  };

  const handleDeleteMemory = async (memory: PersonalizationMemory) => {
    const confirmed = window.confirm(
      `Delete this ${MEMORY_KIND_SINGULAR_LABELS[memory.kind]} memory?`,
    );
    if (!confirmed) {
      return;
    }

    setError(null);
    setPendingMemoryId(memory.id);

    try {
      await api.personalization.deleteMemory(memory.id);
      setMemories((previous) => previous.filter((item) => item.id !== memory.id));
      if (editingMemoryId === memory.id) {
        cancelEditingMemory();
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to delete memory.');
    } finally {
      setPendingMemoryId(null);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
          <section className="border-b border-border pb-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-foreground-inactive">
                  Settings
                </p>
                <h1 className="text-2xl font-semibold text-foreground">Personalization</h1>
              </div>
              <Link
                href="/chat"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-foreground-muted transition hover:bg-surface-hover hover:text-foreground"
                aria-label="Close personalization"
                title="Close"
              >
                <CloseIcon />
              </Link>
            </div>
          </section>

          {error ? (
            <div className="rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
              {error}
            </div>
          ) : null}

          {isLoading ? (
            <div className="py-10 text-sm text-foreground-muted">Loading personalization...</div>
          ) : (
            <>
              <section className="space-y-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-base font-medium text-foreground">Profile</h2>
                  </div>
                  <button
                    onClick={() => void handleSaveProfile()}
                    disabled={isSavingProfile}
                    className="self-start rounded-xl border border-border bg-surface-elevated px-3 py-2 text-sm font-medium text-foreground-muted transition hover:border-accent/50 hover:bg-surface-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSavingProfile ? 'Saving...' : 'Save'}
                  </button>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="flex flex-col gap-2">
                    <span className="text-sm text-foreground-muted">Writing style</span>
                    <textarea
                      value={writingStyle}
                      onChange={(event) => setWritingStyle(event.target.value)}
                      rows={4}
                      maxLength={500}
                      placeholder="Concise, direct, and technical."
                      className="resize-none rounded-xl border border-border bg-surface-elevated px-3 py-2.5 text-sm leading-6 text-foreground outline-none transition placeholder:text-foreground-inactive focus:border-accent"
                    />
                  </label>

                  <label className="flex flex-col gap-2">
                    <span className="text-sm text-foreground-muted">Tone preference</span>
                    <textarea
                      value={tonePreference}
                      onChange={(event) => setTonePreference(event.target.value)}
                      rows={4}
                      maxLength={500}
                      placeholder="Warm, collaborative, and low-jargon."
                      className="resize-none rounded-xl border border-border bg-surface-elevated px-3 py-2.5 text-sm leading-6 text-foreground outline-none transition placeholder:text-foreground-inactive focus:border-accent"
                    />
                  </label>
                </div>
              </section>

              <section className="border-t border-border pt-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-base font-medium text-foreground">Memories</h2>
                  </div>

                  <div className="flex items-center gap-2">
                    <MemoryKindSelector value={newMemoryKind} onChange={setNewMemoryKind} />

                    <button
                      onClick={() => void handleCreateMemory()}
                      disabled={isCreatingMemory || !newMemoryContent.trim()}
                      className="rounded-xl border border-border bg-surface-elevated px-3 py-2 text-sm font-medium text-foreground-muted transition hover:border-accent/50 hover:bg-surface-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isCreatingMemory ? 'Saving...' : 'Add'}
                    </button>
                  </div>
                </div>

                <label className="mt-4 block">
                  <span className="sr-only">New memory</span>
                  <textarea
                    value={newMemoryContent}
                    onChange={(event) => setNewMemoryContent(event.target.value)}
                    rows={3}
                    maxLength={2000}
                    placeholder="Add something the assistant should remember..."
                    className="w-full resize-none rounded-xl border border-border bg-surface-elevated px-3 py-2.5 text-sm leading-6 text-foreground outline-none transition placeholder:text-foreground-inactive focus:border-accent"
                  />
                </label>

                <div className="mt-6">
                  {memories.length === 0 ? (
                    <p className="py-8 text-sm text-foreground-muted">
                      Add your first memory to help future conversations feel more tailored.
                    </p>
                  ) : (
                    <div className="space-y-6">
                      {memoryGroups.map((group) => (
                        <section key={group.kind} className="space-y-2">
                          <h3 className="text-sm font-medium text-foreground-muted">
                            {MEMORY_KIND_LABELS[group.kind]}
                          </h3>
                          <div className="space-y-1">
                            {group.memories.map((memory) => {
                              const isEditing = editingMemoryId === memory.id;
                              const isPending = pendingMemoryId === memory.id;

                              return (
                                <div
                                  key={memory.id}
                                  className="group rounded-xl px-3 py-2 transition hover:bg-surface-hover"
                                >
                                  {isEditing ? (
                                    <div className="space-y-3">
                                      <textarea
                                        value={editingMemoryContent}
                                        onChange={(event) =>
                                          setEditingMemoryContent(event.target.value)
                                        }
                                        rows={4}
                                        maxLength={2000}
                                        disabled={isPending}
                                        className="w-full resize-none rounded-xl border border-border bg-surface-elevated px-3 py-2.5 text-sm leading-6 text-foreground outline-none transition focus:border-accent"
                                      />
                                      <div className="flex items-center justify-end gap-2">
                                        <button
                                          onClick={cancelEditingMemory}
                                          disabled={isPending}
                                          className="rounded-xl px-3 py-2 text-sm text-foreground-muted transition hover:bg-surface-hover hover:text-foreground disabled:opacity-50"
                                        >
                                          Cancel
                                        </button>
                                        <button
                                          onClick={() => void handleSaveMemory(memory.id)}
                                          disabled={isPending || !editingMemoryContent.trim()}
                                          className="rounded-xl border border-border bg-surface-elevated px-3 py-2 text-sm font-medium text-foreground-muted transition hover:border-accent/50 hover:bg-surface-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                          {isPending ? 'Saving...' : 'Save'}
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="flex items-start gap-2">
                                      <p className="min-w-0 flex-1 text-sm leading-6 text-foreground">
                                        {memory.content}
                                      </p>
                                      <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                                        <button
                                          type="button"
                                          onClick={() => beginEditingMemory(memory)}
                                          disabled={isPending}
                                          className="rounded p-1 text-foreground-muted hover:bg-surface hover:text-foreground disabled:opacity-50"
                                          title="Edit memory"
                                          aria-label="Edit memory"
                                        >
                                          <EditIcon />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => void handleDeleteMemory(memory)}
                                          disabled={isPending}
                                          className="rounded p-1 text-foreground-muted hover:bg-surface hover:text-error disabled:opacity-50"
                                          title="Delete memory"
                                          aria-label="Delete memory"
                                        >
                                          <TrashIcon />
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </section>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function CloseIcon() {
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
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function ChevronDownIcon() {
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
      className="shrink-0 text-foreground-muted"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function EditIcon() {
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
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function TrashIcon() {
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
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}
