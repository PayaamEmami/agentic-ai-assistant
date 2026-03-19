import type { Connector, ConnectorAuth, ConnectorItem, SyncResult } from './types.js';
import { requestJson, requestText } from './http.js';

const MAX_FILE_BYTES = 1024 * 1024;
const SKIPPED_DIR_SEGMENTS = new Set([
  '.git',
  '.next',
  '.turbo',
  '.venv',
  '__pycache__',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'target',
  'vendor',
]);
const SKIPPED_FILE_NAMES = new Set([
  'cargo.lock',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);
const TEXT_EXTENSIONS = new Set([
  '.c',
  '.cc',
  '.cpp',
  '.cs',
  '.css',
  '.go',
  '.h',
  '.hpp',
  '.html',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.m',
  '.md',
  '.php',
  '.py',
  '.rb',
  '.rs',
  '.sh',
  '.sql',
  '.svg',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]);
const BINARY_EXTENSIONS = new Set([
  '.7z',
  '.avi',
  '.bin',
  '.bmp',
  '.class',
  '.dll',
  '.doc',
  '.docx',
  '.exe',
  '.gif',
  '.gz',
  '.ico',
  '.jar',
  '.jpeg',
  '.jpg',
  '.lockb',
  '.mov',
  '.mp3',
  '.mp4',
  '.pdf',
  '.png',
  '.tar',
  '.tgz',
  '.wav',
  '.webm',
  '.webp',
  '.zip',
]);

interface GitHubRepoSelection {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  defaultBranch: string;
  private: boolean;
}

interface GitHubTreeEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  size?: number;
  url: string;
}

interface GitHubRepoApiResponse {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  owner: { login: string };
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function getFileExtension(path: string): string {
  const index = path.lastIndexOf('.');
  return index >= 0 ? path.slice(index).toLowerCase() : '';
}

function shouldIncludeGitHubPath(path: string, size: number | undefined): boolean {
  if (!path || (typeof size === 'number' && size > MAX_FILE_BYTES)) {
    return false;
  }

  const segments = path.split('/').map((segment) => segment.toLowerCase());
  if (segments.some((segment) => SKIPPED_DIR_SEGMENTS.has(segment))) {
    return false;
  }

  const fileName = segments.at(-1) ?? '';
  if (SKIPPED_FILE_NAMES.has(fileName)) {
    return false;
  }

  const extension = getFileExtension(fileName);
  if (BINARY_EXTENSIONS.has(extension)) {
    return false;
  }

  if (TEXT_EXTENSIONS.has(extension)) {
    return true;
  }

  return extension === '' && !fileName.includes('.');
}

export class GitHubConnector implements Connector {
  kind = 'github' as const;
  private token = '';
  private selectedRepos: GitHubRepoSelection[] = [];

  async initialize(auth: ConnectorAuth): Promise<void> {
    const accessToken = asString(auth.credentials.accessToken);
    if (!accessToken) {
      throw new Error('GitHub access token is required');
    }

    this.token = accessToken;
    const selectedRepos = Array.isArray(auth.settings?.selectedRepos)
      ? auth.settings.selectedRepos
      : [];
    this.selectedRepos = selectedRepos
      .map((repo) => {
        if (!repo || typeof repo !== 'object') {
          return null;
        }

        const candidate = repo as Record<string, unknown>;
        const id = asNumber(candidate.id);
        const name = asString(candidate.name);
        const fullName = asString(candidate.fullName);
        const owner = asString(candidate.owner);
        const defaultBranch = asString(candidate.defaultBranch);
        const isPrivate = typeof candidate.private === 'boolean' ? candidate.private : false;

        if (
          id === undefined ||
          !name ||
          !fullName ||
          !owner ||
          !defaultBranch
        ) {
          return null;
        }

        return {
          id,
          name,
          fullName,
          owner,
          defaultBranch,
          private: isPrivate,
        } satisfies GitHubRepoSelection;
      })
      .filter((repo): repo is GitHubRepoSelection => repo !== null);
  }

  async list(_cursor?: string, limit = 200): Promise<{ items: ConnectorItem[]; nextCursor: string | null }> {
    const items: ConnectorItem[] = [];
    for (const repo of this.selectedRepos) {
      const tree = await this.loadRepositoryTree(repo);
      for (const entry of tree) {
        if (entry.type !== 'blob' || !shouldIncludeGitHubPath(entry.path, entry.size)) {
          continue;
        }

        items.push(this.toConnectorItem(repo, entry));
        if (items.length >= limit) {
          return { items, nextCursor: null };
        }
      }
    }

    return { items, nextCursor: null };
  }

  async read(externalId: string): Promise<ConnectorItem | null> {
    const parsed = this.parseExternalId(externalId);
    if (!parsed) {
      return null;
    }

    const repo = this.selectedRepos.find((item) => item.fullName === parsed.fullName);
    if (!repo) {
      return null;
    }

    const encodedPath = parsed.path
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    const contentResponse = await requestJson<{
      content?: string;
      encoding?: string;
      sha?: string;
      size?: number;
    }>(
      `https://api.github.com/repos/${repo.fullName}/contents/${encodedPath}?ref=${encodeURIComponent(repo.defaultBranch)}`,
      {
        headers: this.buildHeaders(),
      },
    );
    const content =
      contentResponse.encoding === 'base64' && contentResponse.content
        ? Buffer.from(contentResponse.content.replace(/\n/g, ''), 'base64').toString('utf8')
        : await requestText(
            `https://api.github.com/repos/${repo.fullName}/contents/${encodedPath}?ref=${encodeURIComponent(repo.defaultBranch)}`,
            {
              headers: {
                ...this.buildHeaders(),
                Accept: 'application/vnd.github.raw+json',
              },
            },
          );

    return {
      externalId,
      sourceKind: 'code_repository',
      title: parsed.path,
      content,
      mimeType: 'text/plain',
      uri: `https://github.com/${repo.fullName}/blob/${repo.defaultBranch}/${parsed.path}`,
      updatedAt: null,
      metadata: {
        owner: repo.owner,
        repo: repo.name,
        fullName: repo.fullName,
        branch: repo.defaultBranch,
        path: parsed.path,
        blobSha: contentResponse.sha,
        size: contentResponse.size ?? null,
      },
    };
  }

