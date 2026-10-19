import { isValidElement, type ReactNode } from 'react';

const LANGUAGE_CLASS = /(?:^|\s)language-([^\s]+)/;

export function codeBlockText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map((child) => codeBlockText(child)).join('');
  }

  if (isValidElement<{ children?: ReactNode }>(node)) {
    return codeBlockText(node.props.children);
  }

  return '';
}

export function codeBlockLanguage(node: ReactNode): string | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const language = codeBlockLanguage(child);
      if (language) {
        return language;
      }
    }
    return null;
  }

  if (!isValidElement<{ className?: unknown }>(node)) {
    return null;
  }

  const { className } = node.props;
  if (typeof className !== 'string') {
    return null;
  }

  return LANGUAGE_CLASS.exec(className)?.[1] ?? null;
}

/** A one-line fence with no language label sits beside its copy control. */
export function isSingleLineCodeBlock(text: string, language: string | null): boolean {
  if (language) {
    return false;
  }

  const body = text.replace(/\r?\n$/, '');
  return body.length > 0 && !body.includes('\n') && !body.includes('\r');
}

/** Drop the fence's trailing newline so a one-line command pastes cleanly. */
export function copyableCodeText(text: string): string {
  return text.replace(/\r?\n$/, '');
}
