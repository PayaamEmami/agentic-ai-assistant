import type {
  KnowledgeSource,
  KnowledgeSourceAuth,
  KnowledgeSourceItem,
  KnowledgeSyncResult,
} from './types.js';
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
  '.bib',
  '.bst',
  '.c',
  '.cc',
  '.cls',
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
  '.sty',
  '.tex',
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

interface GitHubCursorRepoState {
  sha: string;
  name?: string;
  fullName?: string;
  owner?: string;
  defaultBranch?: string;
  private?: boolean;
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

function toCursorRepoState(repo: GitHubRepoSelection, sha: string): GitHubCursorRepoState {
  return {
    sha,
    name: repo.name,
    fullName: repo.fullName,
    owner: repo.owner,
    defaultBranch: repo.defaultBranch,
    private: repo.private,
  };
}

export class GitHubKnowledgeSource implements KnowledgeSource {
  kind = 'github' as const;
  private token = '';
  private selectedRepos: GitHubRepoSelection[] = [];

  async initialize(auth: KnowledgeSourceAuth): Promise<void> {
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

  async list(
    _cursor?: string,
    limit = 200,
  ): Promise<{ items: KnowledgeSourceItem[]; nextCursor: string | null }> {
    const items: KnowledgeSourceItem[] = [];
    for (const repo of this.selectedRepos) {
      const tree = await this.loadRepositoryTree(repo);
      for (const entry of tree) {
        if (entry.type !== 'blob' || !shouldIncludeGitHubPath(entry.path, entry.size)) {
          continue;
        }

        items.push(this.toKnowledgeSourceItem(repo, entry));
        if (items.length >= limit) {
          return { items, nextCursor: null };
        }
      }
    }

    return { items, nextCursor: null };
  }

  async read(externalId: string): Promise<KnowledgeSourceItem | null> {
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

  async search(query: string, limit = 20): Promise<KnowledgeSourceItem[]> {
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

  async sync(cursor?: string): Promise<KnowledgeSyncResult> {
    const previousCursor = this.parseCursor(cursor);
    const nextCursor: Record<string, GitHubCursorRepoState> = {};
    const items: KnowledgeSourceItem[] = [];
    const errors: Array<{ externalId: string; error: string }> = [];
    const selectedRepoIds = new Set(this.selectedRepos.map((repo) => String(repo.id)));

    for (const repo of this.selectedRepos) {
      try {
        const branchSha = await this.loadBranchSha(repo);
        nextCursor[String(repo.id)] = toCursorRepoState(repo, branchSha);

        const previousRepoState = previousCursor[String(repo.id)];
        if (previousRepoState?.sha === branchSha) {
          continue;
        }

        const currentEntries = this.getIndexableEntries(await this.loadRepositoryTree(repo, branchSha));
        if (previousRepoState?.sha) {
          try {
            const previousEntries = this.getIndexableEntries(
              await this.loadRepositoryTree(repo, previousRepoState.sha),
            );
            const currentPaths = new Set(currentEntries.map((entry) => entry.path));
            for (const entry of previousEntries) {
              if (!currentPaths.has(entry.path)) {
                items.push(this.toDeletedKnowledgeSourceItem(repo, entry.path));
              }
            }
          } catch {
            // Fall back to reindexing current files when the previous tree is unavailable.
          }
        }

        for (const entry of currentEntries) {
          items.push(this.toKnowledgeSourceItem(repo, entry));
        }
      } catch (error) {
        errors.push({
          externalId: repo.fullName,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    for (const [repoId, previousRepoState] of Object.entries(previousCursor)) {
      if (selectedRepoIds.has(repoId)) {
        continue;
      }

      const deselectedRepo = this.toRepoSelectionFromCursor(repoId, previousRepoState);
      if (!deselectedRepo) {
        continue;
      }

      try {
        const previousEntries = this.getIndexableEntries(
          await this.loadRepositoryTree(deselectedRepo, previousRepoState.sha),
        );
        for (const entry of previousEntries) {
          items.push(this.toDeletedKnowledgeSourceItem(deselectedRepo, entry.path));
        }
      } catch (error) {
        errors.push({
          externalId: previousRepoState.fullName ?? repoId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      items,
      itemsSynced: items.length,
      errors,
      nextCursor: JSON.stringify({ version: 2, repos: nextCursor }),
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

  private async loadBranchSha(repo: GitHubRepoSelection): Promise<string> {
    const branchInfo = await requestJson<{ commit: { sha: string } }>(
      `https://api.github.com/repos/${repo.fullName}/branches/${encodeURIComponent(repo.defaultBranch)}`,
      {
        headers: this.buildHeaders(),
      },
    );
    return branchInfo.commit.sha;
  }

  private getIndexableEntries(tree: GitHubTreeEntry[]): GitHubTreeEntry[] {
    return tree.filter(
      (entry) => entry.type === 'blob' && shouldIncludeGitHubPath(entry.path, entry.size),
    );
  }

  private parseCursor(cursor: string | undefined): Record<string, GitHubCursorRepoState> {
    if (!cursor) {
      return {};
    }

    try {
      const parsed = JSON.parse(cursor) as unknown;
      if (!parsed || typeof parsed !== 'object') {
        return {};
      }

      const rawRepos =
        'version' in parsed && 'repos' in parsed && parsed.repos && typeof parsed.repos === 'object'
          ? parsed.repos
          : parsed;

      return Object.fromEntries(
        Object.entries(rawRepos as Record<string, unknown>)
          .map(([repoId, value]) => {
            if (typeof value === 'string') {
              return [repoId, { sha: value } satisfies GitHubCursorRepoState];
            }

            if (!value || typeof value !== 'object') {
              return null;
            }

            const candidate = value as Record<string, unknown>;
            const sha = asString(candidate.sha);
            if (!sha) {
              return null;
            }

            return [
              repoId,
              {
                sha,
                name: asString(candidate.name),
                fullName: asString(candidate.fullName),
                owner: asString(candidate.owner),
                defaultBranch: asString(candidate.defaultBranch),
                private: typeof candidate.private === 'boolean' ? candidate.private : undefined,
              } satisfies GitHubCursorRepoState,
            ];
          })
          .filter((entry): entry is [string, GitHubCursorRepoState] => entry !== null),
      );
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

  private toKnowledgeSourceItem(
    repo: GitHubRepoSelection,
    entry: GitHubTreeEntry,
  ): KnowledgeSourceItem {
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

  private toDeletedKnowledgeSourceItem(
    repo: GitHubRepoSelection,
    path: string,
  ): KnowledgeSourceItem {
    return {
      externalId: `${repo.fullName}:${path}`,
      sourceKind: 'code_repository',
      title: path,
      content: null,
      mimeType: 'text/plain',
      uri: repo.defaultBranch
        ? `https://github.com/${repo.fullName}/blob/${repo.defaultBranch}/${path}`
        : `https://github.com/${repo.fullName}`,
      updatedAt: null,
      metadata: {
        owner: repo.owner,
        repo: repo.name,
        fullName: repo.fullName,
        branch: repo.defaultBranch,
        path,
        deleted: true,
      },
    };
  }

  private toRepoSelectionFromCursor(
    repoId: string,
    state: GitHubCursorRepoState,
  ): GitHubRepoSelection | null {
    const fullName = state.fullName;
    if (!fullName) {
      return null;
    }

    const [ownerFromFullName, nameFromFullName] = fullName.split('/', 2);
    if (!ownerFromFullName || !nameFromFullName) {
      return null;
    }

    return {
      id: Number(repoId),
      name: state.name ?? nameFromFullName,
      fullName,
      owner: state.owner ?? ownerFromFullName,
      defaultBranch: state.defaultBranch ?? 'HEAD',
      private: state.private ?? false,
    };
  }
}
