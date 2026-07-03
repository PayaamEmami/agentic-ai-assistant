'use client';

import type { ReactNode } from 'react';

export const WORD_FADE_MS = 380;
export const WORD_STAGGER_MS = 34;
export const MAX_FOLLOWUP_DELAY_MS = 2400;

function splitTextTokens(text: string) {
  return text.match(/\S+|\s+/g) ?? [];
}

export function countWords(text: string) {
  return text.match(/\S+/g)?.length ?? 0;
}

export function WordFadeText({ text }: { text: string }) {
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

export function DelayedAssistantReveal({
  children,
  delayMs,
}: {
  children: ReactNode;
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
