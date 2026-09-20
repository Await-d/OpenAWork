import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    parse: vi.fn(async () => true),
    render: vi.fn(async () => ({ svg: '<svg viewBox="0 0 320 180"><text>d</text></svg>' })),
  },
}));

import MarkdownMessageContent from './markdown-message-content.js';

afterEach(cleanup);

describe('MarkdownMessageContent math rendering', () => {
  it('renders the copied bracketed LaTeX answer as display math', async () => {
    render(<MarkdownMessageContent content={'所以\n\n[\nx\\le 7.\n]\n\n\\boxed{x=7}。'} />);

    expect((await screen.findAllByText('x')).length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.katex-display')).toHaveLength(2);
    expect(document.querySelector('.katex')).toBeTruthy();
  });

  it('renders the complete exchange-count answer without empty math nodes', async () => {
    const content = String.raw`第一步消耗 (1) 次交换；引理保证之后最多再用 (6) 次，因此总数不超过

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
]

因此，所有保证成功的策略中，最坏情况下所需的最少交换次数是：

[
\boxed{7\text{ 次}}.
]`;

    render(<MarkdownMessageContent content={content} />);

    expect((await screen.findAllByText('所以')).length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.katex-display')).toHaveLength(4);
    expect(document.querySelectorAll('.katex')).toHaveLength(5);
    expect(document.querySelector('.katex-display:empty')).toBeNull();
    expect(document.body.textContent).toContain('次');
  });

  it('renders Chinese prose with comparison operators without KaTeX warnings', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const content = [
      '- 计费月起（2026-01 及之后），较上月 > 100 元的部分计入。',
      '- 合计 $计费月起，较上月 > 100$ 元。',
    ].join('\n');

    render(<MarkdownMessageContent content={content} />);

    expect(await screen.findByText(/计费月起（2026-01 及之后）/u)).toBeTruthy();
    expect(document.querySelectorAll('.katex')).toHaveLength(0);
    expect(warn.mock.calls.flat().join('\n')).not.toContain('unicodeTextInMathMode');

    warn.mockRestore();
  });
});

describe('MarkdownMessageContent hard breaks', () => {
  it('renders a raw <br> inside a table cell as a real line break', () => {
    const content = ['| 评论 | 热度 |', '| --- | --- |', '| A<br>B | 1 |'].join('\n');
    const { container } = render(<MarkdownMessageContent content={content} />);

    const cell = container.querySelector('.chat-markdown-td');
    expect(cell?.querySelector('br')).toBeTruthy();
    expect(cell?.textContent).toBe('AB');
    expect(container.textContent).not.toContain('<br>');
  });

  it('renders <br> in prose without leaving a stray blank line', () => {
    const { container } = render(<MarkdownMessageContent content={'第一行<br>\n第二行'} />);

    const paragraph = container.querySelector('.chat-markdown-p');
    expect(paragraph?.querySelector('br')).toBeTruthy();
    expect(paragraph?.textContent).toBe('第一行第二行');
  });

  it('keeps a literal <br> inside inline code', () => {
    const { container } = render(<MarkdownMessageContent content={'使用 `<br>` 换行'} />);

    expect(container.querySelector('.chat-markdown-inline-code')?.textContent).toBe('<br>');
  });

  it('drops a <br> that occupies a line of its own', () => {
    const content = ['第一段', '', '<br>', '', '第二段'].join('\n');
    const { container } = render(<MarkdownMessageContent content={content} />);

    expect(container.textContent).not.toContain('<br>');
    expect(container.querySelectorAll('.chat-markdown-p')).toHaveLength(2);
  });
});

describe('MarkdownMessageContent tables', () => {
  const TABLE = ['| 项目 | 金额 | 备注 |', '| :--- | ---: | --- |', '| 合计 | 1200 | ok |'].join(
    '\n',
  );

  it('渲染为卡片结构：工具栏 + 独立滚动区', () => {
    const { container } = render(<MarkdownMessageContent content={TABLE} />);

    expect(container.querySelector('.chat-markdown-table-shell')).toBeTruthy();
    expect(container.querySelector('.chat-markdown-table-viewport')).toBeTruthy();
    expect(container.querySelector('.chat-markdown-table-wrap .chat-markdown-table')).toBeTruthy();
    expect(screen.getByTestId('chat-markdown-table-copy')).toBeTruthy();
    expect(screen.getByText('1 行 × 3 列')).toBeTruthy();
  });

  it('把 GFM 列对齐落到 data-align，交给样式处理', () => {
    const { container } = render(<MarkdownMessageContent content={TABLE} />);

    const headerCells = container.querySelectorAll('.chat-markdown-th');
    const bodyCells = container.querySelectorAll('.chat-markdown-td');

    expect(headerCells[0]?.getAttribute('data-align')).toBe('left');
    expect(headerCells[1]?.getAttribute('data-align')).toBe('right');
    // 未标注对齐的列默认左对齐
    expect(headerCells[2]?.getAttribute('data-align')).toBe('left');
    expect(bodyCells[1]?.getAttribute('data-align')).toBe('right');
    expect(headerCells[0]?.getAttribute('scope')).toBe('col');
  });

  it('列数多时切到紧凑密度', () => {
    const wide = [
      '| a | b | c | d | e | f | g |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      '| 1 | 2 | 3 | 4 | 5 | 6 | 7 |',
    ].join('\n');
    const { container } = render(<MarkdownMessageContent content={wide} />);

    expect(
      container.querySelector('.chat-markdown-table-shell')?.getAttribute('data-density'),
    ).toBe('compact');
  });
});

describe('MarkdownMessageContent mermaid fences', () => {
  it('把 ```mindmap 直接当图表渲染并标注类型', () => {
    const content = ['```mindmap', 'mindmap', '  root((主题))', '    分支', '```'].join('\n');
    const { container } = render(<MarkdownMessageContent content={content} />);

    expect(
      container.querySelector('.chat-markdown-code-block')?.getAttribute('data-diagram-kind'),
    ).toBe('mindmap');
    expect(screen.getByText('思维导图')).toBeTruthy();
  });

  it('普通代码围栏不受影响，不带上图表标记', () => {
    const content = ['```ts', 'const a = 1;', '```'].join('\n');
    const { container } = render(<MarkdownMessageContent content={content} />);

    const block = container.querySelector('.chat-markdown-code-block');
    expect(block).toBeTruthy();
    expect(block?.hasAttribute('data-diagram-kind')).toBe(false);
  });
});

describe('MarkdownMessageContent static preview fences', () => {
  it('```html / ```css / ```svg 默认展开预览', () => {
    for (const language of ['html', 'css', 'svg']) {
      const content = ['```' + language, '<div></div>', '```'].join('\n');
      const { container, unmount } = render(<MarkdownMessageContent content={content} />);

      const block = container.querySelector('.chat-markdown-code-block');
      expect(block?.getAttribute('data-static-preview')).toBe('true');
      expect(block?.getAttribute('data-preview-open')).toBe('true');
      expect(container.querySelector('[data-testid="chat-markdown-html-preview"]')).toBeTruthy();
      unmount();
    }
  });

  it('```xml 不默认预览，保持源码视图', () => {
    const content = ['```xml', '<project></project>', '```'].join('\n');
    const { container } = render(<MarkdownMessageContent content={content} />);

    const block = container.querySelector('.chat-markdown-code-block');
    expect(block?.getAttribute('data-static-preview')).toBe('true');
    expect(block?.hasAttribute('data-preview-open')).toBe(false);
    expect(container.querySelector('[data-testid="chat-markdown-html-preview"]')).toBeNull();
    expect(container.querySelector('pre.chat-markdown-pre')).toBeTruthy();
  });

  it('```js 不默认预览，保持源码视图', () => {
    const content = ['```js', 'const a = 1;', '```'].join('\n');
    const { container } = render(<MarkdownMessageContent content={content} />);

    const block = container.querySelector('.chat-markdown-code-block');
    expect(block?.hasAttribute('data-preview-open')).toBe(false);
    expect(container.querySelector('pre.chat-markdown-pre')).toBeTruthy();
  });
});
