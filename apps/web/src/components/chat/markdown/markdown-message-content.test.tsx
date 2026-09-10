import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
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
});
