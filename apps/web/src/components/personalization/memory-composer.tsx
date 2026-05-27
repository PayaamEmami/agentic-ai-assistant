'use client';

import { PlusIcon } from '@/components/icons';
import { IconButton } from '@/components/ui/icon-button';
import { Textarea } from '@/components/ui/textarea';
import { type PersonalizationMemoryKind } from '@/lib/api-client';
import { MemoryKindSelector } from './memory-kind-selector';

interface MemoryComposerProps {
  kind: PersonalizationMemoryKind | null;
  content: string;
  isCreating: boolean;
  onKindChange: (kind: PersonalizationMemoryKind) => void;
  onContentChange: (content: string) => void;
  onCreate: () => void;
}

export function MemoryComposer({
  kind,
  content,
  isCreating,
  onKindChange,
  onContentChange,
  onCreate,
}: MemoryComposerProps) {
  return (
    <div className="mt-4 rounded-2xl border border-border bg-surface-elevated p-3 transition focus-within:border-accent">
      <label className="block">
        <span className="sr-only">New memory</span>
        <Textarea
          variant="transparent"
          value={content}
          onChange={(event) => onContentChange(event.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="Add something your assistant should remember..."
        />
      </label>
      <div className="mt-3 flex items-center justify-end gap-2">
        <MemoryKindSelector value={kind} onChange={onKindChange} />
        <IconButton
          onClick={onCreate}
          disabled={isCreating || !kind || !content.trim()}
          title={isCreating ? 'Adding memory' : 'Add memory'}
          aria-label={isCreating ? 'Adding memory' : 'Add memory'}
        >
          <PlusIcon />
        </IconButton>
      </div>
    </div>
  );
}
