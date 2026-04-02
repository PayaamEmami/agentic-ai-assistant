import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { OpenAIProvider } from '@aaa/ai';
import type { ToolProgressEvent } from '@aaa/shared';
import { GitHubActionsProvider } from './github-actions.js';

const execFileAsync = promisify(execFile);
const MAX_FILE_CONTEXT = 12;
const MAX_FILE_CONTENT_CHARS = 8_000;

interface CodingPlanOperation {
  type: 'create' | 'update' | 'delete';
  path: string;
  content?: string;
}

interface CodingPlan {
  commitMessage: string;
  prTitle: string;
  prBody: string;
  operations: CodingPlanOperation[];
  validationCommands?: string[];
}

export interface GitHubCodingTaskInput {
  repo: string;
  task: string;
  toolExecutionId: string;
  baseBranch?: string;
  targetPullNumber?: number;
  validationCommands?: string[];
}

export interface CodingTaskProgressReporter {
  report(event: Omit<ToolProgressEvent, 'type' | 'conversationId' | 'toolExecutionId' | 'toolName'>): Promise<void>;
}

export class CodingTaskRunner {
  private readonly github: GitHubActionsProvider;
  private readonly modelProvider: OpenAIProvider;
  private readonly progress: CodingTaskProgressReporter;
  private readonly toolExecutionId: string;
  private readonly githubToken: string;

  constructor(input: {
    githubToken: string;
    conversationId: string;
    toolExecutionId: string;
    progress: CodingTaskProgressReporter;
    model?: string;
  }) {
    this.githubToken = input.githubToken;
    this.github = new GitHubActionsProvider(input.githubToken);
    this.modelProvider = new OpenAIProvider(
      process.env['OPENAI_API_KEY'] ?? '',
      input.model ?? process.env['OPENAI_MODEL'],
    );
    this.progress = input.progress;
    this.toolExecutionId = input.toolExecutionId;
  }

