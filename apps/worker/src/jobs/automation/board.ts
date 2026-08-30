import type { AutomationCandidateCard } from '@aaa/ai';

/**
 * Shapes returned by the task tool's `tasks_get_board` MCP tool. Kept narrow and
 * defensive: the tool lives in a separate repository and deploys independently,
 * so unexpected fields are ignored rather than trusted.
 */
interface RawCard {
  id?: unknown;
  title?: unknown;
  description?: unknown;
  completed?: unknown;
}

interface RawList {
  listId?: unknown;
  name?: unknown;
  cards?: unknown;
}

export interface ParsedBoard {
  boardId: string;
  name: string;
  lists: Array<{ listId: string; name: string; cards: AutomationCandidateCard[] }>;
}

/** Notes appended by previous runs are separated by this marker in descriptions. */
const NOTE_SEPARATOR = '\n\n---\n\n';

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseCard(raw: unknown, listName: string): AutomationCandidateCard | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }

  const card = raw as RawCard;
  const id = asString(card.id);
  const title = asString(card.title);
  if (!id || !title) {
    return null;
  }

  if (card.completed === true) {
    return null;
  }

  const rawDescription = asString(card.description);
  const segments = rawDescription ? rawDescription.split(NOTE_SEPARATOR) : [];

  return {
    id,
    title,
    listName,
    description: segments[0],
    notes: segments.slice(1),
  };
}

/**
 * `callTool` returns `{ content, data, isError }`. Board fields live on `data`.
 * Accept either the unwrapped payload or the full MCP result so callers cannot
 * accidentally parse the wrapper.
 */
function unwrapBoardPayload(result: unknown): unknown {
  if (typeof result !== 'object' || result === null) {
    return result;
  }

  const record = result as { data?: unknown; boardId?: unknown };
  if (record.boardId === undefined && 'data' in record) {
    return record.data;
  }

  return result;
}

export function parseBoard(result: unknown): ParsedBoard | null {
  const payload = unwrapBoardPayload(result);
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }

  const board = payload as { boardId?: unknown; name?: unknown; lists?: unknown };
  const boardId = asString(board.boardId);
  if (!boardId) {
    return null;
  }

  const rawLists = Array.isArray(board.lists) ? board.lists : [];
  const lists = rawLists.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      return [];
    }

    const list = entry as RawList;
    const listId = asString(list.listId);
    if (!listId) {
      return [];
    }

    const name = asString(list.name) ?? listId;
    const cards = (Array.isArray(list.cards) ? list.cards : [])
      .map((card) => parseCard(card, name))
      .filter((card): card is AutomationCandidateCard => card !== null);

    return [{ listId, name, cards }];
  });

  return { boardId, name: asString(board.name) ?? boardId, lists };
}

/**
 * Cards the planner may choose from. When a source list is configured only that
 * list is considered; otherwise every list is fair game except ones that clearly
 * hold finished or in-flight work.
 */
const EXCLUDED_LIST_PATTERNS = [/\bdone\b/i, /\bcomplete/i, /\bshipped\b/i, /in review/i, /\bblocked\b/i];

export function selectCandidateCards(
  board: ParsedBoard,
  sourceListId: string | null,
): AutomationCandidateCard[] {
  if (sourceListId) {
    return board.lists.find((list) => list.listId === sourceListId)?.cards ?? [];
  }

  return board.lists
    .filter((list) => !EXCLUDED_LIST_PATTERNS.some((pattern) => pattern.test(list.name)))
    .flatMap((list) => list.cards);
}

/** The list a card should move to once a pull request exists, if the board has one. */
export function findReviewList(board: ParsedBoard): { listId: string; name: string } | null {
  const match =
    board.lists.find((list) => /\bin review\b/i.test(list.name)) ??
    board.lists.find((list) => /^review$/i.test(list.name.trim()));
  return match ? { listId: match.listId, name: match.name } : null;
}
