'use client';

import { type PersonalizationMemory, type PersonalizationMemoryKind } from '@/lib/api-client';
import { MEMORY_KIND_LABELS } from './model';
import { MemoryItem } from './memory-item';

interface MemoryGroup {
  kind: PersonalizationMemoryKind;
  memories: PersonalizationMemory[];
}

interface MemoryListProps {
  groups: MemoryGroup[];
  editingMemoryId: string | null;
  editingMemoryContent: string;
  pendingMemoryId: string | null;
  onBeginEdit: (memory: PersonalizationMemory) => void;
  onCancelEdit: () => void;
  onEditingContentChange: (content: string) => void;
  onSave: (memoryId: string) => void;
  onDelete: (memory: PersonalizationMemory) => void;
}

export function MemoryList({
  groups,
  editingMemoryId,
  editingMemoryContent,
  pendingMemoryId,
  onBeginEdit,
  onCancelEdit,
  onEditingContentChange,
  onSave,
  onDelete,
}: MemoryListProps) {
  if (groups.length === 0) {
    return null;
  }

  return (
    <div className="mt-6">
      <div className="space-y-6">
        {groups.map((group) => (
          <section key={group.kind} className="space-y-2">
            <h3 className="text-sm font-medium text-foreground-muted">
              {MEMORY_KIND_LABELS[group.kind]}
            </h3>
            <div className="space-y-1">
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
          </section>
        ))}
      </div>
    </div>
  );
}
