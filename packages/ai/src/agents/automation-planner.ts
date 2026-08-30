import type { ChatProvider } from '../model-provider.js';

export interface AutomationCandidateCard {
  id: string;
  title: string;
  description?: string;
  listName: string;
  labels?: string[];
  notes?: string[];
}

export interface AutomationCandidateRepo {
  fullName: string;
  description?: string | null;
  language?: string | null;
  defaultBranch?: string | null;
}

export interface AutomationPlanRequest {
  boardName: string;
  cards: AutomationCandidateCard[];
  repos: AutomationCandidateRepo[];
  /** Cards already worked by a previous run, so the planner does not repeat them. */
  excludedCardIds?: string[];
}

export interface AutomationPlanSelection {
  decision: 'selected';
  cardId: string;
  repo: string;
  /** A self-contained task description for the coding runner. */
  task: string;
  rationale: string;
  confidence: number;
}

export interface AutomationPlanAbstention {
  decision: 'abstain';
  reason: string;
}

export type AutomationPlan = AutomationPlanSelection | AutomationPlanAbstention;

/**
 * Confidence floor for acting autonomously. Below this the planner abstains, so
 * an ambiguous board produces a skipped run instead of an unwanted pull request.
 */
export const AUTOMATION_MIN_CONFIDENCE = 0.6;
export const AUTOMATION_MAX_REPOS = 100;

const MAX_CARDS = 60;
const MAX_TEXT_CHARS = 600;

const SYSTEM_PROMPT = [
  'You choose one task from a project board for an autonomous coding agent to implement, then pick the repository it belongs in.',
  '',
  'Choose a card only when all of the following hold:',
  '- The card describes a concrete, self-contained code change.',
  '- You can tell which repository it belongs in from the card text and the repository list.',
  '- The work is small enough to complete in a single pull request.',
  '',
  'Abstain when the board has no such card. Vague cards ("improve performance"), research or discussion cards, cards needing product decisions, and cards whose repository is unclear are all reasons to abstain.',
  'Abstaining is the correct, expected outcome for many boards. Never invent a card id or a repository name that was not given to you.',
  '',
  'Respond with JSON only, in one of these two shapes:',
  '{"decision":"selected","cardId":"<id from the list>","repo":"<owner/repo from the list>","task":"<detailed instructions for the coding agent>","rationale":"<why this card and repo>","confidence":<0-1>}',
  '{"decision":"abstain","reason":"<why no card was suitable>"}',
  '',
  'The "task" field is the only description the coding agent receives; it never sees the board. Restate the full requirement in it, including relevant details from the card description and notes.',
].join('\n');

function truncate(value: string, max = MAX_TEXT_CHARS): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function formatCard(card: AutomationCandidateCard): string {
  const lines = [`- id: ${card.id}`, `  list: ${card.listName}`, `  title: ${card.title}`];

  if (card.description?.trim()) {
    lines.push(`  description: ${truncate(card.description.trim())}`);
  }
  if (card.labels?.length) {
    lines.push(`  labels: ${card.labels.join(', ')}`);
  }
  if (card.notes?.length) {
    lines.push(`  notes: ${truncate(card.notes.join(' | '))}`);
  }

  return lines.join('\n');
}

function formatRepo(repo: AutomationCandidateRepo): string {
  const details = [repo.language, repo.description?.trim()].filter(Boolean).join(' — ');
  return details ? `- ${repo.fullName} (${truncate(details, 200)})` : `- ${repo.fullName}`;
}

function parsePlan(raw: string, request: AutomationPlanRequest): AutomationPlan {
  // Models occasionally wrap JSON in a fenced block despite instructions.
  const json = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { decision: 'abstain', reason: 'Planner returned a response that was not valid JSON.' };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { decision: 'abstain', reason: 'Planner returned an unexpected response shape.' };
  }

  const candidate = parsed as Record<string, unknown>;

  if (candidate['decision'] !== 'selected') {
    const reason = candidate['reason'];
    return {
      decision: 'abstain',
      reason:
        typeof reason === 'string' && reason.trim()
          ? reason.trim()
          : 'No card on the board was suitable for autonomous implementation.',
    };
  }

  const cardId = candidate['cardId'];
  const repo = candidate['repo'];
  const task = candidate['task'];
  const rationale = candidate['rationale'];
  const confidence = candidate['confidence'];

  if (
    typeof cardId !== 'string' ||
    typeof repo !== 'string' ||
    typeof task !== 'string' ||
    !task.trim()
  ) {
    return {
      decision: 'abstain',
      reason: 'Planner selected a card but omitted a required field.',
    };
  }

  // Guard against a hallucinated card or repository: acting on either would
  // target something the user never authorized.
  const card = request.cards.find((entry) => entry.id === cardId);
  if (!card) {
    return {
      decision: 'abstain',
      reason: `Planner chose card "${cardId}", which is not on the board.`,
    };
  }

  const matchedRepo = request.repos.find(
    (entry) => entry.fullName.toLowerCase() === repo.toLowerCase(),
  );
  if (!matchedRepo) {
    return {
      decision: 'abstain',
      reason: `Planner chose repository "${repo}", which is not in the allowed list.`,
    };
  }

  const score = typeof confidence === 'number' && Number.isFinite(confidence) ? confidence : 0;
  if (score < AUTOMATION_MIN_CONFIDENCE) {
    return {
      decision: 'abstain',
      reason: `Planner confidence ${score.toFixed(2)} is below the ${AUTOMATION_MIN_CONFIDENCE} threshold for acting autonomously.`,
    };
  }

  return {
    decision: 'selected',
    cardId,
    repo: matchedRepo.fullName,
    task: task.trim(),
    rationale:
      typeof rationale === 'string' && rationale.trim()
        ? rationale.trim()
        : `Selected "${card.title}" from ${card.listName}.`,
    confidence: score,
  };
}

/**
 * Picks the card and repository for one automation run.
 *
 * Deliberately a single structured decision rather than a tool-calling loop: the
 * run is unattended, so a narrow input and a validated output are easier to
 * reason about than an open-ended agent trajectory.
 */
export class AutomationPlannerAgent {
  constructor(
    private readonly modelProvider: ChatProvider,
    private readonly model?: string,
  ) {}

  async plan(request: AutomationPlanRequest): Promise<AutomationPlan> {
    const excluded = new Set(request.excludedCardIds ?? []);
    const cards = request.cards.filter((card) => !excluded.has(card.id)).slice(0, MAX_CARDS);

    if (cards.length === 0) {
      return {
        decision: 'abstain',
        reason: 'No eligible cards on the board.',
      };
    }

    if (request.repos.length === 0) {
      return {
        decision: 'abstain',
        reason: 'No repositories are available to the GitHub connection.',
      };
    }

    const repos = request.repos.slice(0, AUTOMATION_MAX_REPOS);
    const completion = await this.modelProvider.complete({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            `Board: ${request.boardName}`,
            '',
            'Cards:',
            cards.map(formatCard).join('\n'),
            '',
            'Repositories:',
            repos.map(formatRepo).join('\n'),
          ].join('\n'),
        },
      ],
      model: this.model,
    });

    return parsePlan(completion.content ?? '', { ...request, cards, repos });
  }
}
