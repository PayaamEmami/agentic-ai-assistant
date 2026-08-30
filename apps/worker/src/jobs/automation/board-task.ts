import type { Job } from 'bullmq';
import {
  AUTOMATION_MAX_REPOS,
  AutomationPlannerAgent,
  createChatProvider,
  type AutomationCandidateRepo,
  type AutomationPlanSelection,
} from '@aaa/ai';
import { loadWorkerConfig, openAIProviderModelConfigFromWorkerConfig } from '@aaa/config';
import {
  automationRunRepository,
  automationScheduleRepository,
  isPgUniqueViolation,
  type AutomationRun,
  type AutomationSchedule,
} from '@aaa/db';
import { unwrapMcpToolData, type McpClient } from '@aaa/mcp';
import type { AutomationJobData } from '@aaa/shared';
import {
  CodingTaskRunner,
  GitHubToolProvider,
  type GitHubRepository,
} from '@aaa/tool-providers';
import { logger } from '../../lib/logger.js';
import { resolveGitHubToken, resolveMcpClient } from '../tool-execution/providers.js';
import { findReviewList, parseBoard, selectCandidateCards, type ParsedBoard } from './board.js';
import { AutomationRunAbandonedError, AutomationRunLog } from './run-log.js';

function publicErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/x-access-token:[^@\s]+/gi, 'x-access-token:[redacted]')
    .replace(/bearer\s+\S+/gi, 'bearer [redacted]');
}

function toCandidateRepos(
  repositories: GitHubRepository[],
  allowlist: string[] | null,
): AutomationCandidateRepo[] {
  const allowed = allowlist?.length
    ? repositories.filter((repo) =>
        allowlist.some((entry) => entry.toLowerCase() === repo.fullName.toLowerCase()),
      )
    : repositories;

  return allowed.slice(0, AUTOMATION_MAX_REPOS).map((repo) => ({
    fullName: repo.fullName,
    description: repo.description,
    language: repo.language,
    defaultBranch: repo.defaultBranch,
  }));
}

async function callTool(
  client: McpClient,
  runId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  // `_runId` tags the resulting board write as automation so the task tool's UI
  // can attribute the change; the MCP server strips it before the tool runs.
  const result = await client.callTool(toolName, { ...args, _runId: runId });
  return unwrapMcpToolData(result);
}

async function finishRun(
  log: AutomationRunLog,
  status: 'completed' | 'skipped' | 'failed',
  message: string,
  extra?: {
    pullRequestUrl?: string | null;
    skipReason?: string | null;
    error?: string | null;
  },
): Promise<void> {
  await log.finish(status, {
    message,
    pullRequestUrl: extra?.pullRequestUrl,
    skipReason: extra?.skipReason ?? (status === 'skipped' ? message : undefined),
    error: extra?.error ?? (status === 'failed' ? message : undefined),
  });
}

async function reportBackToCard(
  client: McpClient,
  log: AutomationRunLog,
  input: {
    runId: string;
    cardId: string;
    pullRequestUrl: string;
    reviewListId: string | null;
  },
): Promise<void> {
  await callTool(client, input.runId, 'tasks_append_card_note', {
    cardId: input.cardId,
    note: `Assistant opened a draft pull request: ${input.pullRequestUrl}`,
  });
  await log.progress('Added the pull request link to the card', 'reporting_back');

  if (!input.reviewListId) {
    return;
  }

  await callTool(client, input.runId, 'tasks_move_card', {
    cardId: input.cardId,
    targetListId: input.reviewListId,
  });
  await log.progress('Moved the card to the review list', 'reporting_back');
}

interface PreparedBoard {
  client: McpClient;
  githubToken: string;
  board: ParsedBoard;
  candidates: ReturnType<typeof selectCandidateCards>;
  alreadyWorked: string[];
}

