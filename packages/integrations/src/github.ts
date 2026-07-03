const GITHUB_API_BASE = 'https://api.github.com';
const REPOSITORY_PAGE_SIZE = 100;

/**
 * Minimal HTTP client contract shared with `@aaa/observability`'s
 * `createHttpClient`. Callers inject their own instance so outbound GitHub
 * requests keep each package's distinct telemetry component/event labels.
 */
export interface GitHubHttpClient {
  requestJson<T>(input: string, init?: RequestInit): Promise<T>;
  requestText(input: string, init?: RequestInit): Promise<string>;
}

/** Canonical repository reference used across tool and knowledge layers. */
export interface GitHubRepository {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  defaultBranch: string;
  private: boolean;
}

export interface GitHubFileContent {
  content: string;
  sha?: string;
  size?: number;
}

interface GitHubRepositoryApiResponse {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  owner: { login: string };
}

interface GitHubContentApiResponse {
  content?: string;
  encoding?: string;
  sha?: string;
  size?: number;
}

export function buildGitHubHeaders(
  token: string,
  extra?: Record<string, string>,
): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'User-Agent': 'agentic-ai-assistant',
    'X-GitHub-Api-Version': '2022-11-28',
    ...extra,
  };
}

function encodeRepoPath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function toGitHubRepository(repo: GitHubRepositoryApiResponse): GitHubRepository {
  return {
    id: repo.id,
    name: repo.name,
    fullName: repo.full_name,
    owner: repo.owner.login,
    defaultBranch: repo.default_branch,
    private: repo.private,
  };
}

/**
 * Shared REST client for the GitHub API. Consolidates authentication headers,
 * repository listing pagination, and file-content retrieval that were
 * previously duplicated between the knowledge-source and tool-provider layers.
 */
export class GitHubApiClient {
  constructor(
    private readonly token: string,
    private readonly http: GitHubHttpClient,
  ) {}

  headers(extra?: Record<string, string>): Record<string, string> {
    return buildGitHubHeaders(this.token, extra);
  }

  async listRepositories(): Promise<GitHubRepository[]> {
    const repositories: GitHubRepository[] = [];
    let page = 1;

    while (true) {
      const params = new URLSearchParams({
        per_page: String(REPOSITORY_PAGE_SIZE),
        page: String(page),
        sort: 'updated',
      });
      const pageItems = await this.http.requestJson<GitHubRepositoryApiResponse[]>(
        `${GITHUB_API_BASE}/user/repos?${params.toString()}`,
        { headers: this.headers() },
      );
      if (pageItems.length === 0) {
        break;
      }

      repositories.push(...pageItems.map(toGitHubRepository));

      if (pageItems.length < REPOSITORY_PAGE_SIZE) {
        break;
      }
      page += 1;
    }

    return repositories;
  }

  async getFileContent(repo: string, path: string, ref?: string): Promise<GitHubFileContent> {
    const encodedPath = encodeRepoPath(path);
    const suffix = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    const url = `${GITHUB_API_BASE}/repos/${repo}/contents/${encodedPath}${suffix}`;

    const metadata = await this.http.requestJson<GitHubContentApiResponse>(url, {
      headers: this.headers(),
    });

    const content =
      metadata.encoding === 'base64' && metadata.content
        ? Buffer.from(metadata.content.replace(/\n/g, ''), 'base64').toString('utf8')
        : await this.http.requestText(url, {
            headers: this.headers({ Accept: 'application/vnd.github.raw+json' }),
          });

    return {
      content,
      sha: metadata.sha,
      size: metadata.size,
    };
  }
}
