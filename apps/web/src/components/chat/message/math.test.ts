import { describe, expect, it } from 'vitest';
import katex from 'katex';
import { normalizeMathDelimiters } from './math';

const QUBIT_SAMPLE = `The equation is

\\[ |\\psi\\rangle=\\alpha_0|0\\rangle+\\alpha_1|1\\rangle. \\]

It says that a qubit can be in a superposition of the two basis states, \\(|0\\rangle\\) and \\(|1\\rangle\\).

Here, \\(|0\\rangle\\) represents the ground state and \\(|1\\rangle\\) represents the excited state. The coefficients \\(\\alpha_0\\) and \\(\\alpha_1\\) are generally complex numbers called probability amplitudes. They determine the outcomes of a measurement:

\\[ P(0)=|\\alpha_0|^2,\\qquad P(1)=|\\alpha_1|^2. \\]

Because measurement must produce one of the two outcomes, the probabilities must add up to one:

\\[ |\\alpha_0|^2+|\\alpha_1|^2=1. \\]

The addition appears because \\(|0\\rangle\\) and \\(|1\\rangle\\) are two independent directions, or basis vectors, in the qubit’s state space. This is similar to describing an ordinary vector using horizontal and vertical components:

\\[ \\vec v = x\\hat{\\mathbf{x}}+y\\hat{\\mathbf{y}}. \\]`;

describe('normalizeMathDelimiters', () => {
  it('converts display and inline LaTeX delimiters to dollar math', () => {
    expect(normalizeMathDelimiters('\\[ E = mc^2 \\]')).toContain('$$\nE = mc^2\n$$');
    expect(normalizeMathDelimiters('state \\(|0\\rangle\\)')).toBe('state $|0\\rangle$');
  });

  it('turns the qubit superposition sample into parseable math', () => {
    const normalized = normalizeMathDelimiters(QUBIT_SAMPLE);

    expect(normalized).not.toContain('\\[');
    expect(normalized).not.toContain('\\(');
    expect(normalized).toContain('$|0\\rangle$');
    expect(normalized).toContain('$\\alpha_0$');
    expect(normalized).toContain('$$\n|\\psi\\rangle=\\alpha_0|0\\rangle+\\alpha_1|1\\rangle.\n$$');
    expect(normalized).toContain(
      '$$\n\\vec v = x\\hat{\\mathbf{x}}+y\\hat{\\mathbf{y}}.\n$$',
    );

    const displayMath = [...normalized.matchAll(/\$\$\n([\s\S]*?)\n\$\$/g)].map(
      (match) => match[1],
    );
    const inlineMath = [...normalized.matchAll(/(?<!\$)\$(?!\$)([^$]+)\$(?!\$)/g)].map(
      (match) => match[1],
    );

    expect(displayMath.length).toBe(4);
    expect(inlineMath.length).toBeGreaterThan(0);

    for (const expr of [...displayMath, ...inlineMath]) {
      expect(() =>
        katex.renderToString(expr, { throwOnError: true, displayMode: displayMath.includes(expr) }),
      ).not.toThrow();
    }
  });

  it('leaves fenced code blocks unchanged', () => {
    const input = 'Before\n\n```js\nconst x = "\\[a\\] \\(b\\)";\n```\n\nAfter \\(c\\)';
    const normalized = normalizeMathDelimiters(input);

    expect(normalized).toContain('const x = "\\[a\\] \\(b\\)";');
    expect(normalized).toContain('After $c$');
  });

  it('leaves already-dollar math unchanged', () => {
    expect(normalizeMathDelimiters('See $E=mc^2$ here')).toBe('See $E=mc^2$ here');
  });
});