async function prepareBoard(
  run: AutomationRun,
  schedule: AutomationSchedule | null,
  log: AutomationRunLog,
): Promise<PreparedBoard | null> {
  const boardId = schedule?.boardId ?? run.boardId;
  if (!boardId) {
    await finishRun(log, 'failed', 'No board is configured for this automation.');
    return null;
  }

  await log.enterStage('connecting');
  const client = await resolveMcpClient(run.userId);
  const githubToken = await resolveGitHubToken(run.userId);

  await log.enterStage('reading_board');
  const board = parseBoard(await callTool(client, run.id, 'tasks_get_board', { boardId }));
  if (!board) {
    await finishRun(log, 'failed', `Board "${boardId}" could not be read.`);
    return null;
  }

  const candidates = selectCandidateCards(board, schedule?.sourceListId ?? null);
  await log.thought(
    `Found ${candidates.length} candidate card${candidates.length === 1 ? '' : 's'} on "${board.name}".`,
  );

  if (candidates.length === 0) {
    await finishRun(log, 'skipped', 'No open cards were available to work on.');
    return null;
  }

  const alreadyWorked = await automationRunRepository.findCardIdsWithExistingWork(
    run.userId,
    candidates.map((card) => card.id),
  );
  if (alreadyWorked.length > 0) {
    await log.thought(
      `Skipping ${alreadyWorked.length} card${alreadyWorked.length === 1 ? '' : 's'} that already have a pull request.`,
    );
  }

  return { client, githubToken, board, candidates, alreadyWorked };
}

interface ClaimedWork {
  plan: AutomationPlanSelection;
  card: PreparedBoard['candidates'][number];
  repos: AutomationCandidateRepo[];
}

async function selectAndClaimWork(
  run: AutomationRun,
  schedule: AutomationSchedule | null,
  prepared: PreparedBoard,
  log: AutomationRunLog,
): Promise<ClaimedWork | null> {
  await log.enterStage('selecting_card');
  const config = loadWorkerConfig();
  const chatProvider = createChatProvider(
    config.openaiApiKey,
    openAIProviderModelConfigFromWorkerConfig(config),
    config.llmChatProvider,
  );

  const github = new GitHubToolProvider(prepared.githubToken);
  const repos = toCandidateRepos(
    await github.listRepositories(),
    schedule?.repoAllowlist ?? null,
  );
  await log.thought(`Considering ${repos.length} repositor${repos.length === 1 ? 'y' : 'ies'}.`);

  const plan = await new AutomationPlannerAgent(chatProvider).plan({
    boardName: prepared.board.name,
    cards: prepared.candidates,
    repos,
    excludedCardIds: prepared.alreadyWorked,
  });

  if (plan.decision === 'abstain') {
    await automationRunRepository.update(run.id, { rationale: plan.reason });
    await finishRun(log, 'skipped', `Chose not to start any work: ${plan.reason}`, {
      skipReason: plan.reason,
    });
    return null;
  }

  const card = prepared.candidates.find((entry) => entry.id === plan.cardId);
  if (!card) {
    await finishRun(
      log,
      'skipped',
      `Planner chose card "${plan.cardId}", which is no longer on the board.`,
    );
    return null;
  }

  try {
    const claimed = await automationRunRepository.update(
      run.id,
      {
        selectedCardId: plan.cardId,
        selectedCardTitle: card.title,
        selectedRepo: plan.repo,
        rationale: plan.rationale,
      },
      { requireActive: true },
    );
    if (!claimed) {
      throw new AutomationRunAbandonedError(run.id);
    }
  } catch (error) {
    // Unique index on in-flight (user, card) claims: another run won the race.
    if (isPgUniqueViolation(error)) {
      await finishRun(log, 'skipped', `Another run is already working on "${card.title}".`);
      return null;
    }
    throw error;
  }

  const conflicting = await automationRunRepository.findExistingWorkForCard(
    run.userId,
    plan.cardId,
    run.id,
  );
  if (conflicting) {
    await finishRun(log, 'skipped', `Another run is already working on "${card.title}".`);
    return null;
  }

  await log.result(
    `Selected "${card.title}" for ${plan.repo} (confidence ${plan.confidence.toFixed(2)}).`,
  );
  await log.thought(plan.rationale);
  return { plan, card, repos };
}

