'use client';

import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { extractTransferFiles, transferContainsFiles } from './transfer-files';

interface UseFileDropZoneOptions {
  onDropFiles: (files: File[]) => void;
}

export function useFileDropZone({ onDropFiles }: UseFileDropZoneOptions) {
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const dragDepthRef = useRef(0);
  const onDropFilesRef = useRef(onDropFiles);
  onDropFilesRef.current = onDropFiles;

  const resetDragging = useCallback(() => {
    dragDepthRef.current = 0;
    setIsDraggingFiles(false);
  }, []);

  const onDragEnter = useCallback((event: DragEvent<HTMLElement>) => {
    if (!transferContainsFiles(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDraggingFiles(true);
  }, []);

  const onDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    if (!transferContainsFiles(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    if (!transferContainsFiles(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDraggingFiles(false);
    }
  }, []);

  const onDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (!transferContainsFiles(event.dataTransfer)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      resetDragging();

      const files = extractTransferFiles(event.dataTransfer, 'dropped');
      if (files.length > 0) {
        onDropFilesRef.current(files);
      }
    },
    [resetDragging],
  );

  useEffect(() => {
    const preventBrowserFileNavigation = (event: globalThis.DragEvent) => {
      if (!transferContainsFiles(event.dataTransfer)) {
        return;
      }

      event.preventDefault();
    };

    window.addEventListener('dragover', preventBrowserFileNavigation);
    window.addEventListener('drop', preventBrowserFileNavigation);
    return () => {
      window.removeEventListener('dragover', preventBrowserFileNavigation);
      window.removeEventListener('drop', preventBrowserFileNavigation);
    };
  }, []);

  return {
    isDraggingFiles,
    dropProps: {
      onDragEnter,
      onDragOver,
      onDragLeave,
      onDrop,
    },
  };
}
