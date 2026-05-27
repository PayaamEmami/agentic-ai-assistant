'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { api, type PersonalizationMemory, type PersonalizationMemoryKind } from '@/lib/api-client';
import { MemoryComposer } from './memory-composer';
import { MemoryList } from './memory-list';
import {
  MEMORY_KIND_ORDER,
  MEMORY_KIND_SINGULAR_LABELS,
  sortMemories,
} from './model';
import { ProfileForm } from './profile-form';

export function PersonalizationManager() {
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

  const loadPersonalization = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    void loadPersonalization();
  }, [loadPersonalization]);

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
    if (!content || !newMemoryKind) {
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
    <>
      {error ? <Alert className="px-4 py-3">{error}</Alert> : null}

      {isLoading ? (
        <div className="py-10 text-sm text-foreground-muted">Loading personalization...</div>
      ) : (
        <>
          <ProfileForm
            writingStyle={writingStyle}
            tonePreference={tonePreference}
            isSaving={isSavingProfile}
            saveStatus={profileSaveStatus}
            onWritingStyleChange={setWritingStyle}
            onTonePreferenceChange={setTonePreference}
          />

          <section className="border-t border-border pt-6">
            <h2 className="text-base font-medium text-foreground">Memories</h2>

            <MemoryComposer
              kind={newMemoryKind}
              content={newMemoryContent}
              isCreating={isCreatingMemory}
              onKindChange={setNewMemoryKind}
              onContentChange={setNewMemoryContent}
              onCreate={() => void handleCreateMemory()}
            />

            <MemoryList
              groups={memoryGroups}
              editingMemoryId={editingMemoryId}
              editingMemoryContent={editingMemoryContent}
              pendingMemoryId={pendingMemoryId}
              onBeginEdit={beginEditingMemory}
              onCancelEdit={cancelEditingMemory}
              onEditingContentChange={setEditingMemoryContent}
              onSave={(memoryId) => void handleSaveMemory(memoryId)}
              onDelete={(memory) => void handleDeleteMemory(memory)}
            />
          </section>
        </>
      )}
    </>
  );
}
