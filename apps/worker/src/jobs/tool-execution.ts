import type { Job } from 'bullmq';
import {
  conversationRepository,
  appCapabilityConfigRepository,
  getPool,
  messageRepository,
  toolExecutionRepository,
} from '@aaa/db';
import { CodingTaskRunner, GitHubToolProvider, GoogleDriveToolProvider } from '@aaa/tool-providers';
import { decryptCredentials, encryptCredentials } from '@aaa/knowledge-sources';
import type {
  ToolDoneEvent,
  ToolProgressEvent,
  ToolStartEvent,
} from '@aaa/shared';
import { logger } from '../lib/logger.js';

export interface ToolExecutionJobData {
  toolExecutionId: string;
  toolName: string;
  input: Record<string, unknown>;
  conversationId: string;
  correlationId: string;
}

const TOOL_EVENT_CHANNEL = 'tool_execution_events';

function getInternalApiBaseUrl(): string {
  return process.env['INTERNAL_API_BASE_URL'] ?? process.env['API_BASE_URL'] ?? 'http://localhost:3001';
}

function getInternalServiceSecret(): string {
  return process.env['INTERNAL_SERVICE_SECRET'] ?? 'dev-internal-service-secret';
}

async function publishToolEvent(
  event: ToolStartEvent | ToolProgressEvent | ToolDoneEvent,
): Promise<void> {
  const pool = getPool();
  await pool.query('SELECT pg_notify($1, $2)', [TOOL_EVENT_CHANNEL, JSON.stringify(event)]);
}

async function updateInlineToolResult(
  messageId: string | null,
  toolExecutionId: string,
  patch: {
    status?: string;
    output?: unknown;
    detail?: string;
  },
): Promise<void> {
  if (!messageId) {
    return;
  }

  await messageRepository.updateToolResultBlock(messageId, toolExecutionId, patch);
}

function toNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === 'number' ? entry : Number.NaN))
    .filter((entry) => Number.isFinite(entry));
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === 'string');
}

async function resolveGitHubRepo(repo: string, provider: GitHubToolProvider): Promise<string> {
  const trimmedRepo = repo.trim();
  if (!trimmedRepo) {
    throw new Error('Expected "repo" to be a non-empty string');
  }

  if (trimmedRepo.includes('/')) {
    return trimmedRepo;
  }

  const normalizedRepo = trimmedRepo.toLowerCase();
  const accessibleRepos = await provider.listRepositories();
  const accessibleMatches = accessibleRepos.filter((repoRef) => {
    const normalizedName = repoRef.name.toLowerCase();
    const normalizedFullName = repoRef.fullName.toLowerCase();
    return (
      normalizedName === normalizedRepo ||
      normalizedFullName === normalizedRepo ||
      normalizedFullName.endsWith(`/${normalizedRepo}`)
    );
  });

  if (accessibleMatches.length === 1) {
    return accessibleMatches[0]!.fullName;
  }

  if (accessibleMatches.length > 1) {
    throw new Error(
      `Repository "${trimmedRepo}" is ambiguous. Use the full GitHub repository name (owner/repo). Matches: ${accessibleMatches
        .map((repoRef) => repoRef.fullName)
        .join(', ')}`,
    );
  }

  throw new Error(
    `Repository "${trimmedRepo}" did not match any GitHub repository accessible to this app. Use the full GitHub repository name (owner/repo).`,
  );
}

