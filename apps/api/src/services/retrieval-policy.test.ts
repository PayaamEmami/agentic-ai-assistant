import { describe, expect, it } from 'vitest';
import { decideRetrieval } from './retrieval-policy.js';

const noMessages: Parameters<typeof decideRetrieval>[1] = [];

describe('decideRetrieval', () => {
  it('skips empty content and small talk', () => {
    expect(decideRetrieval('   ', noMessages)).toMatchObject({
      shouldRetrieve: false,
      reason: 'empty_message',
    });
    expect(decideRetrieval('hello!', noMessages)).toMatchObject({
      shouldRetrieve: false,
      reason: 'small_talk',
    });
  });

  it('retrieves when the request mentions connected apps or documents', () => {
    expect(decideRetrieval('Search my Google Drive sources', noMessages)).toMatchObject({
      shouldRetrieve: true,
      reason: 'app_or_source_hint',
    });
    expect(decideRetrieval('summarize my resume', noMessages)).toMatchObject({
      shouldRetrieve: true,
      reason: 'document_hint',
    });
    expect(decideRetrieval('review README.md', noMessages)).toMatchObject({
      shouldRetrieve: true,
      reason: 'document_hint',
    });
  });

  it('retrieves short citation follow-ups when recent assistant citations exist', () => {
    const messages = [
      {
        role: 'assistant',
        content: [{ type: 'citation', sourceId: 'source-1' }],
      },
    ];

    expect(decideRetrieval('which one is newer?', messages)).toMatchObject({
      shouldRetrieve: true,
      reason: 'citation_follow_up',
      hasRecentCitationContext: true,
    });
  });
});
