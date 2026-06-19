'use client';

import { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const markdownComponents: Components = {
  p: ({ children }) => <p className="leading-relaxed break-words">{children}</p>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-accent underline underline-offset-2 hover:opacity-80 break-words"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => (
    <ul className="list-disc space-y-1 pl-5 leading-relaxed">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal space-y-1 pl-5 leading-relaxed">{children}</ol>
  ),
  li: ({ children }) => <li className="break-words">{children}</li>,
  h1: ({ children }) => (
    <h1 className="mt-1 text-base font-semibold leading-snug">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-1 text-base font-semibold leading-snug">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-1 text-sm font-semibold leading-snug">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-1 text-sm font-semibold leading-snug">{children}</h4>
  ),
  h5: ({ children }) => (
    <h5 className="mt-1 text-sm font-semibold leading-snug">{children}</h5>
  ),
  h6: ({ children }) => (
    <h6 className="mt-1 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
      {children}
    </h6>
  ),
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-border-subtle pl-3 text-foreground-muted">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-border-subtle" />,
  code: ({ className, children, ...props }) => {
    const isBlock = typeof className === 'string' && className.includes('language-');
    if (isBlock) {
      return (
        <code className={`${className ?? ''} font-mono`} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code
        className="rounded bg-surface-input px-1 py-0.5 font-mono text-[0.85em]"
        {...props}
      >
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="overflow-x-auto rounded border border-border bg-surface-input p-3 text-xs">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead>{children}</thead>,
  th: ({ children }) => (
    <th className="border border-border px-2 py-1 text-left font-semibold">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border border-border px-2 py-1 align-top">{children}</td>
  ),
};

function MarkdownImpl({ children }: { children: string }) {
  return (
    <div className="min-w-0 space-y-2 break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(MarkdownImpl);
