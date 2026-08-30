const FENCED_BLOCK_RE =
  /(^|\n)([ \t]{0,3})(`{3,}|~{3,})[^\n]*(?:\n[\s\S]*?)(?:\n[ \t]{0,3}\3[ \t]*(?=\n|$)|$)/g;

function convertLatexDelimiters(text: string): string {
  return text
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match, expr: string) => `\n$$\n${expr.trim()}\n$$\n`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_match, expr: string) => `$${expr.trim()}$`);
}

/**
 * Convert LaTeX `\[...\]` / `\(...\)` delimiters to `$` / `$$` so remark-math
 * can parse them. Markdown otherwise treats those backslashes as escapes and
 * the equations render as `[...]` / `(...)`.
 */
export function normalizeMathDelimiters(markdown: string): string {
  if (!markdown.includes('\\[') && !markdown.includes('\\(')) {
    return markdown;
  }

  const parts: string[] = [];
  let lastIndex = 0;

  for (const match of markdown.matchAll(FENCED_BLOCK_RE)) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      parts.push(convertLatexDelimiters(markdown.slice(lastIndex, start)));
    }
    parts.push(match[0]);
    lastIndex = start + match[0].length;
  }

  if (lastIndex < markdown.length) {
    parts.push(convertLatexDelimiters(markdown.slice(lastIndex)));
  }

  return parts.join('');
}
