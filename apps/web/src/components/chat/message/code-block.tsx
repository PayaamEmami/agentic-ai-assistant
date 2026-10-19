'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CheckIcon, CopyIcon } from '@/components/icons';
import { cn } from '@/lib/cn';
import { codeBlockLanguage, codeBlockText, copyableCodeText, isSingleLineCodeBlock } from './code-fence';

const COPIED_MS = 1500;

export function ChatCodeBlock({ children }: { children: ReactNode }) {
  const text = codeBlockText(children);
  const singleLine = isSingleLineCodeBlock(text, codeBlockLanguage(children));
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setCopied(false);
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, [text]);

  const onCopy = () => {
    const writeText = navigator.clipboard?.writeText;
    if (!writeText) {
      return;
    }

    void writeText
      .call(navigator.clipboard, copyableCodeText(text))
      .then(() => {
        setCopied(true);
        if (timerRef.current !== null) {
          window.clearTimeout(timerRef.current);
        }
        timerRef.current = window.setTimeout(() => {
          setCopied(false);
          timerRef.current = null;
        }, COPIED_MS);
      })
      .catch(() => {
        setCopied(false);
      });
  };

  return (
    <div className={cn('chat-code-block', singleLine && 'is-single-line')}>
      <pre className="chat-code-pre">{children}</pre>
      <button
        type="button"
        className={cn('chat-code-copy', copied && 'is-copied')}
        aria-label={copied ? 'Copied' : 'Copy code'}
        title={copied ? 'Copied' : 'Copy'}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onCopy}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
    </div>
  );
}
