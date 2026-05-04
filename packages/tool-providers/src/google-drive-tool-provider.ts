import { refreshGoogleAccessToken } from '@aaa/observability';
import { requestJson, requestText } from './http.js';

export interface GoogleDriveToolCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
}

export interface GoogleDriveToolProviderOptions {
  credentials: GoogleDriveToolCredentials;
  onRefresh?: (credentials: GoogleDriveToolCredentials) => Promise<void>;
}

interface GoogleDriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  trashed?: boolean;
  modifiedTime?: string;
  webViewLink?: string;
}

export class GoogleDriveToolProvider {
  private credentials: GoogleDriveToolCredentials;
  private readonly onRefresh?: (credentials: GoogleDriveToolCredentials) => Promise<void>;

  constructor(options: GoogleDriveToolProviderOptions) {
    this.credentials = { ...options.credentials };
    this.onRefresh = options.onRefresh;
  }

  async searchFiles(query: string, pageSize = 20): Promise<unknown> {
    const params = new URLSearchParams({
      q: `trashed=false and name contains '${query.replace(/'/g, "\\'")}'`,
      pageSize: String(Math.min(Math.max(pageSize, 1), 100)),
      fields: 'files(id,name,mimeType,parents,trashed,modifiedTime,webViewLink)',
      spaces: 'drive',
    });
    return requestJson(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
      headers: await this.headers(),
    });
  }

  async getFileMetadata(fileId: string): Promise<GoogleDriveFile> {
    return requestJson<GoogleDriveFile>(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,parents,trashed,modifiedTime,webViewLink`,
      {
        headers: await this.headers(),
      },
    );
  }

  async readTextFile(fileId: string): Promise<{ metadata: GoogleDriveFile; content: string }> {
    const metadata = await this.getFileMetadata(fileId);
    const headers = await this.headers();
    const content =
      metadata.mimeType === 'application/vnd.google-apps.document'
        ? await requestText(
            `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=text/plain`,
            { headers },
          )
        : await requestText(
            `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
            { headers },
          );

    return { metadata, content };
  }

  async createTextFile(input: {
    name: string;
    content: string;
    mimeType?: string;
    parentFolderId?: string;
  }): Promise<unknown> {
    const boundary = `aaa-${Date.now()}`;
    const metadata = {
      name: input.name,
      mimeType: input.mimeType ?? 'text/plain',
      parents: input.parentFolderId ? [input.parentFolderId] : undefined,
    };

    return requestJson(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,parents,trashed,modifiedTime,webViewLink',
      {
        method: 'POST',
        headers: {
          ...(await this.headers()),
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: [
          `--${boundary}`,
          'Content-Type: application/json; charset=UTF-8',
          '',
          JSON.stringify(metadata),
          `--${boundary}`,
          `Content-Type: ${input.mimeType ?? 'text/plain'}`,
          '',
          input.content,
          `--${boundary}--`,
          '',
        ].join('\r\n'),
      },
    );
  }

  async updateTextFile(input: {
    fileId: string;
    content: string;
    name?: string;
  }): Promise<unknown> {
    const metadata = await this.getFileMetadata(input.fileId);
    const boundary = `aaa-${Date.now()}`;
    return requestJson(
      `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(input.fileId)}?uploadType=multipart&fields=id,name,mimeType,parents,trashed,modifiedTime,webViewLink`,
      {
        method: 'PATCH',
        headers: {
          ...(await this.headers()),
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: [
          `--${boundary}`,
          'Content-Type: application/json; charset=UTF-8',
          '',
          JSON.stringify({ name: input.name }),
          `--${boundary}`,
          `Content-Type: ${metadata.mimeType}`,
          '',
          input.content,
          `--${boundary}--`,
          '',
        ].join('\r\n'),
      },
    );
  }

  async renameFile(fileId: string, name: string): Promise<unknown> {
    return this.updateDriveMetadata(fileId, { name });
  }

  async moveFile(fileId: string, addParentId: string, removeParentId?: string): Promise<unknown> {
    const params = new URLSearchParams({
      addParents: addParentId,
      fields: 'id,name,mimeType,parents,trashed,modifiedTime,webViewLink',
    });
    if (removeParentId) {
      params.set('removeParents', removeParentId);
    }
    return requestJson(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${params.toString()}`,
      {
        method: 'PATCH',
        headers: {
          ...(await this.headers()),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      },
    );
  }

  async trashFile(fileId: string): Promise<unknown> {
    return this.updateDriveMetadata(fileId, { trashed: true });
  }

  async createDocument(title: string): Promise<unknown> {
    return requestJson('https://docs.googleapis.com/v1/documents', {
      method: 'POST',
      headers: {
        ...(await this.headers()),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title }),
    });
  }

  async getDocument(documentId: string): Promise<unknown> {
    return requestJson(
      `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}`,
      {
        headers: await this.headers(),
      },
    );
  }

  async batchUpdateDocument(documentId: string, requests: unknown[]): Promise<unknown> {
    return requestJson(
      `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          ...(await this.headers()),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ requests }),
      },
    );
  }

  private async updateDriveMetadata(
    fileId: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    return requestJson(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,parents,trashed,modifiedTime,webViewLink`,
      {
        method: 'PATCH',
        headers: {
          ...(await this.headers()),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );
  }

  private async headers(): Promise<Record<string, string>> {
    const token = await this.getAccessToken();
    return {
      Authorization: `Bearer ${token}`,
    };
  }

  private async getAccessToken(): Promise<string> {
    this.credentials = await refreshGoogleAccessToken(this.credentials, async (nextCredentials) => {
      this.credentials = nextCredentials;
      await this.onRefresh?.({ ...nextCredentials });
    });

    return this.credentials.accessToken;
  }
}
