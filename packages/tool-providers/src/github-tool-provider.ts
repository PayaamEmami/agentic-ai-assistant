import { requestJson, requestText } from './http.js';

export interface GitHubPullRequestSummary {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: string;
  draft: boolean;
  head: {
    ref: string;
    sha: string;
  };
  base: {
    ref: string;
    sha: string;
  };
}

interface GitHubReviewCommentReplyResponse {
  id: number;
  html_url: string;
  body: string;
}

interface GitHubRepositoryListItem {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  owner: {
    login: string;
  };
}

export interface GitHubRepositoryReference {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  private: boolean;
  defaultBranch: string;
}

export class GitHubToolProvider {
  constructor(private readonly token: string) {}

  async listRepositories(): Promise<GitHubRepositoryReference[]> {
    const repositories: GitHubRepositoryReference[] = [];
    let page = 1;

    while (true) {
      const pageItems = await requestJson<GitHubRepositoryListItem[]>(
        `https://api.github.com/user/repos?per_page=100&page=${page}&sort=updated`,
        {
          headers: this.headers(),
        },
      );

      repositories.push(
        ...pageItems.map((repo) => ({
          id: repo.id,
          name: repo.name,
          fullName: repo.full_name,
          owner: repo.owner.login,
          private: repo.private,
          defaultBranch: repo.default_branch,
        })),
      );

      if (pageItems.length < 100) {
        return repositories;
      }

      page += 1;
    }
  }

  async getRepository(repo: string): Promise<unknown> {
    return requestJson(`https://api.github.com/repos/${repo}`, {
      headers: this.headers(),
    });
  }

  async getFile(
    repo: string,
    path: string,
    ref?: string,
  ): Promise<{ content: string; sha?: string }> {
    const encodedPath = path
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    const suffix = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    const metadata = await requestJson<{ content?: string; encoding?: string; sha?: string }>(
      `https://api.github.com/repos/${repo}/contents/${encodedPath}${suffix}`,
      {
        headers: this.headers(),
      },
    );

    const content =
      metadata.encoding === 'base64' && metadata.content
        ? Buffer.from(metadata.content.replace(/\n/g, ''), 'base64').toString('utf8')
        : await requestText(
            `https://api.github.com/repos/${repo}/contents/${encodedPath}${suffix}`,
            {
              headers: {
                ...this.headers(),
                Accept: 'application/vnd.github.raw+json',
              },
            },
          );

    return {
      content,
      sha: metadata.sha,
    };
  }

  async getBranch(repo: string, branch: string): Promise<unknown> {
    return requestJson(
      `https://api.github.com/repos/${repo}/branches/${encodeURIComponent(branch)}`,
      {
        headers: this.headers(),
      },
    );
  }

  async getPullRequest(repo: string, pullNumber: number): Promise<GitHubPullRequestSummary> {
    return requestJson<GitHubPullRequestSummary>(
      `https://api.github.com/repos/${repo}/pulls/${pullNumber}`,
      {
        headers: this.headers(),
      },
    );
  }

  async listPullRequestFiles(repo: string, pullNumber: number): Promise<unknown[]> {
    const files: unknown[] = [];
    let page = 1;

    while (true) {
      const pageItems = await requestJson<unknown[]>(
        `https://api.github.com/repos/${repo}/pulls/${pullNumber}/files?per_page=100&page=${page}`,
        {
          headers: this.headers(),
        },
      );
      files.push(...pageItems);

      if (pageItems.length < 100) {
        return files;
      }
      page += 1;
    }
  }

  async createPullRequest(input: {
    repo: string;
    title: string;
    body?: string;
    head: string;
    base: string;
    draft?: boolean;
  }): Promise<GitHubPullRequestSummary> {
    return requestJson<GitHubPullRequestSummary>(
      `https://api.github.com/repos/${input.repo}/pulls`,
      {
        method: 'POST',
        headers: {
          ...this.headers(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: input.title,
          body: input.body ?? '',
          head: input.head,
          base: input.base,
          draft: input.draft ?? false,
        }),
      },
    );
  }

  async updatePullRequest(input: {
    repo: string;
    pullNumber: number;
    title?: string;
    body?: string;
  }): Promise<GitHubPullRequestSummary> {
    return requestJson<GitHubPullRequestSummary>(
      `https://api.github.com/repos/${input.repo}/pulls/${input.pullNumber}`,
      {
        method: 'PATCH',
        headers: {
          ...this.headers(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: input.title,
          body: input.body,
        }),
      },
    );
  }

  async addPullRequestComment(input: {
    repo: string;
    pullNumber: number;
    body: string;
  }): Promise<unknown> {
    return requestJson(
      `https://api.github.com/repos/${input.repo}/issues/${input.pullNumber}/comments`,
      {
        method: 'POST',
        headers: {
          ...this.headers(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body: input.body }),
      },
    );
  }

  async replyToReviewComment(input: {
    repo: string;
    pullNumber: number;
    commentId: number;
    body: string;
  }): Promise<GitHubReviewCommentReplyResponse> {
    return requestJson<GitHubReviewCommentReplyResponse>(
      `https://api.github.com/repos/${input.repo}/pulls/${input.pullNumber}/comments/${input.commentId}/replies`,
      {
        method: 'POST',
        headers: {
          ...this.headers(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body: input.body }),
      },
    );
  }

  async submitPullRequestReview(input: {
    repo: string;
    pullNumber: number;
    event: 'APPROVE' | 'COMMENT' | 'REQUEST_CHANGES';
    body?: string;
  }): Promise<unknown> {
    return requestJson(
      `https://api.github.com/repos/${input.repo}/pulls/${input.pullNumber}/reviews`,
      {
        method: 'POST',
        headers: {
          ...this.headers(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          event: input.event,
          body: input.body ?? '',
        }),
      },
    );
  }

  private headers(): Record<string, string> {
    return {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${this.token}`,
      'User-Agent': 'agentic-ai-assistant',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }
}
