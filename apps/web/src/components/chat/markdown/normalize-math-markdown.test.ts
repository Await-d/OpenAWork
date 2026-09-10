import { describe, expect, it } from 'vitest';
import { normalizeMathMarkdown } from './normalize-math-markdown.js';

describe('normalizeMathMarkdown', () => {
  it('converts standalone square-bracket formula blocks', () => {
    const input = '因此总数不超过\n\n[\n1+6=7.\n]\n\n所以\n\n[\nx\\le 7.\n]';
    const output = normalizeMathMarkdown(input);

    expect(output).toContain('$$\n1+6=7\n$$');
    expect(output).toContain('$$\nx\\le 7\n$$');
    expect(output).not.toContain('\n[\n');
  });

  it('wraps an isolated boxed expression while preserving punctuation', () => {
    expect(normalizeMathMarkdown('\\boxed{x=7}。')).toBe('$$\n\\boxed{x=7}\n$$\n。');
  });

  it('does not rewrite ordinary bracketed prose', () => {
    const input = '参考链接：[项目主页](https://example.com)';
    expect(normalizeMathMarkdown(input)).toBe(input);
  });

  it('supports escaped display and inline delimiters', () => {
    expect(normalizeMathMarkdown('结论：\\[x\\le 7\\]')).toContain('$$\nx\\le 7\n$$');
    expect(normalizeMathMarkdown('当且仅当 \\(x=7\\)')).toContain('$x=7$');
  });

  it('leaves fenced examples unchanged', () => {
    const input = ['```md', '[', 'x\\le 7', ']', '```'].join('\n');
    expect(normalizeMathMarkdown(input)).toBe(input);
  });

  it('removes sentence punctuation from the formula body', () => {
    expect(normalizeMathMarkdown('[\nx\\le 7.\n]')).toContain('$$\nx\\le 7\n$$');
  });

  it('does not double-wrap boxed formulas inside a bracket block', () => {
    const input = ['结合前面的下界', '', '[', '\\boxed{x=7}.', ']', '', '得到结论。'].join('\n');
    const output = normalizeMathMarkdown(input);

    expect(output).toContain('$$\n\\boxed{x=7}\n$$');
    expect(output).not.toContain('$$\n$$');
    expect(output.match(/\$\$/gu)?.length).toBe(2);
  });

  it('normalizes the complete exchange-count answer without empty math blocks', () => {
    const input = String.raw`第一步消耗 (1) 次交换；引理保证之后最多再用 (6) 次，因此总数不超过

[
1+6=7.
]

所以

[
x\le 7.
]

结合前面的下界 (x\ge7)，得到

[
\boxed{x=7}.
]`;
    const output = normalizeMathMarkdown(input);

    expect(output).not.toContain('$$\n$$');
    expect(output.match(/\$\$/gu)?.length).toBe(6);
  });

  it('renders LaTeX commands inside ordinary parenthesis as inline math', () => {
    const input = '结合前面的下界 (x\\ge7)，得到结论；普通编号 (1) 保持原样。';
    const output = normalizeMathMarkdown(input);

    expect(output).toContain('$x\\ge7$');
    expect(output).toContain('(1)');
    expect(output).not.toContain('(x\\ge7)');
  });

  it('does not carry Markdown list indentation into display math', () => {
    const input = '- 分类结果：\n  [\n  x\\in S_4\n  ]';
    const output = normalizeMathMarkdown(input);

    expect(output).toContain('- 分类结果：\n$$\nx\\in S_4\n$$');
    expect(output).not.toContain('  $$');
  });
});
