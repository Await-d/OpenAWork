import { describe, expect, it } from 'vitest';
import { codePreviewText, rehypeCodeHighlightBudget } from './code-render-budget.js';

function codeNode(text: string) {
  return {
    type: 'element',
    tagName: 'code',
    properties: { className: ['language-ts'] },
    children: [{ type: 'text', value: text }],
  };
}

describe('代码高亮总预算', () => {
  it('同一棵树多个围栏共享预算，每次解析重新计算', () => {
    const first = codeNode('x'.repeat(40_000));
    const second = codeNode('y'.repeat(40_000));
    const third = codeNode('z');
    const transform = rehypeCodeHighlightBudget();
    transform({ type: 'root', children: [first, second, third] });
    expect(first.properties.className).toEqual(['language-ts']);
    expect(second.properties.className).toEqual(['language-ts']);
    expect(third.properties.className).toEqual(['language-ts', 'no-highlight']);
    const next = codeNode('const fresh = true;');
    transform({ type: 'root', children: [next] });
    expect(next.properties.className).toEqual(['language-ts']);
  });

  it('超长块跳过高亮但保留全文，不吞后续短块预算', () => {
    const long = codeNode('x'.repeat(80_001));
    const short = codeNode('const value = 1;');
    rehypeCodeHighlightBudget()({ type: 'root', children: [long, short] });
    expect(long.properties.className).toContain('no-highlight');
    expect(long.children[0]?.value).toHaveLength(80_001);
    expect(short.properties.className).toEqual(['language-ts']);
  });

  it('100行围栏允许解析器尾换行，101行围栏跳过高亮', () => {
    const allowed = codeNode(`${Array(100).fill('const value = 1;').join('\n')}\n`);
    const skipped = codeNode(`${Array(101).fill('const value = 1;').join('\n')}\n`);
    rehypeCodeHighlightBudget()({ type: 'root', children: [allowed, skipped] });
    expect(allowed.properties.className).toEqual(['language-ts']);
    expect(skipped.properties.className).toContain('no-highlight');
  });

  it('预览同时受行数和字符限制', () => {
    expect(codePreviewText(Array(100).fill('line').join('\n')).split('\n')).toHaveLength(36);
    expect(codePreviewText('x'.repeat(20_000))).toHaveLength(12_000);
  });
});
