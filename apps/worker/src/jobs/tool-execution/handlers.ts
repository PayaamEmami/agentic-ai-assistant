import { loadWorkerConfig } from '@aaa/config';
import { isMcpToolName, toRemoteMcpToolName, unwrapMcpToolData } from '@aaa/mcp';
import { CodingAgentError, createCodingAgent, GitHubToolProvider } from '@aaa/tool-providers';
import { acceptCodingTask } from './coding-task.js';
import {
  resolveGitHubRepo,
  resolveGitHubToken,
  withGitHubProvider,
  withGoogleProvider,
  withMcpClient,
} from './providers.js';
import type { ToolExecutionResult, ToolHandler } from './types.js';
import {
  asNumber,
  asString,
  requireNumber,
  requireReviewEvent,
  requireString,
  toNumberArray,
} from './validation.js';

const nativeToolHandlers: Record<string, ToolHandler> = {
  echo: ({ input }) => ({
    success: true,
    result: { echo: input['text'] ?? input['message'] ?? null },
  }),
  sum: ({ input }) => {
    const numbers = toNumberArray(input['numbers']);
    if (numbers.length === 0) {
      return { success: false, result: null, error: 'sum tool expects "numbers": number[]' };
    }
    const total = numbers.reduce((acc, current) => acc + current, 0);
    return { success: true, result: { total, count: numbers.length } };
  },
  'time.now': () => ({ success: true, result: { iso: new Date().toISOString() } }),
  'external.execute': ({ input }) => ({
    success: true,
    result: {
      accepted: true,
      operation: input['operation'] ?? null,
      payload: input['payload'] ?? null,
      note: 'Simulated external operation completed.',
    },
  }),
};

