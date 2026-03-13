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
      return 'bg-blue-100 text-blue-700';
    case 'running':
      return 'bg-yellow-100 text-yellow-700';
    case 'pending':
      return 'bg-gray-100 text-gray-700';
    case 'completed':
      return 'bg-green-100 text-green-700';
    case 'failed':
      return 'bg-red-100 text-red-700';
    default:
      return 'bg-gray-100 text-gray-600';
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

  if (block.type === 'image_ref') {
    return (
      <div key={index} className="rounded border border-gray-300 bg-gray-50 px-3 py-2 text-xs text-gray-600">
        [Image] {block.fileName ?? block.attachmentId ?? 'attachment'}
      </div>
    );
  }

  if (block.type === 'tool_result') {
    return (
      <div key={index} className="rounded border border-gray-300 bg-gray-50 p-2">
        <div className="mb-1 flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-gray-700">
            Tool: {block.toolName ?? block.toolExecutionId ?? 'tool_result'}
          </p>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${getToolStatusClass(block.status)}`}>
            {getToolStatusLabel(block.status)}
          </span>
        </div>
        {typeof block.output === 'undefined' ? null : (
          <pre className="overflow-x-auto text-xs text-gray-800">{stringify(block.output)}</pre>
        )}
      </div>
    );
  }

  if (block.type === 'citation') {
    return (
      <blockquote key={index} className="border-l-2 border-gray-300 pl-3 text-xs italic text-gray-700">
        {block.excerpt ?? 'Citation excerpt unavailable.'}
      </blockquote>
    );
  }

  if (block.type === 'transcript') {
    return (
      <p key={index} className="text-xs italic text-gray-700">
        Transcript: {block.text}
      </p>
    );
  }

  return (
    <pre key={index} className="overflow-x-auto text-xs text-gray-700">
      {stringify(block)}
    </pre>
  );
}

export function Message({ role, content }: MessageProps) {
  const isUser = role === 'user';
  const bubbleClassName = `max-w-[70%] rounded-lg px-4 py-2 text-sm ${
    isUser ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-900'
  } ${isUser ? '' : 'space-y-2'}`;

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={bubbleClassName}>
        {content.map(renderContentBlock)}
      </div>
    </div>
  );
}
