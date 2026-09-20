// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ExpandableOutput } from './expandable-output.js';
import { ToolCardExpansionProvider, useIsInsideExpandedToolCard } from './tool-card-expansion.js';

function ExpansionProbe() {
  return <span data-testid="expansion-probe">{String(useIsInsideExpandedToolCard())}</span>;
}

const LONG_TEXT = Array.from({ length: 40 }, (_, i) => `line-${i + 1}`).join('\n');

afterEach(cleanup);

describe('ToolCardExpansionContext', () => {
  it('默认在卡片外返回 false', () => {
    render(<ExpansionProbe />);
    expect(screen.getByTestId('expansion-probe').textContent).toBe('false');
  });

  it('Provider 内返回 true', () => {
    render(
      <ToolCardExpansionProvider>
        <ExpansionProbe />
      </ToolCardExpansionProvider>,
    );
    expect(screen.getByTestId('expansion-probe').textContent).toBe('true');
  });
});

describe('ExpandableOutput 在展开态卡片内', () => {
  it('独立使用时保留二级展开按钮并截断长文本', () => {
    const { container } = render(<ExpandableOutput text={LONG_TEXT} />);

    expect(screen.getByRole('button', { name: /展开全部/ })).toBeTruthy();
    expect(container.querySelector('.tool-output-pre')?.textContent).not.toContain('line-40');
    expect(container.querySelector('.tool-output-fade')).not.toBeNull();
  });

  it('卡片展开态内完整渲染且不再出现二级展开按钮与 fade 遮罩', () => {
    const { container } = render(
      <ToolCardExpansionProvider>
        <ExpandableOutput text={LONG_TEXT} />
      </ToolCardExpansionProvider>,
    );

    expect(screen.queryByRole('button', { name: /展开全部/ })).toBeNull();
    expect(container.querySelector('.tool-output-pre')?.textContent).toContain('line-40');
    expect(container.querySelector('.tool-output-fade')).toBeNull();
  });
});
