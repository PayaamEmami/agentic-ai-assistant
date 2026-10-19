import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import {
  codeBlockLanguage,
  codeBlockText,
  copyableCodeText,
  isSingleLineCodeBlock,
} from './code-fence';

describe('code fence copy text', () => {
  it('reads fenced code and its language class', () => {
    const node = createElement(
      'code',
      { className: 'language-ts font-mono' },
      'const x = 1\n',
    );

    expect(codeBlockText(node)).toBe('const x = 1\n');
    expect(codeBlockLanguage(node)).toBe('ts');
    expect(copyableCodeText(codeBlockText(node))).toBe('const x = 1');
    expect(isSingleLineCodeBlock(codeBlockText(node), 'ts')).toBe(false);
  });

  it('treats an unlabeled one-line fence as a single-line block', () => {
    const node = createElement('code', { className: 'font-mono' }, 'echo hello\n');
    const text = codeBlockText(node);

    expect(codeBlockLanguage(node)).toBeNull();
    expect(isSingleLineCodeBlock(text, null)).toBe(true);
    expect(copyableCodeText(text)).toBe('echo hello');
  });

  it('keeps a multi-line unlabeled fence as a stacked block', () => {
    const text = 'first\nsecond\n';

    expect(isSingleLineCodeBlock(text, null)).toBe(false);
    expect(copyableCodeText(text)).toBe('first\nsecond');
  });

  it('joins nested code children', () => {
    const node = [
      '\n',
      createElement('code', { className: 'language-py' }, ['print(', createElement('span', null, '"hi"'), ')\n']),
    ];

    expect(codeBlockText(node)).toBe('\nprint("hi")\n');
    expect(codeBlockLanguage(node)).toBe('py');
  });
});