async function executeNativeTool(
  userId: string,
  conversationId: string,
  toolExecutionId: string,
  toolName: string,
  input: Record<string, unknown>,
  assistantMessageId: string | null,
): Promise<{ success: boolean; result: unknown; error?: string }> {
  switch (toolName) {
    case 'echo':
      return { success: true, result: { echo: input['text'] ?? input['message'] ?? null } };
    case 'sum': {
      const numbers = toNumberArray(input['numbers']);
      if (numbers.length === 0) {
        return { success: false, result: null, error: 'sum tool expects "numbers": number[]' };
      }
      const total = numbers.reduce((acc, current) => acc + current, 0);
      return { success: true, result: { total, count: numbers.length } };
    }
    case 'time.now':
      return { success: true, result: { iso: new Date().toISOString() } };
    case 'external.execute':
      return {
        success: true,
        result: {
          accepted: true,
          operation: input['operation'] ?? null,
          payload: input['payload'] ?? null,
          note: 'Simulated external operation completed.',
        },
      };
    case 'github.get_repository':
      return withGitHubProvider(userId, async (provider) =>
        provider.getRepository(await resolveGitHubRepo(requireString(input, 'repo'), provider)),
      );
    case 'github.get_file':
      return withGitHubProvider(userId, async (provider) =>
        provider.getFile(
          await resolveGitHubRepo(requireString(input, 'repo'), provider),
          requireString(input, 'path'),
          asString(input['ref']),
        ),
      );
    case 'github.get_branch':
      return withGitHubProvider(userId, async (provider) =>
        provider.getBranch(
          await resolveGitHubRepo(requireString(input, 'repo'), provider),
          requireString(input, 'branch'),
        ),
      );
    case 'github.get_pull_request':
      return withGitHubProvider(userId, async (provider) =>
        provider.getPullRequest(
          await resolveGitHubRepo(requireString(input, 'repo'), provider),
          requireNumber(input, 'pullNumber'),
        ),
      );
    case 'github.list_pull_request_files':
      return withGitHubProvider(userId, async (provider) =>
        provider.listPullRequestFiles(
          await resolveGitHubRepo(requireString(input, 'repo'), provider),
          requireNumber(input, 'pullNumber'),
        ),
      );
    case 'github.create_pull_request':
      return withGitHubProvider(userId, async (provider) =>
        provider.createPullRequest({
          repo: await resolveGitHubRepo(requireString(input, 'repo'), provider),
          title: requireString(input, 'title'),
          body: asString(input['body']),
          head: requireString(input, 'head'),
          base: requireString(input, 'base'),
          draft: typeof input['draft'] === 'boolean' ? input['draft'] : undefined,
        }),
      );
    case 'github.update_pull_request':
      return withGitHubProvider(userId, async (provider) =>
        provider.updatePullRequest({
          repo: await resolveGitHubRepo(requireString(input, 'repo'), provider),
          pullNumber: requireNumber(input, 'pullNumber'),
          title: asString(input['title']),
          body: asString(input['body']),
        }),
      );
    case 'github.add_pull_request_comment':
      return withGitHubProvider(userId, async (provider) =>
        provider.addPullRequestComment({
          repo: await resolveGitHubRepo(requireString(input, 'repo'), provider),
          pullNumber: requireNumber(input, 'pullNumber'),
          body: requireString(input, 'body'),
        }),
      );
    case 'github.reply_to_review_comment':
      return withGitHubProvider(userId, async (provider) =>
        provider.replyToReviewComment({
          repo: await resolveGitHubRepo(requireString(input, 'repo'), provider),
          pullNumber: requireNumber(input, 'pullNumber'),
          commentId: requireNumber(input, 'commentId'),
          body: requireString(input, 'body'),
        }),
      );
    case 'github.submit_pull_request_review':
      return withGitHubProvider(userId, async (provider) =>
        provider.submitPullRequestReview({
          repo: await resolveGitHubRepo(requireString(input, 'repo'), provider),
          pullNumber: requireNumber(input, 'pullNumber'),
          event: requireReviewEvent(input['event']),
          body: asString(input['body']),
        }),
      );
    case 'github.coding_task':
      return withGitHubProvider(userId, async (_provider, token) => {
        const runner = new CodingTaskRunner({
          githubToken: token,
          conversationId,
          toolExecutionId,
          progress: {
            report: async ({ phase, message }) => {
              await updateInlineToolResult(assistantMessageId, toolExecutionId, {
                status: 'running',
                detail: message,
              });
              const event: ToolProgressEvent = {
                type: 'tool.progress',
                conversationId,
                toolExecutionId,
                toolName,
                phase,
                message,
              };
              await publishToolEvent(event);
            },
          },
        });

        return runner.run({
          repo: await resolveGitHubRepo(requireString(input, 'repo'), _provider),
          task: requireString(input, 'task'),
          toolExecutionId,
          baseBranch: asString(input['baseBranch']),
          targetPullNumber: asNumber(input['targetPullNumber']),
          validationCommands: toStringArray(input['validationCommands']),
        });
      });
    case 'google_drive.search_files':
      return withGoogleProvider(userId, (provider) =>
        provider.searchFiles(requireString(input, 'query'), asNumber(input['pageSize']) ?? 20),
      );
    case 'google_drive.get_file_metadata':
      return withGoogleProvider(userId, (provider) =>
        provider.getFileMetadata(requireString(input, 'fileId')),
      );
    case 'google_drive.read_text_file':
      return withGoogleProvider(userId, (provider) =>
        provider.readTextFile(requireString(input, 'fileId')),
      );
    case 'google_drive.create_text_file':
      return withGoogleProvider(userId, (provider) =>
        provider.createTextFile({
          name: requireString(input, 'name'),
          content: requireString(input, 'content'),
          mimeType: asString(input['mimeType']),
          parentFolderId: asString(input['parentFolderId']),
        }),
      );
    case 'google_drive.update_text_file':
      return withGoogleProvider(userId, (provider) =>
        provider.updateTextFile({
          fileId: requireString(input, 'fileId'),
          content: requireString(input, 'content'),
          name: asString(input['name']),
        }),
      );
    case 'google_drive.rename_file':
      return withGoogleProvider(userId, (provider) =>
        provider.renameFile(requireString(input, 'fileId'), requireString(input, 'name')),
      );
    case 'google_drive.move_file':
      return withGoogleProvider(userId, (provider) =>
        provider.moveFile(
          requireString(input, 'fileId'),
          requireString(input, 'addParentId'),
          asString(input['removeParentId']),
        ),
      );
    case 'google_drive.trash_file':
      return withGoogleProvider(userId, (provider) =>
        provider.trashFile(requireString(input, 'fileId')),
      );
    case 'google_docs.create_document':
      return withGoogleProvider(userId, (provider) =>
        provider.createDocument(requireString(input, 'title')),
      );
    case 'google_docs.get_document':
      return withGoogleProvider(userId, (provider) =>
        provider.getDocument(requireString(input, 'documentId')),
      );
    case 'google_docs.batch_update_document':
      return withGoogleProvider(userId, (provider) =>
        provider.batchUpdateDocument(
          requireString(input, 'documentId'),
          Array.isArray(input['requests']) ? input['requests'] : [],
        ),
      );
    default:
      return { success: false, result: null, error: `Unknown tool: ${toolName}` };
  }
}

