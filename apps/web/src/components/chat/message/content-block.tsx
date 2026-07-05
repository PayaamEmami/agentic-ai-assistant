'use client';

import type { MessageContentBlock } from '@/lib/chat';
import type { ApprovalStatusByToolExecution, PendingApproval } from '@/lib/chat/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Markdown } from '../markdown';
import { WordFadeText } from './assistant-text';
import {
  getDisplayToolStatus,
  getToolStatusLabel,
  getToolStatusVariant,
  stringify,
} from './tool-status';

export interface ContentBlockProps {
  block: MessageContentBlock;
  role: 'user' | 'assistant' | 'system' | 'tool';
  shouldAnimateAssistantOutput: boolean;
  pendingApprovalsByToolExecution: Map<string, PendingApproval>;
  approvalStatusesByToolExecution: ApprovalStatusByToolExecution;
  approveAction: (approvalId: string) => Promise<void>;
  rejectAction: (approvalId: string) => Promise<void>;
}

export function ContentBlock({
  block,
  role,
  shouldAnimateAssistantOutput,
  pendingApprovalsByToolExecution,
  approvalStatusesByToolExecution,
  approveAction,
  rejectAction,
}: ContentBlockProps) {
  if (block.type === 'text') {
    if (shouldAnimateAssistantOutput) {
      return (
        <p className="whitespace-pre-wrap leading-relaxed">
          <WordFadeText text={block.text} />
        </p>
      );
    }

    if (role === 'assistant') {
      return <Markdown>{block.text}</Markdown>;
    }

    return <p className="whitespace-pre-wrap leading-relaxed">{block.text}</p>;
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
      <div className="rounded border border-border bg-surface-input px-3 py-2 text-xs text-foreground-muted">
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
      <div className="rounded border border-border bg-surface-input p-2">
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
              <Button size="sm" variant="success" onClick={() => void approveAction(approval.id)}>
                Approve
              </Button>
              <Button size="sm" variant="danger" onClick={() => void rejectAction(approval.id)}>
                Reject
              </Button>
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
      <p className="text-xs italic text-foreground-muted">Transcript: {block.text}</p>
    );
  }

  if (block.type === 'status') {
    return (
      <div className="inline-flex items-center gap-2 text-xs font-medium text-foreground-muted">
        <span className="h-2 w-2 rounded-full bg-warning" />
        <span>{block.label ?? 'Response stopped'}</span>
      </div>
    );
  }

  return (
    <pre className="overflow-x-auto text-xs text-foreground-muted">{stringify(block)}</pre>
  );
}
