'use client';

import { PlusIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { type PersonalizationMemory, type PersonalizationMemoryKind } from '@/lib/api-client';
import { MemoryItem } from './memory-item';
import {
  MEMORY_KIND_LABELS,
  MEMORY_KIND_PLACEHOLDERS,
  MEMORY_KIND_SINGULAR_LABELS,
} from './model';

interface MemoryGroup {
  kind: PersonalizationMemoryKind;
  memories: PersonalizationMemory[];
}

interface MemoryListProps {
  groups: MemoryGroup[];
  draftKind: PersonalizationMemoryKind | null;
  draftContent: string;
  isCreating: boolean;
  editingMemoryId: string | null;
  editingMemoryContent: string;
  pendingMemoryId: string | null;
  onBeginDraft: (kind: PersonalizationMemoryKind) => void;
  onDraftContentChange: (content: string) => void;
  onCancelDraft: () => void;
  onCreate: () => void;
  onBeginEdit: (memory: PersonalizationMemory) => void;
  onCancelEdit: () => void;
  onEditingContentChange: (content: string) => void;
  onSave: (memoryId: string) => void;
  onDelete: (memory: PersonalizationMemory) => void;
}

export function MemoryList({
  groups,
  draftKind,
  draftContent,
  isCreating,
  editingMemoryId,
  editingMemoryContent,
  pendingMemoryId,
  onBeginDraft,
  onDraftContentChange,
  onCancelDraft,
  onCreate,
  onBeginEdit,
  onCancelEdit,
  onEditingContentChange,
  onSave,
  onDelete,
}: MemoryListProps) {
  return (
    <div className="space-y-6">
      {groups.map((group) => {
        const singular = MEMORY_KIND_SINGULAR_LABELS[group.kind];
        const isDrafting = draftKind === group.kind;

        return (
          <section key={group.kind} className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium text-foreground">{MEMORY_KIND_LABELS[group.kind]}</h3>
              <IconButton
                onClick={() => onBeginDraft(group.kind)}
                disabled={isCreating}
                title={`Add ${singular}`}
                aria-label={`Add ${singular}`}
              >
                <PlusIcon width={18} height={18} />
              </IconButton>
            </div>

            {isDrafting ? (
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id={`memory-draft-${group.kind}`}
                  autoFocus
                  value={draftContent}
                  maxLength={2000}
                  disabled={isCreating}
                  placeholder={MEMORY_KIND_PLACEHOLDERS[group.kind]}
                  className="min-w-0 flex-1 basis-64"
                  onChange={(event) => onDraftContentChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      onCreate();
                    }
                    if (event.key === 'Escape') {
                      onCancelDraft();
                    }
                  }}
                />
                <Button size="sm" onClick={onCreate} disabled={isCreating || !draftContent.trim()}>
                  {isCreating ? 'Adding...' : 'Add'}
                </Button>
                <Button size="sm" variant="secondary" onClick={onCancelDraft} disabled={isCreating}>
                  Cancel
                </Button>
              </div>
            ) : null}

            {group.memories.length > 0 ? (
              <div className="space-y-2">
                {group.memories.map((memory) => (
                  <MemoryItem
                    key={memory.id}
                    memory={memory}
                    isEditing={editingMemoryId === memory.id}
                    isPending={pendingMemoryId === memory.id}
                    editingContent={editingMemoryContent}
                    onBeginEdit={onBeginEdit}
                    onCancelEdit={onCancelEdit}
                    onEditingContentChange={onEditingContentChange}
                    onSave={onSave}
                    onDelete={onDelete}
                  />
                ))}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
