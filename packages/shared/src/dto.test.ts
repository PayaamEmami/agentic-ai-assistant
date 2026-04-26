import { describe, expect, it } from 'vitest';
import {
  ApprovalDecisionRequest,
  AuthCredentialsRequest,
  RegisterRequest,
  SendMessageRequest,
  UpdateConversationRequest,
  UploadAttachmentResponse,
  VoiceTurnRequest,
} from './dto.js';

const userId = '11111111-1111-4111-8111-111111111111';
const conversationId = '22222222-2222-4222-8222-222222222222';
const attachmentId = '33333333-3333-4333-8333-333333333333';

describe('DTO schemas', () => {
  it('validates authentication request boundaries', () => {
    expect(
      AuthCredentialsRequest.parse({
        email: 'user@example.com',
        password: 'correct horse battery staple',
      }),
    ).toEqual({
      email: 'user@example.com',
      password: 'correct horse battery staple',
    });

    expect(() =>
      AuthCredentialsRequest.parse({ email: 'not-an-email', password: 'short' }),
    ).toThrow();
    expect(() =>
      RegisterRequest.parse({
        email: 'user@example.com',
        password: 'password123',
        displayName: '',
      }),
    ).toThrow();
  });

  it('validates send message payloads', () => {
    expect(
      SendMessageRequest.parse({
        conversationId,
        content: 'Summarize this',
        attachmentIds: [attachmentId],
        clientRunId: userId,
      }),
    ).toEqual({
      conversationId,
      content: 'Summarize this',
      attachmentIds: [attachmentId],
      clientRunId: userId,
    });

    expect(() => SendMessageRequest.parse({ content: '' })).toThrow();
    expect(() => SendMessageRequest.parse({ content: 'ok', attachmentIds: ['bad-id'] })).toThrow();
  });

  it('validates approval decisions and update conversation requests', () => {
    expect(ApprovalDecisionRequest.parse({ status: 'approved' })).toEqual({ status: 'approved' });
    expect(ApprovalDecisionRequest.parse({ status: 'rejected' })).toEqual({ status: 'rejected' });
    expect(UpdateConversationRequest.parse({ title: '  Quarterly planning  ' })).toEqual({
      title: 'Quarterly planning',
    });

    expect(() => ApprovalDecisionRequest.parse({ status: 'expired' })).toThrow();
    expect(() => UpdateConversationRequest.parse({ title: '   ' })).toThrow();
  });

  it('validates upload response shape', () => {
    expect(
      UploadAttachmentResponse.parse({
        attachmentId,
        fileName: 'notes.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        kind: 'document',
        indexedForRag: true,
        documentId: conversationId,
      }),
    ).toMatchObject({
      attachmentId,
      kind: 'document',
      indexedForRag: true,
    });

    expect(() =>
      UploadAttachmentResponse.parse({
        attachmentId,
        fileName: 'notes.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        kind: 'video',
        indexedForRag: true,
      }),
    ).toThrow();
  });

  it('validates voice turn transcript requirements', () => {
    expect(
      VoiceTurnRequest.parse({
        conversationId,
        userTranscript: 'What changed?',
        assistantTranscript: 'Here is the summary.',
      }),
    ).toEqual({
      conversationId,
      userTranscript: 'What changed?',
      assistantTranscript: 'Here is the summary.',
    });

    expect(() =>
      VoiceTurnRequest.parse({ userTranscript: '   ', assistantTranscript: 'answer' }),
    ).toThrow();
    expect(() =>
      VoiceTurnRequest.parse({ userTranscript: 'question', assistantTranscript: '   ' }),
    ).toThrow();
  });
});