async function implementClaimedWork(
  run: AutomationRun,
  prepared: PreparedBoard,
  claimed: ClaimedWork,
  log: AutomationRunLog,
): Promise<void> {
  if (run.dryRun) {
    await finishRun(
      log,
      'completed',
      `Dry run: would implement "${claimed.card.title}" in ${claimed.plan.repo}. No code was written and no pull request was opened.`,
    );
    return;
  }

  await log.enterStage('implementing');
  const runner = new CodingTaskRunner({
    githubToken: prepared.githubToken,
    conversationId: run.conversationId ?? run.id,
    toolExecutionId: run.id,
    progress: {
      report: async ({ phase, message }) => {
        await log.progress(
          message,
          phase === 'pr_update' ? 'opening_pull_request' : 'implementing',
        );
      },
    },
  });

  const result = await runner.run({
    repo: claimed.plan.repo,
    task: claimed.plan.task,
    toolExecutionId: run.id,
    baseBranch:
      claimed.repos.find((repo) => repo.fullName === claimed.plan.repo)?.defaultBranch ??
      undefined,
    // Unattended changes always land as drafts so a human opens them for review.
    draft: true,
    // Do not exec model-chosen shell commands on the worker in unattended mode.
    skipValidation: true,
  });

  const pullRequestUrl = result.pullRequest.html_url;
  await automationRunRepository.update(run.id, { pullRequestUrl });

  try {
    await log.enterStage('reporting_back');
  } catch (error) {
    if (!(error instanceof AutomationRunAbandonedError)) {
      throw error;
    }
  }

  try {
    await reportBackToCard(prepared.client, log, {
      runId: run.id,
      cardId: claimed.plan.cardId,
      pullRequestUrl,
      reviewListId: findReviewList(prepared.board)?.listId ?? null,
    });
  } catch (error) {
    // The pull request already exists, so a failure to annotate the card is
    // worth logging but must not fail the run.
    await log.progress(
      `Could not update the card: ${error instanceof Error ? error.message : String(error)}`,
      'reporting_back',
    );
  }

  await finishRun(
    log,
    'completed',
    `Opened a draft pull request for "${claimed.card.title}": ${pullRequestUrl}`,
    { pullRequestUrl },
  );
}

async function executeRun(
  run: AutomationRun,
  schedule: AutomationSchedule | null,
  log: AutomationRunLog,
): Promise<void> {
  const prepared = await prepareBoard(run, schedule, log);
  if (!prepared) {
    return;
  }

  const claimed = await selectAndClaimWork(run, schedule, prepared, log);
  if (!claimed) {
    return;
  }

  await implementClaimedWork(run, prepared, claimed, log);
}

export async function handleAutomation(job: Job<AutomationJobData>): Promise<void> {
  const { runId, scheduleId, userId } = job.data;
  const run = await automationRunRepository.findById(runId);

  if (!run) {
    logger.warn(
      {
        event: 'automation.run.missing',
        outcome: 'failure',
        automationRunId: runId,
      },
      'Automation run row no longer exists',
    );
    return;
  }

  if (run.status === 'running') {
    // A stalled retry. Skipping would mark the job successful and leave the
    // row running until the sweeper; fail it so the schedule can fire again.
    logger.warn(
      {
        event: 'automation.run.stale_retry',
        outcome: 'failure',
        automationRunId: runId,
      },
      'Automation run was already running; treating the previous worker as gone',
    );
    await abandonAutomationRun(
      runId,
      'The worker stopped while this run was in progress.',
    );
    return;
  }

  if (run.status !== 'queued') {
    logger.info(
      {
        event: 'automation.run.skipped',
        outcome: 'success',
        automationRunId: runId,
        status: run.status,
      },
      'Automation run is not queued; skipping',
    );
    return;
  }

  const conversationId = run.conversationId;
  if (!conversationId) {
    await automationRunRepository.update(runId, {
      status: 'failed',
      error: 'Automation run has no conversation to stream into.',
    });
    return;
  }

  const log = new AutomationRunLog(runId, conversationId);
  const schedule = scheduleId ? await automationScheduleRepository.findById(scheduleId) : null;

  try {
    await executeRun(run, schedule, log);
  } catch (error) {
    if (error instanceof AutomationRunAbandonedError) {
      logger.info(
        {
          event: 'automation.run.abandoned',
          outcome: 'success',
          automationRunId: runId,
        },
        'Automation run was already failed; stopping the worker',
      );
      return;
    }

    const message = publicErrorMessage(error);
    logger.error(
      {
        event: 'automation.run.failed',
        outcome: 'failure',
        automationRunId: runId,
        userId,
        error,
      },
      'Automation run failed',
    );
    await finishRun(log, 'failed', `Run failed: ${message}`, { error: message });
  }
}

export async function abandonAutomationRun(runId: string, message: string): Promise<void> {
  const run = await automationRunRepository.findById(runId);
  if (!run?.conversationId) {
    await automationRunRepository.failIfActive(runId, message);
    return;
  }

  const log = new AutomationRunLog(run.id, run.conversationId);
  await log.failIfActive(`Run failed: ${message}`);
}
