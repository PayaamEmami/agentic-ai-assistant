import { attachmentRepository } from '@aaa/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getLatestUserRequestText, toAgentHistoryMessages } from './history.js';

vi.mock('@aaa/db', () => ({
  attachmentRepository: {
    findByIdsForUser: vi.fn(),
    findById: vi.fn(),
  },
}));

const findByIdsForUser = vi.mocked(attachmentRepository.findByIdsForUser);
const pdfBytes = Buffer.from('%PDF-1.4');

function storedAttachment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'file-1',
    userId: 'user-1',
    messageId: null,
    documentId: null,
    kind: 'file',
    fileName: 'notes.pdf',
    mimeType: 'application/pdf',
    sizeBytes: pdfBytes.byteLength,
    data: pdfBytes,
    textContent: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function userMessageWithAttachment() {
  return {
    role: 'user',
    content: [
      { type: 'text', text: 'Summarize this' },
      { type: 'attachment_ref', attachmentId: 'file-1' },
    ],
  };
}

describe('getLatestUserRequestText', () => {
  it('returns text from the latest user message', () => {
    const messages = [
      {
        role: 'user',
        content: [{ type: 'text', text: 'first request' }],
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'response' }],
      },
      {
        role: 'user',
        content: [{ type: 'transcript', text: 'latest request' }],
      },
    ];

    expect(getLatestUserRequestText(messages as never)).toBe('latest request');
  });

  it('includes terminal tool summaries when latest user message is absent', () => {
    expect(getLatestUserRequestText([{ role: 'assistant', content: [] }] as never)).toBe('');
  });
});

describe('toAgentHistoryMessages PDF attachments', () => {
  beforeEach(() => {
    findByIdsForUser.mockReset();
  });

  it('sends a PDF as a label plus the stored bytes', async () => {
    findByIdsForUser.mockResolvedValue([storedAttachment()] as never);

    const [message] = await toAgentHistoryMessages([userMessageWithAttachment()] as never, 'user-1');

    expect(message?.content).toEqual([
      { type: 'text', text: 'Summarize this' },
      { type: 'text', text: 'Attached file "notes.pdf" (application/pdf).' },
      {
        type: 'input_file',
        fileName: 'notes.pdf',
        mimeType: 'application/pdf',
        fileData: `data:application/pdf;base64,${pdfBytes.toString('base64')}`,
      },
    ]);
  });

  it('treats a .pdf with a generic mime type as a PDF', async () => {
    findByIdsForUser.mockResolvedValue([
      storedAttachment({ mimeType: 'application/octet-stream' }),
    ] as never);

    const [message] = await toAgentHistoryMessages([userMessageWithAttachment()] as never, 'user-1');

    expect(message?.content).toEqual([
      { type: 'text', text: 'Summarize this' },
      { type: 'text', text: 'Attached file "notes.pdf" (application/pdf).' },
      expect.objectContaining({ type: 'input_file', mimeType: 'application/pdf' }),
    ]);
  });

  it('leaves a non-PDF file as a note that its contents are not inlined', async () => {
    findByIdsForUser.mockResolvedValue([
      storedAttachment({ fileName: 'archive.zip', mimeType: 'application/zip' }),
    ] as never);

    const [message] = await toAgentHistoryMessages([userMessageWithAttachment()] as never, 'user-1');

    expect(message?.content).toEqual([
      { type: 'text', text: 'Summarize this' },
      {
        type: 'text',
        text: 'Attached file "archive.zip" (application/zip, attachmentId=file-1)\n\nThis file is available to tools, but its contents are not inlined in the prompt.',
      },
    ]);
  });
});
