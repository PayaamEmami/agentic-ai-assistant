'use client';

import { useEffect, useState } from 'react';
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
                <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground-muted">
                  A few durable details the assistant can use across chats.
                </p>
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
                    <p className="mt-1 text-sm text-foreground-muted">
                      Default style guidance for future replies.
                    </p>
                  </div>
                  <button
                    onClick={() => void handleSaveProfile()}
                    disabled={isSavingProfile}
                    className="self-start rounded-xl bg-accent px-3 py-2 text-sm font-medium text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
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
                    <p className="mt-1 text-sm text-foreground-muted">
                      {memories.length === 0
                        ? 'No saved memories yet.'
                        : `${memories.length} saved ${memories.length === 1 ? 'memory' : 'memories'}.`}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <label className="sr-only" htmlFor="new-memory-kind">
                      Category
                    </label>
                    <select
                      id="new-memory-kind"
                      value={newMemoryKind}
                      onChange={(event) =>
                        setNewMemoryKind(event.target.value as PersonalizationMemoryKind)
                      }
                      className="h-9 rounded-xl border border-border bg-surface-elevated px-3 text-sm text-foreground outline-none transition focus:border-accent"
                    >
                      {MEMORY_KIND_ORDER.map((kind) => (
                        <option key={kind} value={kind}>
                          {MEMORY_KIND_LABELS[kind]}
                        </option>
                      ))}
                    </select>

                    <button
                      onClick={() => void handleCreateMemory()}
                      disabled={isCreatingMemory || !newMemoryContent.trim()}
                      className="h-9 rounded-xl bg-accent px-3 text-sm font-medium text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
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

                <div className="mt-6 divide-y divide-border">
                  {memories.length === 0 ? (
                    <p className="py-8 text-sm text-foreground-muted">
                      Add your first memory to help future conversations feel more tailored.
                    </p>
                  ) : (
                    memories.map((memory) => {
                      const isEditing = editingMemoryId === memory.id;
                      const isPending = pendingMemoryId === memory.id;

                      return (
                        <div key={memory.id} className="py-4">
                          {isEditing ? (
                            <div className="space-y-3">
                              <textarea
                                value={editingMemoryContent}
                                onChange={(event) => setEditingMemoryContent(event.target.value)}
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
                                  className="rounded-xl bg-accent px-3 py-2 text-sm font-medium text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {isPending ? 'Saving...' : 'Save'}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground-inactive">
                                <span className="font-medium text-foreground-muted">
                                  {MEMORY_KIND_LABELS[memory.kind]}
                                </span>
                                <span>Updated {new Date(memory.updatedAt).toLocaleString()}</span>
                              </div>
                              <p className="text-sm leading-6 text-foreground">{memory.content}</p>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => beginEditingMemory(memory)}
                                  disabled={isPending}
                                  className="rounded-lg px-2 py-1 text-sm text-foreground-muted transition hover:bg-surface-hover hover:text-foreground disabled:opacity-50"
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => void handleDeleteMemory(memory)}
                                  disabled={isPending}
                                  className="rounded-lg px-2 py-1 text-sm text-foreground-muted transition hover:bg-surface-hover hover:text-error disabled:opacity-50"
                                >
                                  {isPending ? 'Deleting...' : 'Delete'}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })
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
