'use client';

import { useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
  type ChatMessage,
  type CitationContentBlock,
  type MessageContentBlock,
  type ThinkingContentBlock,
  useChatContext,
} from '@/lib/chat';
import { userMessagePlainText } from '@/lib/chat/model';
import { cn } from '@/lib/cn';
import { EditIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Textarea } from '@/components/ui/textarea';
import { CitationCard } from './citation-card';
import {
  DelayedAssistantReveal,
  MAX_FOLLOWUP_DELAY_MS,
  WORD_FADE_MS,
  WORD_STAGGER_MS,
  countWords,
} from './assistant-text';
import { ContentBlock } from './content-block';
import { shouldRevealMessageActions } from './reveal-actions';
import { ThinkingPanel } from './thinking-panel';

interface MessageProps {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: MessageContentBlock[];
  presentation?: ChatMessage['presentation'];
  hasLaterMessages: boolean;
  isEditing: boolean;
  actionsRevealed: boolean;
  onRevealActions: (messageId: string) => void;
  onBeginEdit: (messageId: string) => void;
  onCancelEdit: () => void;
}

export function Message({
  id,
  role,
  content,
  presentation,
  hasLaterMessages,
  isEditing,
  actionsRevealed,
  onRevealActions,
  onBeginEdit,
  onCancelEdit,
}: MessageProps) {
  const {
    pendingApprovals,
    approvalStatusesByToolExecution,
    approveAction,
    rejectAction,
    loading,
    chatModel,
    resendFromMessage,
  } = useChatContext();
  const [draft, setDraft] = useState('');
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
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
    ? 'max-w-full rounded-lg border border-border bg-surface-overlay px-4 py-2 text-sm text-foreground space-y-2'
    : isSystem
      ? 'max-w-[70%] rounded-lg border border-border-subtle bg-surface-input/70 px-4 py-2 text-sm text-foreground-muted space-y-2'
      : 'min-w-0 max-w-[70%] rounded-lg border border-accent/50 bg-surface-elevated px-4 py-2 text-sm text-foreground space-y-2';
  const canEdit =
    isUser && !id.startsWith('local-') && !loading.isSendingMessage && !isEditing;
  const attachmentBlocks = content.filter((block) => block.type !== 'text');

  const beginEdit = () => {
    setDraft(userMessagePlainText(content));
    onBeginEdit(id);
  };

  const rememberPointerStart = (event: ReactPointerEvent) => {
    if (event.pointerType === 'mouse') {
      return;
    }
    pointerStartRef.current = { x: event.clientX, y: event.clientY };
  };

  const revealOnTouchTap = (event: ReactPointerEvent) => {
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if (!start || !canEdit) {
      return;
    }

    const selectedText = window.getSelection()?.toString() ?? '';
    if (
      !shouldRevealMessageActions({
        pointerType: event.pointerType,
        startX: start.x,
        startY: start.y,
        endX: event.clientX,
        endY: event.clientY,
        selectedText,
      })
    ) {
      if (selectedText.trim().length > 0) {
        event.stopPropagation();
      }
      return;
    }

    event.stopPropagation();
    onRevealActions(id);
  };

  const submitEdit = (event: FormEvent) => {
    event.preventDefault();
    const next = draft.trim();
    if (!next) {
      return;
    }
    onCancelEdit();
    void resendFromMessage(id, next, chatModel);
  };

  if (isUser && isEditing) {
    return (
      <div className="flex justify-end">
        <form
          className="w-full max-w-[70%] space-y-2 rounded-lg border border-border bg-surface-overlay px-4 py-2 text-sm text-foreground"
          onSubmit={submitEdit}
        >
          <Textarea
            variant="transparent"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={Math.min(12, Math.max(3, draft.split('\n').length))}
            maxLength={32000}
            autoFocus
            className="w-full px-0 py-0"
            aria-label="Edit message"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                onCancelEdit();
              }
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          {attachmentBlocks.map((block, index) => renderContentBlock(block, index))}
          {hasLaterMessages ? (
            <p className="text-xs text-foreground-muted">
              Sending removes the messages after this one.
            </p>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={onCancelEdit}>
              Cancel
            </Button>
            <Button size="sm" type="submit" disabled={!draft.trim()}>
              Send
            </Button>
          </div>
        </form>
      </div>
    );
  }

  const bubble = (
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
  );

  if (!isUser) {
    return (
      <div className={`flex ${isSystem ? 'justify-center' : 'justify-start'}`}>{bubble}</div>
    );
  }

  return (
    <div
      className="flex select-text justify-end"
      data-user-message=""
      onPointerDown={rememberPointerStart}
      onPointerUp={revealOnTouchTap}
      onPointerCancel={() => {
        pointerStartRef.current = null;
      }}
    >
      <div
        className={`group relative max-w-[70%] ${
          canEdit
            ? "before:absolute before:inset-y-0 before:right-full before:w-12 before:content-['']"
            : ''
        }`}
      >
        {canEdit ? (
          <div
            className={cn(
              'absolute right-[calc(100%+0.5rem)] top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center transition',
              actionsRevealed
                ? 'pointer-events-auto opacity-100'
                : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100',
            )}
          >
            <IconButton size="sm" onClick={beginEdit} title="Edit message" aria-label="Edit message">
              <EditIcon />
            </IconButton>
          </div>
        ) : null}
        {bubble}
      </div>
    </div>
  );
}