async function withGitHubProvider(
  userId: string,
  handler: (provider: GitHubToolProvider, token: string) => Promise<unknown>,
): Promise<{ success: boolean; result: unknown; error?: string }> {
  try {
    const config = await appCapabilityConfigRepository.findByUserAppAndCapability(
      userId,
      'github',
      'tools',
    );
    if (!config) {
      throw new Error('GitHub app is not connected');
    }

    const credentials = decryptCredentials(config.encryptedCredentials);
    const token = requireString(credentials, 'accessToken');
    const provider = new GitHubToolProvider(token);
    return { success: true, result: await handler(provider, token) };
  } catch (error) {
    return {
      success: false,
      result: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function withGoogleProvider(
  userId: string,
  handler: (provider: GoogleDriveToolProvider) => Promise<unknown>,
): Promise<{ success: boolean; result: unknown; error?: string }> {
  try {
    const config = await appCapabilityConfigRepository.findByUserAppAndCapability(
      userId,
      'google',
      'tools',
    );
    if (!config) {
      throw new Error('Google app is not connected');
    }

    const credentials = decryptCredentials(config.encryptedCredentials);
    const provider = new GoogleDriveToolProvider({
      credentials: {
        accessToken: requireString(credentials, 'accessToken'),
        refreshToken: asString(credentials['refreshToken']),
        expiresAt: asString(credentials['expiresAt']),
      },
      onRefresh: async (refreshedCredentials) => {
        await appCapabilityConfigRepository.updateCredentialsByUserAndApp(
          userId,
          'google',
          encryptCredentials(refreshedCredentials as unknown as Record<string, unknown>),
        );
      },
    });

    return { success: true, result: await handler(provider) };
  } catch (error) {
    return {
      success: false,
      result: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function requireString(source: Record<string, unknown>, key: string): string {
  const value = asString(source[key]);
  if (!value) {
    throw new Error(`Expected "${key}" to be a non-empty string`);
  }
  return value;
}

function requireNumber(source: Record<string, unknown>, key: string): number {
  const value = asNumber(source[key]);
  if (typeof value !== 'number') {
    throw new Error(`Expected "${key}" to be a number`);
  }
  return value;
}

function requireReviewEvent(value: unknown): 'APPROVE' | 'COMMENT' | 'REQUEST_CHANGES' {
  if (value === 'APPROVE' || value === 'COMMENT' || value === 'REQUEST_CHANGES') {
    return value;
  }
  throw new Error('Expected "event" to be APPROVE, COMMENT, or REQUEST_CHANGES');
}

async function executeTool(
  userId: string,
  conversationId: string,
  toolExecutionId: string,
  execution: Awaited<ReturnType<typeof toolExecutionRepository.findById>>,
  toolName: string,
  input: Record<string, unknown>,
): Promise<{ success: boolean; result: unknown; error?: string }> {
  if (!execution) {
    return { success: false, result: null, error: 'Tool execution not found' };
  }

  if (execution.origin === 'mcp') {
    return { success: false, result: null, error: 'No MCP integrations are available' };
  }

  return executeNativeTool(
    userId,
    conversationId,
    toolExecutionId,
    toolName,
    input,
    execution.messageId,
  );
}

async function continueConversationAfterToolExecution(
  toolExecutionId: string,
  correlationId: string,
): Promise<void> {
  const response = await fetch(
    `${getInternalApiBaseUrl()}/api/chat/internal/tool-executions/${toolExecutionId}/continue`,
    {
      method: 'POST',
      headers: {
        'x-internal-service-secret': getInternalServiceSecret(),
        'x-correlation-id': correlationId,
      },
    },
  );

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    throw new Error(
      typeof body?.error?.message === 'string'
        ? body.error.message
        : `Chat continuation failed with status ${response.status}`,
    );
  }
}

export async function handleToolExecution(job: Job<ToolExecutionJobData>): Promise<void> {
  const { toolExecutionId, toolName, conversationId, correlationId } = job.data;
  logger.info(
    {
      event: 'tool.execution.started',
      outcome: 'start',
      toolExecutionId,
      toolName,
      conversationId,
      jobId: job.id,
      correlationId,
    },
    'Processing tool execution job',
  );

  const execution = await toolExecutionRepository.findById(toolExecutionId);
  if (!execution) {
    logger.warn(
      {
        event: 'tool.execution.skipped',
        outcome: 'failure',
        toolExecutionId,
        conversationId,
        correlationId,
      },
      'Tool execution row not found',
    );
    return;
  }

  const conversation = await conversationRepository.findById(conversationId);
  if (!conversation) {
    throw new Error(`Conversation not found for tool execution: ${conversationId}`);
  }

  await toolExecutionRepository.updateStatus(toolExecutionId, 'running');
  await updateInlineToolResult(execution.messageId, toolExecutionId, {
    status: 'running',
    detail: undefined,
    output: undefined,
  });

  const startEvent: ToolStartEvent = {
    type: 'tool.start',
    conversationId,
    toolExecutionId,
    toolName,
    input: execution.input,
  };
  await publishToolEvent(startEvent);

  const result = await executeTool(
    conversation.userId,
    conversationId,
    toolExecutionId,
    execution,
    toolName,
    job.data.input,
  );

  if (result.success) {
    await toolExecutionRepository.updateStatus(toolExecutionId, 'completed', result.result);
    await updateInlineToolResult(execution.messageId, toolExecutionId, {
      status: 'completed',
      output: result.result,
      detail: undefined,
    });

    const doneEvent: ToolDoneEvent = {
      type: 'tool.done',
      conversationId,
      toolExecutionId,
      toolName,
      output: result.result,
      status: 'completed',
    };
    await publishToolEvent(doneEvent);
    if (execution.originMode !== 'voice') {
      await continueConversationAfterToolExecution(toolExecutionId, correlationId).catch(
        (error) => {
          logger.warn(
            {
              event: 'tool.execution.continuation_failed',
              outcome: 'failure',
              toolExecutionId,
              toolName,
              conversationId,
              correlationId,
              error,
            },
            'Failed to continue conversation after tool execution',
          );
        },
      );
    } else {
      logger.info(
        {
          event: 'tool.execution.continuation_skipped',
          outcome: 'success',
          toolExecutionId,
          toolName,
          conversationId,
          correlationId,
          reason: 'voice_origin',
        },
        'Skipping HTTP continuation for voice-origin tool execution',
      );
    }
    logger.info(
      {
        event: 'tool.execution.completed',
        outcome: 'success',
        toolExecutionId,
        toolName,
        conversationId,
        correlationId,
      },
      'Tool execution completed',
    );
    return;
  }

  const errorOutput = { error: result.error ?? 'Tool execution failed' };
  await toolExecutionRepository.updateStatus(toolExecutionId, 'failed', errorOutput);
  await updateInlineToolResult(execution.messageId, toolExecutionId, {
    status: 'failed',
    output: errorOutput,
    detail: undefined,
  });

  const doneEvent: ToolDoneEvent = {
    type: 'tool.done',
    conversationId,
    toolExecutionId,
    toolName,
    output: errorOutput,
    status: 'failed',
  };
  await publishToolEvent(doneEvent);
  if (execution.originMode !== 'voice') {
    await continueConversationAfterToolExecution(toolExecutionId, correlationId).catch(
      (error) => {
        logger.warn(
          {
            event: 'tool.execution.continuation_failed',
            outcome: 'failure',
            toolExecutionId,
            toolName,
            conversationId,
            correlationId,
            error,
          },
          'Failed to continue conversation after tool execution',
        );
      },
    );
  } else {
    logger.info(
      {
        event: 'tool.execution.continuation_skipped',
        outcome: 'success',
        toolExecutionId,
        toolName,
        conversationId,
        correlationId,
        reason: 'voice_origin',
      },
      'Skipping HTTP continuation for voice-origin tool execution',
    );
  }
  logger.warn(
    {
      event: 'tool.execution.completed',
      outcome: 'failure',
      toolExecutionId,
      toolName,
      conversationId,
      correlationId,
      error: result.error,
    },
    'Tool execution failed',
  );
}
