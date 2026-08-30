import { GitHubApiClient, type GitHubRepository } from '@aaa/integrations';
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

export type { GitHubRepository };

/** @deprecated Use `GitHubRepository` from `@aaa/integrations`. */
export type GitHubRepositoryReference = GitHubRepository;

export class GitHubToolProvider {
  private readonly api: GitHubApiClient;

  constructor(token: string) {
    this.api = new GitHubApiClient(token, { requestJson, requestText });
  }

  async listRepositories(): Promise<GitHubRepository[]> {
    return this.api.listRepositories();
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
    const { content, sha } = await this.api.getFileContent(repo, path, ref);
    return { content, sha };
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
    return this.api.headers();
  }
}
