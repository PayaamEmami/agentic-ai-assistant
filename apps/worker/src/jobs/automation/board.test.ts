import { describe, expect, it } from 'vitest';
import { findReviewList, parseBoard, selectCandidateCards } from './board.js';

const boardPayload = {
  boardId: 'AGENDA',
  name: 'Agenda',
  lists: [
    {
      listId: 'TODO',
      name: 'To Do',
      cards: [{ id: 'card-1', title: 'Ship it', completed: false }],
    },
    { listId: 'REVIEW', name: 'In Review', cards: [] },
    { listId: 'PREVIEW', name: 'Preview', cards: [] },
  ],
};

describe('parseBoard', () => {
  it('reads an unwrapped board payload', () => {
    const board = parseBoard(boardPayload);
    expect(board?.boardId).toBe('AGENDA');
    expect(board?.lists).toHaveLength(3);
    expect(board?.lists[0]?.cards[0]?.title).toBe('Ship it');
  });

  it('unwraps an MCP callTool result whose fields live on data', () => {
    const board = parseBoard({
      content: [{ type: 'text', text: '{}' }],
      isError: false,
      data: boardPayload,
    });
    expect(board?.boardId).toBe('AGENDA');
    expect(board?.name).toBe('Agenda');
  });

  it('returns null for a wrapper with no board payload', () => {
    expect(parseBoard({ content: [], isError: false })).toBeNull();
    expect(parseBoard(null)).toBeNull();
  });
});

describe('findReviewList', () => {
  it('prefers an In Review list and does not match Preview', () => {
    const board = parseBoard(boardPayload)!;
    expect(findReviewList(board)).toEqual({ listId: 'REVIEW', name: 'In Review' });
  });

  it('matches a list named exactly Review', () => {
    const board = parseBoard({
      boardId: 'AGENDA',
      lists: [{ listId: 'R', name: 'Review', cards: [] }],
    });
    expect(findReviewList(board!)).toEqual({ listId: 'R', name: 'Review' });
  });
});

describe('selectCandidateCards', () => {
  it('excludes review lists when no source list is configured', () => {
    const board = parseBoard(boardPayload)!;
    expect(selectCandidateCards(board, null).map((card) => card.id)).toEqual(['card-1']);
  });
});
