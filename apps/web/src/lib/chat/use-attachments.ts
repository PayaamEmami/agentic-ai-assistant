'use client';

import { useCallback, useState } from 'react';
import { api, requestErrorMessage } from '../api-client';
import type { UploadedAttachment } from './model/index';

interface UseChatAttachmentsOptions {
  setError: (message: string | null) => void;
}

export function useChatAttachments({ setError }: UseChatAttachmentsOptions) {
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);

  const uploadAttachment = useCallback(async (file: File, options?: { indexForRag?: boolean }) => {
    setError(null);
    setIsUploadingAttachment(true);
    try {
      const response = await api.upload.uploadFile(file, options);
      return {
        id: response.attachmentId,
        name: response.fileName,
        mimeType: response.mimeType,
        kind: response.kind,
        indexedForRag: response.indexedForRag,
        documentId: response.documentId,
      } satisfies UploadedAttachment;
    } catch (requestError) {
      const message = requestErrorMessage(requestError, 'Failed to upload attachment');
      if (message) {
        setError(message);
      }
      throw requestError;
    } finally {
      setIsUploadingAttachment(false);
    }
  }, [setError]);

  return {
    isUploadingAttachment,
    uploadAttachment,
  };
}
