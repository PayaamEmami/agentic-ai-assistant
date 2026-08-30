'use client';

import { useRef } from 'react';
import { AttachmentIcon } from '@/components/icons';
import { useFileDropZone } from '@/lib/chat/use-file-drop';
import { InputBar, type InputBarHandle } from './input-bar';
import { MessageList } from './message-list';

export function ChatWorkspace() {
  const inputBarRef = useRef<InputBarHandle>(null);
  const fileDrop = useFileDropZone({
    onDropFiles: (files) => {
      void inputBarRef.current?.addFiles(files);
    },
  });

  return (
    <div
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface-elevated"
      {...fileDrop.dropProps}
    >
      <p className="sr-only" aria-live="polite">
        {fileDrop.isDraggingFiles ? 'Drop files to attach them to your message.' : ''}
      </p>
      {fileDrop.isDraggingFiles ? <FileDropOverlay /> : null}
      <MessageList />
      <InputBar ref={inputBarRef} />
    </div>
  );
}

function FileDropOverlay() {
  return (
    <div
      className="pointer-events-none absolute inset-3 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent bg-surface-elevated/85"
      aria-hidden="true"
    >
      <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-surface px-6 py-4 text-foreground shadow-lg">
        <AttachmentIcon className="text-accent" width={28} height={28} />
        <p className="text-sm font-medium">Drop files to attach</p>
      </div>
    </div>
  );
}
