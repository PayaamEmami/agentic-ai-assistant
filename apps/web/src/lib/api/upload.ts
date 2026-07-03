import { createCorrelationId } from '../client-observability';
import { API_BASE, ApiError, getAuthToken } from './client';

export const uploadApi = {
  async uploadFile(file: File, options?: { indexForRag?: boolean }) {
    const token = await getAuthToken();
    const formData = new FormData();
    formData.append('file', file);
    const url = new URL(`${API_BASE}/api/upload`);
    if (options?.indexForRag) {
      url.searchParams.set('indexForRag', 'true');
    }
    const res = await fetch(url, {
      method: 'POST',
      body: formData,
      headers: {
        Authorization: `Bearer ${token}`,
        'x-correlation-id': createCorrelationId('upload'),
      },
    });
    if (!res.ok) {
      throw new ApiError(
        res.status,
        'Upload failed',
        undefined,
        res.headers.get('x-request-id') ?? undefined,
        res.headers.get('x-correlation-id') ?? undefined,
      );
    }
    return res.json() as Promise<{
      attachmentId: string;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      kind: 'image' | 'document' | 'audio' | 'file';
      indexedForRag: boolean;
      documentId?: string | null;
    }>;
  },
};
