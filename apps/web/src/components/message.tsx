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
        <p className="mb-1 text-xs font-medium text-gray-700">
          Tool: {block.toolName ?? block.toolExecutionId ?? 'tool_result'}
        </p>
        <pre className="overflow-x-auto text-xs text-gray-800">{stringify(block.output)}</pre>
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
