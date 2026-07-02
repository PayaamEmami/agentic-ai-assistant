import { refreshGoogleAccessToken, type RefreshableGoogleCredentials } from './google-oauth.js';

/**
 * Holds Google OAuth credentials and transparently refreshes the access token
 * before building authorization headers. Consolidates the credential-state +
 * refresh + header-building pattern that was duplicated across the Drive tool
 * provider and the Google Docs knowledge source.
 */
export class GoogleCredentialSession<T extends RefreshableGoogleCredentials> {
  private credentials: T;
  private readonly onRefresh?: (credentials: T) => Promise<void>;

  constructor(credentials: T, onRefresh?: (credentials: T) => Promise<void>) {
    this.credentials = { ...credentials };
    this.onRefresh = onRefresh;
  }

  async getAccessToken(): Promise<string> {
    this.credentials = await refreshGoogleAccessToken(this.credentials, async (nextCredentials) => {
      this.credentials = nextCredentials;
      await this.onRefresh?.(nextCredentials);
    });
    return this.credentials.accessToken;
  }

  async authorizationHeaders(): Promise<Record<string, string>> {
    const token = await this.getAccessToken();
    return {
      Authorization: `Bearer ${token}`,
    };
  }
}