  async run(input: GitHubCodingTaskInput): Promise<unknown> {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aaa-coding-'));
    try {
      await this.report('clone', `Cloning ${input.repo}`);
      const targetPr =
        typeof input.targetPullNumber === 'number'
          ? await this.github.getPullRequest(input.repo, input.targetPullNumber)
          : null;
      const baseBranch = targetPr?.base.ref ?? input.baseBranch ?? 'main';
      const branchName = targetPr?.head.ref ?? `aaa/${this.toolExecutionId}`;
      const repoUrl = `https://x-access-token:${this.githubToken}@github.com/${input.repo}.git`;

      await this.execGit(['clone', '--depth', '50', '--branch', baseBranch, repoUrl, workspaceRoot]);
      await this.execGit(['config', 'user.name', 'Agentic AI Assistant'], workspaceRoot);
      await this.execGit(['config', 'user.email', 'assistant@agentic-ai.local'], workspaceRoot);

      if (targetPr) {
        await this.execGit(['fetch', 'origin', branchName], workspaceRoot);
        await this.execGit(['checkout', branchName], workspaceRoot);
      } else {
        await this.execGit(['checkout', '-b', branchName], workspaceRoot);
      }

      await this.report('plan', 'Preparing coding plan');
      const plan = await this.generatePlan(workspaceRoot, input);

      await this.report('edit', 'Applying code changes');
      await this.applyPlan(workspaceRoot, plan);

      await this.report('validate', 'Running validation commands');
      const validationResults = await this.runValidation(
        workspaceRoot,
        input.validationCommands ?? plan.validationCommands ?? [],
      );

      await this.report('commit', 'Creating git commit');
      await this.execGit(['add', '--all'], workspaceRoot);
      const diffSummary = await this.execGit(['status', '--short'], workspaceRoot);
      if (!diffSummary.stdout.trim()) {
        throw new Error('Coding task produced no file changes');
      }
      await this.execGit(['commit', '-m', plan.commitMessage], workspaceRoot);

      await this.report('push', 'Pushing branch to GitHub');
      await this.execGit(['push', '--set-upstream', 'origin', branchName], workspaceRoot);

      await this.report('pr_update', targetPr ? 'Updating pull request' : 'Creating pull request');
      const pullRequest = targetPr
        ? await this.github.updatePullRequest({
            repo: input.repo,
            pullNumber: input.targetPullNumber!,
            title: plan.prTitle,
            body: plan.prBody,
          })
        : await this.github.createPullRequest({
            repo: input.repo,
            title: plan.prTitle,
            body: plan.prBody,
            head: branchName,
            base: baseBranch,
          });

      await this.report('done', 'Coding task completed');
      return {
        repo: input.repo,
        branch: branchName,
        pullRequest,
        validationResults,
        changedFiles: plan.operations.map((operation) => operation.path),
      };
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  }

  private async generatePlan(workspaceRoot: string, input: GitHubCodingTaskInput): Promise<CodingPlan> {
    const fileList = await this.execGit(['ls-files'], workspaceRoot);
    const candidates = fileList.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const selectedFiles = await this.selectRelevantFiles(workspaceRoot, candidates, input.task);

    const completion = await this.modelProvider.complete({
      messages: [
        {
          role: 'system',
          content:
            'You are generating a coding patch plan for a repository. ' +
            'Return JSON only with this shape: ' +
            '{"commitMessage":"string","prTitle":"string","prBody":"string","validationCommands":["string"],"operations":[{"type":"create"|"update"|"delete","path":"string","content":"string"}]}. ' +
            'For create/update operations, include the full final file content. ' +
            'Only touch files that are provided in the repository context unless creating a new closely-related file.',
        },
        {
          role: 'user',
          content:
            `Repository: ${input.repo}\n` +
            `Task: ${input.task}\n` +
            `Base branch: ${input.baseBranch ?? 'main'}\n\n` +
            `Repository file list:\n${candidates.slice(0, 500).join('\n')}\n\n` +
            `Relevant file contents:\n${selectedFiles.join('\n\n---\n\n')}`,
        },
      ],
      model: process.env['OPENAI_MODEL'],
    });

    const content = completion.content?.trim() ?? '';
    const parsed = JSON.parse(content) as Partial<CodingPlan>;
    if (
      !parsed ||
      typeof parsed.commitMessage !== 'string' ||
      typeof parsed.prTitle !== 'string' ||
      typeof parsed.prBody !== 'string' ||
      !Array.isArray(parsed.operations)
    ) {
      throw new Error('Coding task model returned an invalid patch plan');
    }

    const operations = parsed.operations
      .filter((operation): operation is CodingPlanOperation => {
        if (!operation || typeof operation !== 'object') {
          return false;
        }
        const candidate = operation as Partial<CodingPlanOperation>;
        if (
          (candidate.type !== 'create' && candidate.type !== 'update' && candidate.type !== 'delete') ||
          typeof candidate.path !== 'string'
        ) {
          return false;
        }
        if (candidate.type !== 'delete' && typeof candidate.content !== 'string') {
          return false;
        }
        return true;
      });

    if (operations.length === 0) {
      throw new Error('Coding task model returned no valid file operations');
    }

    return {
      commitMessage: parsed.commitMessage.trim(),
      prTitle: parsed.prTitle.trim(),
      prBody: parsed.prBody.trim(),
      operations,
      validationCommands: Array.isArray(parsed.validationCommands)
        ? parsed.validationCommands.filter((command): command is string => typeof command === 'string')
        : [],
    };
  }

  private async selectRelevantFiles(
    workspaceRoot: string,
    candidates: string[],
    task: string,
  ): Promise<string[]> {
    const tokens = task
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3);
    const scored = candidates
      .map((candidate) => ({
        candidate,
        score: tokens.reduce(
          (total, token) => total + (candidate.toLowerCase().includes(token) ? 1 : 0),
          0,
        ),
      }))
      .sort((a, b) => b.score - a.score || a.candidate.localeCompare(b.candidate))
      .slice(0, MAX_FILE_CONTEXT);

    const fallbackFiles = ['package.json', 'README.md'];
    const selected = new Set(
      scored.filter((item) => item.score > 0).map((item) => item.candidate),
    );

    for (const file of fallbackFiles) {
      if (candidates.includes(file)) {
        selected.add(file);
      }
    }

    const contents: string[] = [];
    for (const file of Array.from(selected).slice(0, MAX_FILE_CONTEXT)) {
      const fullPath = path.join(workspaceRoot, file);
      try {
        const content = await fs.readFile(fullPath, 'utf8');
        contents.push(`FILE: ${file}\n${content.slice(0, MAX_FILE_CONTENT_CHARS)}`);
      } catch {
        // Ignore unreadable files in the generated context.
      }
    }

    return contents;
  }

  private async applyPlan(workspaceRoot: string, plan: CodingPlan): Promise<void> {
    for (const operation of plan.operations) {
      const targetPath = path.join(workspaceRoot, operation.path);
      const normalized = path.normalize(targetPath);
      if (!normalized.startsWith(path.normalize(workspaceRoot))) {
        throw new Error(`Refusing to write outside workspace: ${operation.path}`);
      }

      if (operation.type === 'delete') {
        await fs.rm(targetPath, { force: true });
        continue;
      }

      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, operation.content ?? '', 'utf8');
    }
  }

  private async runValidation(
    workspaceRoot: string,
    commands: string[],
  ): Promise<Array<{ command: string; ok: boolean; stdout: string; stderr: string }>> {
    const results: Array<{ command: string; ok: boolean; stdout: string; stderr: string }> = [];

    for (const command of commands) {
      const [file, ...args] = splitCommand(command);
      if (!file) {
        continue;
      }

      try {
        const { stdout, stderr } = await execFileAsync(file, args, {
          cwd: workspaceRoot,
          windowsHide: true,
          maxBuffer: 1024 * 1024,
        });
        results.push({ command, ok: true, stdout, stderr });
      } catch (error) {
        const failed = error as { stdout?: string; stderr?: string };
        results.push({
          command,
          ok: false,
          stdout: failed.stdout ?? '',
          stderr: failed.stderr ?? String(error),
        });
      }
    }

    return results;
  }

  private async execGit(
    args: string[],
    cwd?: string,
  ): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync('git', args, {
      cwd,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
  }

  private async report(
    phase: ToolProgressEvent['phase'],
    message: string,
  ): Promise<void> {
    await this.progress.report({ phase, message });
  }
}

function splitCommand(command: string): string[] {
  return command.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, '')) ?? [];
}
