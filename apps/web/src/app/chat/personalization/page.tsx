'use client';

import { useEffect, useMemo, useState } from 'react';
import { EditIcon, PlusIcon, SaveIcon, TrashIcon } from '@/components/icons';
import { MemoryKindSelector } from '@/components/personalization/memory-kind-selector';
import {
  MEMORY_KIND_LABELS,
  MEMORY_KIND_ORDER,
  MEMORY_KIND_SINGULAR_LABELS,
  sortMemories,
} from '@/components/personalization/personalization-model';
import { Alert } from '@/components/ui/alert';
import { IconButton } from '@/components/ui/icon-button';
import { SettingsPageShell } from '@/components/ui/settings-page-shell';
import { Textarea } from '@/components/ui/textarea';
import { api, type PersonalizationMemory, type PersonalizationMemoryKind } from '@/lib/api-client';

export default function PersonalizationPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [writingStyle, setWritingStyle] = useState('');
  const [tonePreference, setTonePreference] = useState('');
  const [savedWritingStyle, setSavedWritingStyle] = useState('');
  const [savedTonePreference, setSavedTonePreference] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileSaveStatus, setProfileSaveStatus] = useState<string | null>(null);

  const [memories, setMemories] = useState<PersonalizationMemory[]>([]);
  const [newMemoryKind, setNewMemoryKind] = useState<PersonalizationMemoryKind | null>(null);
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
  const hasProfileChanges =
    writingStyle.trim() !== savedWritingStyle.trim() ||
    tonePreference.trim() !== savedTonePreference.trim();

  const loadPersonalization = async () => {
    setError(null);
    setIsLoading(true);

    try {
      const response = await api.personalization.get();
      const loadedWritingStyle = response.profile.writingStyle ?? '';
      const loadedTonePreference = response.profile.tonePreference ?? '';
      setWritingStyle(loadedWritingStyle);
      setTonePreference(loadedTonePreference);
      setSavedWritingStyle(loadedWritingStyle);
      setSavedTonePreference(loadedTonePreference);
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

  useEffect(() => {
    if (isLoading || isSavingProfile || !hasProfileChanges) {
      return;
    }

    setProfileSaveStatus(null);

    const submittedWritingStyle = writingStyle.trim();
    const submittedTonePreference = tonePreference.trim();
    const timeout = window.setTimeout(() => {
      void (async () => {
        setError(null);
        setIsSavingProfile(true);

        try {
          const response = await api.personalization.updateProfile({
            writingStyle: submittedWritingStyle || null,
            tonePreference: submittedTonePreference || null,
          });
          const savedWritingStyleValue = response.profile.writingStyle ?? '';
          const savedTonePreferenceValue = response.profile.tonePreference ?? '';

          setWritingStyle((current) =>
            current.trim() === submittedWritingStyle ? savedWritingStyleValue : current,
          );
          setTonePreference((current) =>
            current.trim() === submittedTonePreference ? savedTonePreferenceValue : current,
          );
          setSavedWritingStyle(savedWritingStyleValue);
          setSavedTonePreference(savedTonePreferenceValue);
          setProfileSaveStatus('Saved');
        } catch (requestError) {
          setError(requestError instanceof Error ? requestError.message : 'Failed to save profile.');
        } finally {
          setIsSavingProfile(false);
        }
      })();
    }, 900);

    return () => window.clearTimeout(timeout);
  }, [hasProfileChanges, isLoading, isSavingProfile, tonePreference, writingStyle]);

  useEffect(() => {
    if (!profileSaveStatus) {
      return;
    }

    const timeout = window.setTimeout(() => setProfileSaveStatus(null), 1800);
    return () => window.clearTimeout(timeout);
  }, [profileSaveStatus]);

  const handleCreateMemory = async () => {
    const content = newMemoryContent.trim();
    if (!content) {
      return;
    }
    if (!newMemoryKind) {
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
      setNewMemoryKind(null);
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
    <SettingsPageShell title="Personalization" closeLabel="Close personalization">
          {error ? (
            <Alert className="px-4 py-3">{error}</Alert>
          ) : null}

          {isLoading ? (
            <div className="py-10 text-sm text-foreground-muted">Loading personalization...</div>
          ) : (
            <>
              <section className="space-y-5">
                <h2 className="text-base font-medium text-foreground">Communication</h2>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="flex flex-col gap-2">
                    <span className="text-sm text-foreground-muted">Writing style</span>
                    <Textarea
                      value={writingStyle}
                      onChange={(event) => setWritingStyle(event.target.value)}
                      rows={4}
                      maxLength={500}
                      placeholder="Concise, direct, and technical."
                    />
                  </label>

                  <label className="flex flex-col gap-2">
                    <span className="text-sm text-foreground-muted">Tone preference</span>
                    <Textarea
                      value={tonePreference}
                      onChange={(event) => setTonePreference(event.target.value)}
                      rows={4}
                      maxLength={500}
                      placeholder="Warm, collaborative, and low-jargon."
                    />
                  </label>
                </div>

                {isSavingProfile || profileSaveStatus ? (
                  <p className="text-right text-xs text-foreground-muted">
                    {isSavingProfile ? 'Saving...' : profileSaveStatus}
                  </p>
                ) : null}
              </section>

              <section className="border-t border-border pt-6">
                <h2 className="text-base font-medium text-foreground">Memories</h2>

                <div className="mt-4 rounded-2xl border border-border bg-surface-elevated p-3 transition focus-within:border-accent">
                  <label className="block">
                    <span className="sr-only">New memory</span>
                    <Textarea
                      variant="transparent"
                      value={newMemoryContent}
                      onChange={(event) => setNewMemoryContent(event.target.value)}
                      rows={3}
                      maxLength={2000}
                      placeholder="Add something your assistant should remember..."
                    />
                  </label>
                  <div className="mt-3 flex items-center justify-end gap-2">
                    <MemoryKindSelector value={newMemoryKind} onChange={setNewMemoryKind} />
                    <IconButton
                      onClick={() => void handleCreateMemory()}
                      disabled={isCreatingMemory || !newMemoryKind || !newMemoryContent.trim()}
                      title={isCreatingMemory ? 'Adding memory' : 'Add memory'}
                      aria-label={isCreatingMemory ? 'Adding memory' : 'Add memory'}
                    >
                      <PlusIcon />
                    </IconButton>
                  </div>
                </div>

                {memories.length > 0 ? (
                  <div className="mt-6">
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
                                      <Textarea
                                        value={editingMemoryContent}
                                        onChange={(event) =>
                                          setEditingMemoryContent(event.target.value)
                                        }
                                        rows={4}
                                        maxLength={2000}
                                        disabled={isPending}
                                      />
                                      <div className="flex items-center justify-end gap-2">
                                        <button
                                          onClick={cancelEditingMemory}
                                          disabled={isPending}
                                          className="rounded-xl px-3 py-2 text-sm text-foreground-muted transition hover:bg-surface-hover hover:text-foreground disabled:opacity-50"
                                        >
                                          Cancel
                                        </button>
                                        <IconButton
                                          onClick={() => void handleSaveMemory(memory.id)}
                                          disabled={isPending || !editingMemoryContent.trim()}
                                          title={isPending ? 'Saving memory' : 'Save memory'}
                                          aria-label={isPending ? 'Saving memory' : 'Save memory'}
                                        >
                                          <SaveIcon />
                                        </IconButton>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="flex items-start gap-2">
                                      <p className="min-w-0 flex-1 text-sm leading-6 text-foreground">
                                        {memory.content}
                                      </p>
                                      <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                                        <IconButton
                                          size="sm"
                                          onClick={() => beginEditingMemory(memory)}
                                          disabled={isPending}
                                          className="rounded p-1"
                                          title="Edit memory"
                                          aria-label="Edit memory"
                                        >
                                          <EditIcon />
                                        </IconButton>
                                        <IconButton
                                          size="sm"
                                          variant="danger"
                                          onClick={() => void handleDeleteMemory(memory)}
                                          disabled={isPending}
                                          className="rounded p-1 hover:bg-surface"
                                          title="Delete memory"
                                          aria-label="Delete memory"
                                        >
                                          <TrashIcon />
                                        </IconButton>
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
                  </div>
                ) : null}
              </section>
            </>
          )}
    </SettingsPageShell>
  );
}

