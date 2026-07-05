'use client';

import {
  type ChatMessage,
  type CitationContentBlock,
  type MessageContentBlock,
  type ThinkingContentBlock,
  useChatContext,
} from '@/lib/chat';
import { CitationCard } from './citation-card';
import {
  DelayedAssistantReveal,
  MAX_FOLLOWUP_DELAY_MS,
  WORD_FADE_MS,
  WORD_STAGGER_MS,
  countWords,
} from './assistant-text';
import { ContentBlock } from './content-block';
import { ThinkingPanel } from './thinking-panel';

interface MessageProps {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: MessageContentBlock[];
  presentation?: ChatMessage['presentation'];
}

export function Message({ role, content, presentation }: MessageProps) {
  const { pendingApprovals, approvalStatusesByToolExecution, approveAction, rejectAction } =
    useChatContext();
  const isUser = role === 'user';
  const isSystem = role === 'system';
  const isStreaming = role === 'assistant' && Boolean(presentation?.streaming);
  const shouldAnimateAssistantOutput =
    role === 'assistant' && Boolean(presentation?.animateText) && !isStreaming;
  const thinkingBlock = content.find(
    (block): block is ThinkingContentBlock => block.type === 'thinking',
  );
  const visibleContent = content.filter(
    (block) => block.type !== 'citation' && block.type !== 'thinking',
  );
  const statusBlocks = visibleContent.filter(
    (block): block is Extract<MessageContentBlock, { type: 'status' }> => block.type === 'status',
  );
  const primaryContent = visibleContent.filter((block) => block.type !== 'status');
  const hasRenderableText = (block: MessageContentBlock) =>
    block.type === 'text' && block.text.trim().length > 0;
  const hasRenderedText = primaryContent.some(hasRenderableText);
  const renderablePrimaryContent = primaryContent.filter(
    (block) => block.type !== 'text' || block.text.trim().length > 0,
  );
  const citations = content.filter(
    (block): block is CitationContentBlock => block.type === 'citation',
  );
  const assistantTextWordCount = shouldAnimateAssistantOutput
    ? primaryContent.reduce(
        (total, block) => (block.type === 'text' ? total + countWords(block.text) : total),
        0,
      )
    : 0;
  const assistantFollowupDelayMs =
    shouldAnimateAssistantOutput && assistantTextWordCount > 0
      ? Math.min(WORD_FADE_MS + assistantTextWordCount * WORD_STAGGER_MS, MAX_FOLLOWUP_DELAY_MS)
      : 0;
  const pendingApprovalsByToolExecution = new Map(
    pendingApprovals.map((approval) => [approval.toolExecutionId, approval] as const),
  );

  const renderContentBlock = (block: MessageContentBlock, index: number) => (
    <ContentBlock
      key={index}
      block={block}
      role={role}
      shouldAnimateAssistantOutput={shouldAnimateAssistantOutput}
      pendingApprovalsByToolExecution={pendingApprovalsByToolExecution}
      approvalStatusesByToolExecution={approvalStatusesByToolExecution}
      approveAction={approveAction}
      rejectAction={rejectAction}
    />
  );

  const bubbleClassName = isUser
    ? 'max-w-[70%] rounded-lg border border-border bg-surface-overlay px-4 py-2 text-sm text-foreground space-y-2'
    : isSystem
      ? 'max-w-[70%] rounded-lg border border-border-subtle bg-surface-input/70 px-4 py-2 text-sm text-foreground-muted space-y-2'
      : 'max-w-[70%] rounded-lg border border-accent/50 bg-surface-elevated px-4 py-2 text-sm text-foreground space-y-2';

  return (
    <div
      className={`flex ${isUser ? 'justify-end' : isSystem ? 'justify-center' : 'justify-start'}`}
    >
      <div className={bubbleClassName}>
        {role === 'assistant' ? (
          <ThinkingPanel
            block={thinkingBlock}
            activeStage={presentation?.activeStage}
            streaming={isStreaming}
            hasRenderedText={hasRenderedText}
          />
        ) : null}
        {renderablePrimaryContent.length > 0 ? (
          renderablePrimaryContent.map((block, index) => {
            const renderedBlock = renderContentBlock(block, index);

            if (!shouldAnimateAssistantOutput || block.type === 'text') {
              return renderedBlock;
            }

            return (
              <DelayedAssistantReveal key={`followup-${index}`} delayMs={assistantFollowupDelayMs}>
                {renderedBlock}
              </DelayedAssistantReveal>
            );
          })
        ) : statusBlocks.length > 0 && role === 'assistant' ? (
          <p className="text-xs italic text-foreground-muted">No response generated before stop.</p>
        ) : null}
        {citations.length > 0 ? (
          <DelayedAssistantReveal delayMs={assistantFollowupDelayMs}>
            <details className="rounded-lg border border-border-subtle bg-surface-input/60">
              <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-foreground-muted">
                Sources ({citations.length})
              </summary>
              <div className="space-y-2 px-3 pb-3">
                {citations.map((citation, index) => (
                  <CitationCard
                    key={`${citation.sourceId ?? citation.title ?? 'citation'}-${index}`}
                    title={citation.title ?? citation.sourceId ?? 'Source'}
                    excerpt={citation.excerpt ?? 'Citation excerpt unavailable.'}
                    uri={citation.uri}
                  />
                ))}
              </div>
            </details>
          </DelayedAssistantReveal>
        ) : null}
        {statusBlocks.length > 0 ? (
          <DelayedAssistantReveal delayMs={assistantFollowupDelayMs}>
            <div className="border-t border-border-subtle/80 pt-2">
              {statusBlocks.map((block, index) => renderContentBlock(block, index))}
            </div>
          </DelayedAssistantReveal>
        ) : null}
      </div>
    </div>
  );
}
