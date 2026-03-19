import type { Connector, ConnectorAuth, ConnectorItem, SyncResult } from './types.js';
import { requestJson, requestText } from './http.js';

interface GoogleDocsCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
}

interface GoogleFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  webViewLink?: string;
  trashed?: boolean;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export class GoogleDocsConnector implements Connector {
  kind = 'google_docs' as const;
  private credentials: GoogleDocsCredentials | null = null;

  async initialize(auth: ConnectorAuth): Promise<void> {
    const accessToken = asString(auth.credentials.accessToken);
    if (!accessToken) {
      throw new Error('Google access token is required');
    }

    this.credentials = {
      accessToken,
      refreshToken: asString(auth.credentials.refreshToken),
      expiresAt: asString(auth.credentials.expiresAt),
    };
  }

  async list(cursor?: string, limit = 100): Promise<{ items: ConnectorItem[]; nextCursor: string | null }> {
    const files = await this.listGoogleDocs(limit, cursor);
    return {
      items: files.map((file) => this.toConnectorItem(file)),
      nextCursor: files.length === limit ? files.at(-1)?.id ?? null : null,
    };
  }

  async read(externalId: string): Promise<ConnectorItem | null> {
    const headers = await this.buildHeaders();
    const file = await requestJson<GoogleFile>(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(externalId)}?fields=id,name,mimeType,modifiedTime,webViewLink,trashed`,
      {
        headers,
      },
    );

    if (file.mimeType !== 'application/vnd.google-apps.document' || file.trashed) {
      return null;
    }

    const content = await requestText(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(externalId)}/export?mimeType=text/plain`,
      {
        headers,
      },
    );

    return {
      ...this.toConnectorItem(file),
      content,
    };
  }

  async search(query: string, limit = 20): Promise<ConnectorItem[]> {
    const trimmed = query.trim();
    if (!trimmed) {
      return [];
    }

    const params = new URLSearchParams({
      q: `mimeType='application/vnd.google-apps.document' and trashed=false and fullText contains '${trimmed.replace(/'/g, "\\'")}'`,
      pageSize: String(Math.min(limit, 100)),
      fields: 'files(id,name,mimeType,modifiedTime,webViewLink,trashed)',
    });
    const response = await requestJson<{ files?: GoogleFile[] }>(
      `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
      {
        headers: await this.buildHeaders(),
      },
    );

    return (response.files ?? []).map((file) => this.toConnectorItem(file));
  }

  async sync(cursor?: string): Promise<SyncResult> {
    const headers = await this.buildHeaders();
    const errors: Array<{ externalId: string; error: string }> = [];

    if (!cursor) {
      const files = await this.listGoogleDocs(1000);
      const startPageToken = await requestJson<{ startPageToken: string }>(
        'https://www.googleapis.com/drive/v3/changes/startPageToken',
        { headers },
      );

      return {
        items: files.map((file) => this.toConnectorItem(file)),
        itemsSynced: files.length,
        errors,
        nextCursor: startPageToken.startPageToken,
      };
    }

    const params = new URLSearchParams({
      pageToken: cursor,
      pageSize: '1000',
      includeRemoved: 'true',
      fields:
        'changes(fileId,removed,file(id,name,mimeType,modifiedTime,webViewLink,trashed)),nextPageToken,newStartPageToken',
    });
    const response = await requestJson<{
      changes?: Array<{ fileId: string; removed?: boolean; file?: GoogleFile }>;
      nextPageToken?: string;
      newStartPageToken?: string;
    }>(
      `https://www.googleapis.com/drive/v3/changes?${params.toString()}`,
      {
        headers,
      },
    );

    const items: ConnectorItem[] = [];
    for (const change of response.changes ?? []) {
      if (change.removed || change.file?.trashed) {
        items.push({
          externalId: change.fileId,
          sourceKind: 'document',
          title: change.file?.name ?? 'Deleted Google Doc',
          content: null,
          mimeType: 'application/vnd.google-apps.document',
          uri: change.file?.webViewLink ?? null,
          updatedAt: change.file?.modifiedTime ? new Date(change.file.modifiedTime) : null,
          metadata: { deleted: true },
        });
        continue;
      }

      if (!change.file || change.file.mimeType !== 'application/vnd.google-apps.document') {
        continue;
      }

      items.push(this.toConnectorItem(change.file));
    }

    return {
      items,
      itemsSynced: items.length,
      errors,
      nextCursor: response.newStartPageToken ?? response.nextPageToken ?? cursor,
    };
  }

  private async buildHeaders(): Promise<Record<string, string>> {
    const token = await this.getAccessToken();
    return {
      Authorization: `Bearer ${token}`,
    };
  }

  private async getAccessToken(): Promise<string> {
    if (!this.credentials) {
      throw new Error('Google Docs connector is not initialized');
    }

    if (!this.credentials.expiresAt || Date.parse(this.credentials.expiresAt) - Date.now() > 60_000) {
      return this.credentials.accessToken;
    }

    if (!this.credentials.refreshToken) {
      return this.credentials.accessToken;
    }

    const clientId = process.env['GOOGLE_CLIENT_ID'];
    const clientSecret = process.env['GOOGLE_CLIENT_SECRET'];
    if (!clientId || !clientSecret) {
      return this.credentials.accessToken;
    }

    const response = await requestJson<{
      access_token: string;
      expires_in: number;
      refresh_token?: string;
    }>('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: this.credentials.refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    this.credentials.accessToken = response.access_token;
    this.credentials.expiresAt = new Date(Date.now() + response.expires_in * 1000).toISOString();
    if (response.refresh_token) {
      this.credentials.refreshToken = response.refresh_token;
    }

    return this.credentials.accessToken;
  }

  private async listGoogleDocs(limit: number, pageToken?: string): Promise<GoogleFile[]> {
    const params = new URLSearchParams({
      q: "mimeType='application/vnd.google-apps.document' and trashed=false",
      orderBy: 'modifiedTime desc',
      pageSize: String(Math.min(limit, 1000)),
      fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink,trashed)',
    });
    if (pageToken) {
      params.set('pageToken', pageToken);
    }

    const response = await requestJson<{ files?: GoogleFile[] }>(
      `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
      {
        headers: await this.buildHeaders(),
      },
    );

    return response.files ?? [];
  }

  private toConnectorItem(file: GoogleFile): ConnectorItem {
    return {
      externalId: file.id,
      sourceKind: 'document',
      title: file.name,
      content: null,
      mimeType: 'application/vnd.google-apps.document',
      uri: file.webViewLink ?? null,
      updatedAt: file.modifiedTime ? new Date(file.modifiedTime) : null,
      metadata: {},
    };
  }
}
