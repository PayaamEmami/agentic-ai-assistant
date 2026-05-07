'use client';

import {
  type ChatMessage,
  type CitationContentBlock,
  type MessageContentBlock,
  useChatContext,
} from '@/lib/chat-context';
import { CitationCard } from './citation-card';

const WORD_FADE_MS = 380;
const WORD_STAGGER_MS = 34;
const MAX_FOLLOWUP_DELAY_MS = 2400;

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

function getToolStatusClass(status: string | undefined): string {
  switch (status) {
    case 'planned':
      return 'bg-accent/20 text-accent';
    case 'approved':
      return 'bg-success/20 text-success';
    case 'rejected':
      return 'bg-error/20 text-error';
    case 'running':
      return 'bg-warning/20 text-warning';
    case 'pending':
      return 'bg-surface-input text-foreground-muted';
    case 'completed':
      return 'bg-success/20 text-success';
    case 'failed':
      return 'bg-error/20 text-error';
    default:
      return 'bg-surface-input text-foreground-inactive';
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
  const shouldAnimateAssistantOutput = role === 'assistant' && Boolean(presentation?.animateText);
  const visibleContent = content.filter((block) => block.type !== 'citation');
  const statusBlocks = visibleContent.filter(
    (block): block is Extract<MessageContentBlock, { type: 'status' }> => block.type === 'status',
  );
  const primaryContent = visibleContent.filter((block) => block.type !== 'status');
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
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${getToolStatusClass(displayStatus)}`}
            >
              {getToolStatusLabel(displayStatus)}
            </span>
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
    ? 'max-w-[70%] rounded-lg bg-accent px-4 py-2 text-sm text-white'
    : isSystem
      ? 'max-w-[70%] rounded-lg border border-border-subtle bg-surface-input/70 px-4 py-2 text-sm text-foreground-muted space-y-2'
      : 'max-w-[70%] rounded-lg border border-border bg-surface-overlay px-4 py-2 text-sm text-foreground space-y-2';

  return (
    <div
      className={`flex ${isUser ? 'justify-end' : isSystem ? 'justify-center' : 'justify-start'}`}
    >
      <div className={bubbleClassName}>
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