const githubToolHandlers: Record<string, ToolHandler> = {
  'github.list_repositories': ({ userId }) =>
    withGitHubProvider(userId, async (provider) => ({
      repositories: (await provider.listRepositories()).map((repo) => ({
        fullName: repo.fullName,
        name: repo.name,
        description: repo.description,
        language: repo.language,
        defaultBranch: repo.defaultBranch,
        private: repo.private,
      })),
    })),
  'github.get_repository': ({ userId, input }) =>
    withGitHubProvider(userId, async (provider) =>
      provider.getRepository(await resolveGitHubRepo(requireString(input, 'repo'), provider)),
    ),
  'github.get_file': ({ userId, input }) =>
    withGitHubProvider(userId, async (provider) =>
      provider.getFile(
        await resolveGitHubRepo(requireString(input, 'repo'), provider),
        requireString(input, 'path'),
        asString(input['ref']),
      ),
    ),
  'github.get_branch': ({ userId, input }) =>
    withGitHubProvider(userId, async (provider) =>
      provider.getBranch(
        await resolveGitHubRepo(requireString(input, 'repo'), provider),
        requireString(input, 'branch'),
      ),
    ),
  'github.get_pull_request': ({ userId, input }) =>
    withGitHubProvider(userId, async (provider) =>
      provider.getPullRequest(
        await resolveGitHubRepo(requireString(input, 'repo'), provider),
        requireNumber(input, 'pullNumber'),
      ),
    ),
  'github.list_pull_request_files': ({ userId, input }) =>
    withGitHubProvider(userId, async (provider) =>
      provider.listPullRequestFiles(
        await resolveGitHubRepo(requireString(input, 'repo'), provider),
        requireNumber(input, 'pullNumber'),
      ),
    ),
  'github.create_pull_request': ({ userId, input }) =>
    withGitHubProvider(userId, async (provider) =>
      provider.createPullRequest({
        repo: await resolveGitHubRepo(requireString(input, 'repo'), provider),
        title: requireString(input, 'title'),
        body: asString(input['body']),
        head: requireString(input, 'head'),
        base: requireString(input, 'base'),
        draft: typeof input['draft'] === 'boolean' ? input['draft'] : undefined,
      }),
    ),
  'github.update_pull_request': ({ userId, input }) =>
    withGitHubProvider(userId, async (provider) =>
      provider.updatePullRequest({
        repo: await resolveGitHubRepo(requireString(input, 'repo'), provider),
        pullNumber: requireNumber(input, 'pullNumber'),
        title: asString(input['title']),
        body: asString(input['body']),
      }),
    ),
  'github.add_pull_request_comment': ({ userId, input }) =>
    withGitHubProvider(userId, async (provider) =>
      provider.addPullRequestComment({
        repo: await resolveGitHubRepo(requireString(input, 'repo'), provider),
        pullNumber: requireNumber(input, 'pullNumber'),
        body: requireString(input, 'body'),
      }),
    ),
  'github.reply_to_review_comment': ({ userId, input }) =>
    withGitHubProvider(userId, async (provider) =>
      provider.replyToReviewComment({
        repo: await resolveGitHubRepo(requireString(input, 'repo'), provider),
        pullNumber: requireNumber(input, 'pullNumber'),
        commentId: requireNumber(input, 'commentId'),
        body: requireString(input, 'body'),
      }),
    ),
  'github.submit_pull_request_review': ({ userId, input }) =>
    withGitHubProvider(userId, async (provider) =>
      provider.submitPullRequestReview({
        repo: await resolveGitHubRepo(requireString(input, 'repo'), provider),
        pullNumber: requireNumber(input, 'pullNumber'),
        event: requireReviewEvent(input['event']),
        body: asString(input['body']),
      }),
    ),
  'github.coding_task': async ({
    userId,
    conversationId,
    toolExecutionId,
    toolName,
    input,
    assistantMessageId,
    correlationId,
  }) => {
    try {
      const token = await resolveGitHubToken(userId);
      const provider = new GitHubToolProvider(token);
      const repo = await resolveGitHubRepo(requireString(input, 'repo'), provider);
      const pullNumber = asNumber(input['targetPullNumber']);
      const config = loadWorkerConfig();
      return await acceptCodingTask({
        agent: createCodingAgent({
          provider: config.codingAgentProvider,
          apiKey: config.cursorApiKey,
        }),
        userId,
        conversationId,
        toolExecutionId,
        toolName,
        messageId: assistantMessageId,
        correlationId,
        repo,
        task: requireString(input, 'task'),
        baseBranch: asString(input['baseBranch']),
        pullRequestUrl:
          typeof pullNumber === 'number'
            ? `https://github.com/${repo}/pull/${pullNumber}`
            : undefined,
      });
    } catch (error) {
      if (error instanceof CodingAgentError) {
        return { success: false, result: null, error: error.userMessage };
      }
      return {
        success: false,
        result: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

const googleToolHandlers: Record<string, ToolHandler> = {
  'google_drive.search_files': ({ userId, input }) =>
    withGoogleProvider(userId, (provider) =>
      provider.searchFiles(requireString(input, 'query'), asNumber(input['pageSize']) ?? 20),
    ),
  'google_drive.get_file_metadata': ({ userId, input }) =>
    withGoogleProvider(userId, (provider) =>
      provider.getFileMetadata(requireString(input, 'fileId')),
    ),
  'google_drive.read_text_file': ({ userId, input }) =>
    withGoogleProvider(userId, (provider) => provider.readTextFile(requireString(input, 'fileId'))),
  'google_drive.create_text_file': ({ userId, input }) =>
    withGoogleProvider(userId, (provider) =>
      provider.createTextFile({
        name: requireString(input, 'name'),
        content: requireString(input, 'content'),
        mimeType: asString(input['mimeType']),
        parentFolderId: asString(input['parentFolderId']),
      }),
    ),
  'google_drive.update_text_file': ({ userId, input }) =>
    withGoogleProvider(userId, (provider) =>
      provider.updateTextFile({
        fileId: requireString(input, 'fileId'),
        content: requireString(input, 'content'),
        name: asString(input['name']),
      }),
    ),
  'google_drive.rename_file': ({ userId, input }) =>
    withGoogleProvider(userId, (provider) =>
      provider.renameFile(requireString(input, 'fileId'), requireString(input, 'name')),
    ),
  'google_drive.move_file': ({ userId, input }) =>
    withGoogleProvider(userId, (provider) =>
      provider.moveFile(
        requireString(input, 'fileId'),
        requireString(input, 'addParentId'),
        asString(input['removeParentId']),
      ),
    ),
  'google_drive.trash_file': ({ userId, input }) =>
    withGoogleProvider(userId, (provider) => provider.trashFile(requireString(input, 'fileId'))),
  'google_docs.create_document': ({ userId, input }) =>
    withGoogleProvider(userId, (provider) =>
      provider.createDocument(requireString(input, 'title')),
    ),
  'google_docs.get_document': ({ userId, input }) =>
    withGoogleProvider(userId, (provider) =>
      provider.getDocument(requireString(input, 'documentId')),
    ),
  'google_docs.batch_update_document': ({ userId, input }) =>
    withGoogleProvider(userId, (provider) =>
      provider.batchUpdateDocument(
        requireString(input, 'documentId'),
        Array.isArray(input['requests']) ? input['requests'] : [],
      ),
    ),
};

const toolHandlers: Record<string, ToolHandler> = {
  ...nativeToolHandlers,
  ...githubToolHandlers,
  ...googleToolHandlers,
};

/**
 * MCP tools are discovered at runtime, so they cannot be enumerated in the
 * handler map. They are dispatched by their `mcp.` prefix instead, with the
 * namespaced name translated back to the remote server's tool name.
 */
const mcpToolHandler: ToolHandler = ({ userId, toolName, input }) =>
  withMcpClient(userId, toolName, async (client) => {
    const result = await client.callTool(toRemoteMcpToolName(toolName), input);
    return unwrapMcpToolData(result);
  });

export async function executeTool(
  userId: string,
  conversationId: string,
  toolExecutionId: string,
  toolName: string,
  input: Record<string, unknown>,
  assistantMessageId: string | null,
  correlationId: string,
): Promise<ToolExecutionResult> {
  const handler = isMcpToolName(toolName) ? mcpToolHandler : toolHandlers[toolName];
  if (!handler) {
    return { success: false, result: null, error: `Unknown tool: ${toolName}` };
  }

  return handler({
    userId,
    conversationId,
    toolExecutionId,
    toolName,
    input,
    assistantMessageId,
    correlationId,
  });
}