  async search(query: string, limit = 20): Promise<ConnectorItem[]> {
    const trimmed = query.trim();
    if (!trimmed || this.selectedRepos.length === 0) {
      return [];
    }

    const repoClauses = this.selectedRepos.map((repo) => `repo:${repo.fullName}`).join(' ');
    const params = new URLSearchParams({
      q: `${trimmed} ${repoClauses}`,
      per_page: String(Math.min(limit, 100)),
    });
    const response = await requestJson<{ items: Array<{ name: string; path: string; sha: string; repository: GitHubRepoApiResponse }> }>(
      `https://api.github.com/search/code?${params.toString()}`,
      {
        headers: this.buildHeaders(),
      },
    );

    return response.items.map((item) => ({
      externalId: `${item.repository.full_name}:${item.path}`,
      sourceKind: 'code_repository',
      title: item.path,
      content: null,
      mimeType: 'text/plain',
      uri: `https://github.com/${item.repository.full_name}/blob/${item.repository.default_branch}/${item.path}`,
      updatedAt: null,
      metadata: {
        owner: item.repository.owner.login,
        repo: item.repository.name,
        fullName: item.repository.full_name,
        branch: item.repository.default_branch,
        path: item.path,
        blobSha: item.sha,
      },
    }));
  }

  async sync(cursor?: string): Promise<SyncResult> {
    const previousCursor = this.parseCursor(cursor);
    const nextCursor: Record<string, string> = {};
    const items: ConnectorItem[] = [];
    const errors: Array<{ externalId: string; error: string }> = [];

    for (const repo of this.selectedRepos) {
      try {
        const branchInfo = await requestJson<{ commit: { sha: string } }>(
          `https://api.github.com/repos/${repo.fullName}/branches/${encodeURIComponent(repo.defaultBranch)}`,
          {
            headers: this.buildHeaders(),
          },
        );
        const branchSha = branchInfo.commit.sha;
        nextCursor[String(repo.id)] = branchSha;

        if (previousCursor[String(repo.id)] === branchSha) {
          continue;
        }

        const tree = await this.loadRepositoryTree(repo, branchSha);
        for (const entry of tree) {
          if (entry.type !== 'blob' || !shouldIncludeGitHubPath(entry.path, entry.size)) {
            continue;
          }
          items.push(this.toConnectorItem(repo, entry));
        }
      } catch (error) {
        errors.push({
          externalId: repo.fullName,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      items,
      itemsSynced: items.length,
      errors,
      nextCursor: JSON.stringify(nextCursor),
    };
  }

  async listRepositories(): Promise<GitHubRepoSelection[]> {
    const repositories: GitHubRepoSelection[] = [];
    let page = 1;

    while (true) {
      const params = new URLSearchParams({
        per_page: '100',
        page: String(page),
        sort: 'updated',
      });
      const pageItems = await requestJson<GitHubRepoApiResponse[]>(
        `https://api.github.com/user/repos?${params.toString()}`,
        {
          headers: this.buildHeaders(),
        },
      );
      if (pageItems.length === 0) {
        break;
      }

      repositories.push(
        ...pageItems.map((repo) => ({
          id: repo.id,
          name: repo.name,
          fullName: repo.full_name,
          owner: repo.owner.login,
          defaultBranch: repo.default_branch,
          private: repo.private,
        })),
      );

      if (pageItems.length < 100) {
        break;
      }
      page += 1;
    }

    return repositories;
  }

  private buildHeaders(): Record<string, string> {
    return {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${this.token}`,
      'User-Agent': 'agentic-ai-assistant',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  private async loadRepositoryTree(
    repo: GitHubRepoSelection,
    branchSha?: string,
  ): Promise<GitHubTreeEntry[]> {
    const ref = branchSha ?? repo.defaultBranch;
    const response = await requestJson<{ tree: GitHubTreeEntry[] }>(
      `https://api.github.com/repos/${repo.fullName}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
      {
        headers: this.buildHeaders(),
      },
    );
    return response.tree ?? [];
  }

  private parseCursor(cursor: string | undefined): Record<string, string> {
    if (!cursor) {
      return {};
    }

    try {
      const parsed = JSON.parse(cursor) as Record<string, string>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private parseExternalId(externalId: string): { fullName: string; path: string } | null {
    const delimiterIndex = externalId.indexOf(':');
    if (delimiterIndex <= 0) {
      return null;
    }

    return {
      fullName: externalId.slice(0, delimiterIndex),
      path: externalId.slice(delimiterIndex + 1),
    };
  }

  private toConnectorItem(repo: GitHubRepoSelection, entry: GitHubTreeEntry): ConnectorItem {
    return {
      externalId: `${repo.fullName}:${entry.path}`,
      sourceKind: 'code_repository',
      title: entry.path,
      content: null,
      mimeType: 'text/plain',
      uri: `https://github.com/${repo.fullName}/blob/${repo.defaultBranch}/${entry.path}`,
      updatedAt: null,
      metadata: {
        owner: repo.owner,
        repo: repo.name,
        fullName: repo.fullName,
        branch: repo.defaultBranch,
        path: entry.path,
        blobSha: entry.sha,
        size: entry.size ?? null,
      },
    };
  }
}
