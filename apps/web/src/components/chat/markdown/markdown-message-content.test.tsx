import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
