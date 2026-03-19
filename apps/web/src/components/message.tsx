'use client';

import type { MessageContentBlock } from '@/lib/chat-context';

interface MessageProps {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: MessageContentBlock[];
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

function renderContentBlock(block: MessageContentBlock, index: number) {
  if (block.type === 'text') {
    return (
      <p key={index} className="whitespace-pre-wrap leading-relaxed">
        {block.text}
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
      <div key={index} className="rounded border border-border bg-surface-input px-3 py-2 text-xs text-foreground-muted">
        [{label}] {block.fileName ?? block.attachmentId ?? 'attachment'}
        {block.indexedForRag ? ' • indexed for RAG' : ''}
      </div>
    );
  }

  if (block.type === 'tool_result') {
    return (
      <div key={index} className="rounded border border-border bg-surface-input p-2">
        <div className="mb-1 flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-foreground">
            Tool: {block.toolName ?? block.toolExecutionId ?? 'tool_result'}
          </p>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${getToolStatusClass(block.status)}`}>
            {getToolStatusLabel(block.status)}
          </span>
        </div>
        {typeof block.output === 'undefined' ? null : (
          <pre className="overflow-x-auto text-xs text-foreground">{stringify(block.output)}</pre>
        )}
      </div>
    );
  }

  if (block.type === 'citation') {
    return (
      <blockquote key={index} className="border-l-2 border-border pl-3 text-xs italic text-foreground-muted">
        {block.excerpt ?? 'Citation excerpt unavailable.'}
      </blockquote>
    );
  }

  if (block.type === 'transcript') {
    return (
      <p key={index} className="text-xs italic text-foreground-muted">
        Transcript: {block.text}
      </p>
    );
  }

  return (
    <pre key={index} className="overflow-x-auto text-xs text-foreground-muted">
      {stringify(block)}
    </pre>
  );
}

export function Message({ role, content }: MessageProps) {
  const isUser = role === 'user';
  const bubbleClassName = `max-w-[70%] rounded-lg px-4 py-2 text-sm ${
    isUser ? 'bg-accent text-white' : 'bg-surface-overlay border border-border text-foreground'
  } ${isUser ? '' : 'space-y-2'}`;

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={bubbleClassName}>
        {content.map(renderContentBlock)}
      </div>
    </div>
  );
}
