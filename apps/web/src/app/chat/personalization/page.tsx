'use client';

import { useEffect, useMemo, useState } from 'react';
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

  const groupedMemories = useMemo(
    () =>
      MEMORY_KIND_ORDER.map((kind) => ({
        kind,
        label: MEMORY_KIND_LABELS[kind],
        items: memories.filter((memory) => memory.kind === kind),
      })),
    [memories],
  );

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
    <div className="flex min-h-0 flex-1 flex-col bg-surface-elevated">
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
          <section>
            <div className="flex items-center justify-between gap-4">
              <h1 className="text-3xl font-semibold text-foreground">Personalization</h1>
              <Link
                href="/chat"
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-border-subtle bg-surface text-foreground-muted transition hover:border-border hover:bg-surface-hover hover:text-foreground"
                aria-label="Close personalization"
                title="Close"
              >
                <CloseIcon />
              </Link>
            </div>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-foreground-muted">
              Manage profile details and memories for this workspace.
            </p>
          </section>

          {error ? (
            <div className="rounded-2xl border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
              {error}
            </div>
          ) : null}

          {isLoading ? (
            <div className="rounded-3xl border border-border bg-surface p-6 text-sm text-foreground-muted">
              Loading personalization...
            </div>
          ) : (
            <>
              <section className="rounded-3xl border border-border bg-surface p-6">
                <div className="flex flex-col gap-6">
                  <div>
                    <h2 className="text-lg font-semibold text-foreground">Profile</h2>
                    <p className="mt-2 text-sm text-foreground-muted">
                      These settings shape the assistant&apos;s default writing style and tone
                      whenever it chats with you.
                    </p>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <label className="flex flex-col gap-2">
                      <span className="text-sm font-medium text-foreground">Writing style</span>
                      <textarea
                        value={writingStyle}
                        onChange={(event) => setWritingStyle(event.target.value)}
                        rows={4}
                        maxLength={500}
                        placeholder="Concise, direct, and technical."
                        className="rounded-2xl border border-border-subtle bg-surface-input px-4 py-3 text-sm text-foreground outline-none transition focus:border-accent"
                      />
                    </label>

                    <label className="flex flex-col gap-2">
                      <span className="text-sm font-medium text-foreground">Tone preference</span>
                      <textarea
                        value={tonePreference}
                        onChange={(event) => setTonePreference(event.target.value)}
                        rows={4}
                        maxLength={500}
                        placeholder="Warm, collaborative, and low-jargon."
                        className="rounded-2xl border border-border-subtle bg-surface-input px-4 py-3 text-sm text-foreground outline-none transition focus:border-accent"
                      />
                    </label>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-foreground-inactive">
                      Leave a field blank to clear it.
                    </p>
                    <button
                      onClick={() => void handleSaveProfile()}
                      disabled={isSavingProfile}
                      className="rounded-2xl bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isSavingProfile ? 'Saving...' : 'Save profile'}
                    </button>
                  </div>
                </div>
              </section>

              <section className="rounded-3xl border border-border bg-surface p-6">
                <div className="flex flex-col gap-6">
                  <div>
                    <h2 className="text-lg font-semibold text-foreground">Add memory</h2>
                    <p className="mt-2 text-sm text-foreground-muted">
                      Save details the assistant should keep in mind. Each memory has a fixed
                      category in this first version.
                    </p>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
                    <label className="flex flex-col gap-2">
                      <span className="text-sm font-medium text-foreground">Category</span>
                      <select
                        value={newMemoryKind}
                        onChange={(event) =>
                          setNewMemoryKind(event.target.value as PersonalizationMemoryKind)
                        }
                        className="rounded-2xl border border-border-subtle bg-surface-input px-4 py-3 text-sm text-foreground outline-none transition focus:border-accent"
                      >
                        {MEMORY_KIND_ORDER.map((kind) => (
                          <option key={kind} value={kind}>
                            {MEMORY_KIND_LABELS[kind]}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="flex flex-col gap-2">
                      <span className="text-sm font-medium text-foreground">Content</span>
                      <textarea
                        value={newMemoryContent}
                        onChange={(event) => setNewMemoryContent(event.target.value)}
                        rows={4}
                        maxLength={2000}
                        placeholder="I prefer concrete examples over abstract explanations."
                        className="rounded-2xl border border-border-subtle bg-surface-input px-4 py-3 text-sm text-foreground outline-none transition focus:border-accent"
                      />
                    </label>
                  </div>

                  <div className="flex justify-end">
                    <button
                      onClick={() => void handleCreateMemory()}
                      disabled={isCreatingMemory || !newMemoryContent.trim()}
                      className="rounded-2xl bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isCreatingMemory ? 'Saving...' : 'Add memory'}
                    </button>
                  </div>
                </div>
              </section>

              <section className="rounded-3xl border border-border bg-surface p-6">
                <div className="flex flex-col gap-6">
                  <div>
                    <h2 className="text-lg font-semibold text-foreground">Saved memories</h2>
                    <p className="mt-2 text-sm text-foreground-muted">
                      Memories are grouped by category. You can edit the text or remove entries
                      here.
                    </p>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-2">
                    {groupedMemories.map((group) => (
                      <div
                        key={group.kind}
                        className="rounded-2xl border border-border bg-surface-elevated p-4"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <h3 className="text-sm font-semibold text-foreground">{group.label}</h3>
                          <span className="rounded-full bg-surface-input px-2.5 py-1 text-xs text-foreground-muted">
                            {group.items.length}
                          </span>
                        </div>

                        <div className="mt-4 space-y-3">
                          {group.items.length === 0 ? (
                            <p className="rounded-2xl border border-dashed border-border-subtle px-4 py-4 text-sm text-foreground-inactive">
                              No saved {group.label.toLowerCase()} yet.
                            </p>
                          ) : (
                            group.items.map((memory) => {
                              const isEditing = editingMemoryId === memory.id;
                              const isPending = pendingMemoryId === memory.id;

                              return (
                                <div
                                  key={memory.id}
                                  className="rounded-2xl border border-border-subtle bg-surface px-4 py-4"
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
                                        className="w-full rounded-2xl border border-border-subtle bg-surface-input px-4 py-3 text-sm text-foreground outline-none transition focus:border-accent"
                                      />
                                      <div className="flex items-center justify-end gap-2">
                                        <button
                                          onClick={cancelEditingMemory}
                                          disabled={isPending}
                                          className="rounded-2xl px-3 py-2 text-sm text-foreground-muted transition hover:bg-surface-hover hover:text-foreground disabled:opacity-50"
                                        >
                                          Cancel
                                        </button>
                                        <button
                                          onClick={() => void handleSaveMemory(memory.id)}
                                          disabled={isPending || !editingMemoryContent.trim()}
                                          className="rounded-2xl bg-accent px-3 py-2 text-sm font-medium text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                          {isPending ? 'Saving...' : 'Save'}
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="space-y-3">
                                      <p className="text-sm leading-6 text-foreground">
                                        {memory.content}
                                      </p>
                                      <div className="flex items-center justify-between gap-3">
                                        <p className="text-xs text-foreground-inactive">
                                          Updated {new Date(memory.updatedAt).toLocaleString()}
                                        </p>
                                        <div className="flex items-center gap-2">
                                          <button
                                            onClick={() => beginEditingMemory(memory)}
                                            disabled={isPending}
                                            className="rounded-2xl px-3 py-2 text-sm text-foreground-muted transition hover:bg-surface-hover hover:text-foreground disabled:opacity-50"
                                          >
                                            Edit
                                          </button>
                                          <button
                                            onClick={() => void handleDeleteMemory(memory)}
                                            disabled={isPending}
                                            className="rounded-2xl px-3 py-2 text-sm text-foreground-muted transition hover:bg-surface-hover hover:text-error disabled:opacity-50"
                                          >
                                            {isPending ? 'Deleting...' : 'Delete'}
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
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
