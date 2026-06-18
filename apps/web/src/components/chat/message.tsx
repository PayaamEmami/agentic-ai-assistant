'use client';

import { useState } from 'react';
import {
  type AssistantStage,
  type ChatMessage,
  type CitationContentBlock,
  type MessageContentBlock,
  type ThinkingContentBlock,
  useChatContext,
} from '@/lib/chat';
import { Badge } from '@/components/ui/badge';
import { CitationCard } from './citation-card';

const WORD_FADE_MS = 380;
const WORD_STAGGER_MS = 34;
const MAX_FOLLOWUP_DELAY_MS = 2400;

const STAGE_LABELS: Record<AssistantStage, string> = {
  routing: 'Routing the request',
  retrieving: 'Searching your knowledge',
  research: 'Researching',
  tool: 'Planning tools',
  coding: 'Working through code',
  answering: 'Writing the answer',
  verifying: 'Verifying the answer',
  done: 'Done',
};

function stageLabel(stage: string): string {
  return STAGE_LABELS[stage as AssistantStage] ?? stage;
}

function ThinkingPanel({
  block,
  activeStage,
  streaming,
  hasRenderedText,
}: {
  block?: ThinkingContentBlock;
  activeStage?: AssistantStage;
  streaming?: boolean;
  hasRenderedText?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const segments = block?.segments ?? [];
  const hasSegments = segments.length > 0;

  // Live stream: a single muted, borderless indicator. Once the answer is
  // flowing and there is nothing to reveal, drop it so it doesn't linger.
  if (streaming) {
    if (!hasSegments && hasRenderedText) {
      return null;
    }

    const label = activeStage && activeStage !== 'done' ? stageLabel(activeStage) : 'Thinking';

    return (
      <div className="space-y-1.5 text-foreground-muted">
        <div className="flex items-center gap-2 text-xs font-medium">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
          <span>{label}</span>
        </div>
        {hasSegments ? (
          <div className="space-y-1.5 text-xs leading-relaxed text-foreground-muted/80">
            {segments.map((segment, index) => (
              <p key={`${segment.stage}-${index}`} className="whitespace-pre-wrap">
                {segment.text}
              </p>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  // Settled: only show the toggle when there were real thoughts to reveal.
  if (!hasSegments) {
    return null;
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex items-center gap-1.5 text-xs font-medium text-foreground-muted transition-colors hover:text-foreground"
        aria-expanded={expanded}
      >
        <svg
          viewBox="0 0 12 12"
          aria-hidden="true"
          className={`h-3 w-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
        >
          <path
            d="M4 2l4 4-4 4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span>Thoughts</span>
      </button>
      {expanded ? (
        <div className="space-y-2 border-b border-border-subtle pb-2">
          {segments.map((segment, index) => (
            <div key={`${segment.stage}-${index}`} className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted/80">
                {stageLabel(segment.stage)}
              </p>
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground-muted">
                {segment.text}
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface MessageProps {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: MessageContentBlock[];
  presentation?: ChatMessage['presentation'];
}

function stringify(value: unknown) {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function getToolStatusLabel(status: string | undefined): string {
  switch (status) {
    case 'planned':
      return 'Planned by model';
    case 'approved':
      return 'Approved';
    case 'rejected':
      return 'Declined';
    case 'running':
      return 'Currently running';
    case 'pending':
      return 'Waiting for approval';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    default:
      return 'Unknown';
  }
}

function getToolStatusVariant(status: string | undefined): 'neutral' | 'accent' | 'success' | 'error' | 'warning' {
  switch (status) {
    case 'planned':
      return 'accent';
    case 'approved':
      return 'success';
    case 'rejected':
      return 'error';
    case 'running':
      return 'warning';
    case 'pending':
      return 'neutral';
    case 'completed':
      return 'success';
    case 'failed':
      return 'error';
    default:
      return 'neutral';
  }
}

function getDisplayToolStatus(
  status: string | undefined,
  approvalStatus: string | undefined,
): string | undefined {
  if (
    approvalStatus &&
    (status === 'pending' || status === 'planned') &&
    approvalStatus !== 'expired'
  ) {
    return approvalStatus;
  }

  return status;
}

function splitTextTokens(text: string) {
  return text.match(/\S+|\s+/g) ?? [];
}

function countWords(text: string) {
  return text.match(/\S+/g)?.length ?? 0;
}

function WordFadeText({ text }: { text: string }) {
  const tokens = splitTextTokens(text);
  let wordIndex = 0;

  return (
    <>
      {tokens.map((token, index) => {
        if (/^\s+$/.test(token)) {
          return <span key={`space-${index}`}>{token}</span>;
        }

        const animationDelay = Math.min(wordIndex * WORD_STAGGER_MS, MAX_FOLLOWUP_DELAY_MS);
        wordIndex += 1;

        return (
          <span
            key={`word-${index}-${token}`}
            className="voice-word-fade inline-block"
            style={{ animationDelay: `${animationDelay}ms` }}
          >
            {token}
          </span>
        );
      })}
    </>
  );
}

function DelayedAssistantReveal({
  children,
  delayMs,
}: {
  children: React.ReactNode;
  delayMs: number;
}) {
  if (delayMs <= 0) {
    return children;
  }

  return (
    <div className="assistant-followup-reveal" style={{ animationDelay: `${delayMs}ms` }}>
      {children}
    </div>
  );
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
  const hasRenderedText = primaryContent.some(
    (block) => block.type === 'text' && block.text.trim().length > 0,
  );
  const citations = content.filter(
    (block): block is CitationContentBlock => block.type === 'citation',
  );
  const assistantTextWordCount =
    shouldAnimateAssistantOutput
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

  const renderContentBlock = (block: MessageContentBlock, index: number) => {
    if (block.type === 'text') {
      return (
        <p key={index} className="whitespace-pre-wrap leading-relaxed">
          {shouldAnimateAssistantOutput ? <WordFadeText text={block.text} /> : block.text}
        </p>
      );
    }

    if (block.type === 'attachment_ref') {
      const label =
        block.attachmentKind === 'image'
          ? 'Image'
          : block.attachmentKind === 'document'
            ? 'Document'
            : block.attachmentKind === 'audio'
              ? 'Audio'
              : 'File';

      return (
        <div
          key={index}
          className="rounded border border-border bg-surface-input px-3 py-2 text-xs text-foreground-muted"
        >
          [{label}] {block.fileName ?? block.attachmentId ?? 'attachment'}
          {block.indexedForRag ? ' - indexed for RAG' : ''}
        </div>
      );
    }

    if (block.type === 'tool_result') {
      const approval = block.toolExecutionId
        ? pendingApprovalsByToolExecution.get(block.toolExecutionId)
        : undefined;
      const displayStatus = getDisplayToolStatus(
        block.status,
        block.toolExecutionId ? approvalStatusesByToolExecution[block.toolExecutionId] : undefined,
      );

      return (
        <div key={index} className="rounded border border-border bg-surface-input p-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-foreground">
              Tool: {block.toolName ?? block.toolExecutionId ?? 'tool_result'}
            </p>
            <Badge variant={getToolStatusVariant(displayStatus)} className="text-[11px]">
              {getToolStatusLabel(displayStatus)}
            </Badge>
          </div>
          {displayStatus === 'pending' && approval ? (
            <div className="mt-2">
              <p className="text-xs text-foreground-muted">{approval.description}</p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => void approveAction(approval.id)}
                  className="rounded bg-success px-3 py-1 text-xs font-medium text-white hover:opacity-90"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => void rejectAction(approval.id)}
                  className="rounded bg-error px-3 py-1 text-xs font-medium text-white hover:opacity-90"
                >
                  Reject
                </button>
              </div>
            </div>
          ) : null}
          {displayStatus === 'approved' ? (
            <p className="mt-2 text-xs text-foreground-muted">
              Approved. Live execution updates appear below.
            </p>
          ) : null}
          {displayStatus === 'rejected' ? (
            <p className="mt-2 text-xs text-foreground-muted">
              Declined. This tool run will not execute.
            </p>
          ) : null}
          {block.detail ? (
            <p className="mt-2 text-xs text-foreground-muted">{block.detail}</p>
          ) : null}
          {typeof block.output === 'undefined' ? null : (
            <pre className="mt-2 overflow-x-auto text-xs text-foreground">
              {stringify(block.output)}
            </pre>
          )}
        </div>
      );
    }

    if (block.type === 'transcript') {
      return (
        <p key={index} className="text-xs italic text-foreground-muted">
          Transcript: {block.text}
        </p>
      );
    }

    if (block.type === 'status') {
      return (
        <div
          key={index}
          className="inline-flex items-center gap-2 text-xs font-medium text-foreground-muted"
        >
          <span className="h-2 w-2 rounded-full bg-warning" />
          <span>{block.label ?? 'Response stopped'}</span>
        </div>
      );
    }

    return (
      <pre key={index} className="overflow-x-auto text-xs text-foreground-muted">
        {stringify(block)}
      </pre>
    );
  };

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
        {primaryContent.length > 0 ? (
          primaryContent.map((block, index) => {
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
              {statusBlocks.map(renderContentBlock)}
            </div>
          </DelayedAssistantReveal>
        ) : null}
      </div>
    </div>
  );
}
