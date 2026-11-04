'use client';

import { EditIcon, TrashIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Textarea } from '@/components/ui/textarea';
import { type PersonalizationMemory } from '@/lib/api-client';

interface MemoryItemProps {
  memory: PersonalizationMemory;
  isEditing: boolean;
  isPending: boolean;
  editingContent: string;
  onBeginEdit: (memory: PersonalizationMemory) => void;
  onCancelEdit: () => void;
  onEditingContentChange: (content: string) => void;
  onSave: (memoryId: string) => void;
  onDelete: (memory: PersonalizationMemory) => void;
}

export function MemoryItem({
  memory,
  isEditing,
  isPending,
  editingContent,
  onBeginEdit,
  onCancelEdit,
  onEditingContentChange,
  onSave,
  onDelete,
}: MemoryItemProps) {
  return (
    <div className="rounded-xl border border-border bg-surface-elevated px-3 py-2.5">
      {isEditing ? (
        <div className="space-y-3">
          <Textarea
            value={editingContent}
            onChange={(event) => onEditingContentChange(event.target.value)}
            rows={3}
            maxLength={2000}
            disabled={isPending}
            autoFocus
            className="w-full"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                onCancelEdit();
              }
            }}
          />
          <div className="flex items-center justify-end gap-2">
            <Button
              size="sm"
              onClick={() => onSave(memory.id)}
              disabled={isPending || !editingContent.trim()}
            >
              {isPending ? 'Saving...' : 'Save'}
            </Button>
            <Button variant="secondary" size="sm" onClick={onCancelEdit} disabled={isPending}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 flex-1 text-sm leading-6 text-foreground">{memory.content}</p>
          <div className="flex shrink-0 items-center gap-1">
            <IconButton
              size="sm"
              onClick={() => onBeginEdit(memory)}
              disabled={isPending}
              title="Edit memory"
              aria-label="Edit memory"
            >
              <EditIcon />
            </IconButton>
            <IconButton
              size="sm"
              variant="danger"
              onClick={() => onDelete(memory)}
              disabled={isPending}
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
}
