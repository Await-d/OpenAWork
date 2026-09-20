// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { ToolCardExpansionProvider } from '../shared/tool-card-expansion.js';
import { BashOutputPreview } from './bash-output-preview.js';
import { JsonPreview } from './json-preview.js';
import { ParameterListPreview } from './parameter-list-preview.js';
import { TreeNodesPreview } from './tree-nodes-preview.js';

function renderInsideExpandedCard(node: ReactNode) {
  return render(<ToolCardExpansionProvider>{node}</ToolCardExpansionProvider>);
}

const STDOUT = Array.from({ length: 42 }, (_, i) => `stdout-${i + 1}`).join('\n');

afterEach(cleanup);

describe('BashOutputPreview', () => {
  it('独立使用时刻断到 MAX_LINES 并提供展开按钮', () => {
    const { container } = render(<BashOutputPreview data={{ stdout: STDOUT, exitCode: 0 }} />);

    expect(container.querySelector('.bash-output-stdout')?.textContent).not.toContain('stdout-42');
    expect(screen.getByRole('button', { name: /展开全部/ })).toBeTruthy();
  });

  it('卡片展开态内完整渲染 stdout 且无展开按钮', () => {
    const { container } = renderInsideExpandedCard(
      <BashOutputPreview data={{ stdout: STDOUT, exitCode: 0 }} />,
    );

    expect(container.querySelector('.bash-output-stdout')?.textContent).toContain('stdout-42');
    expect(screen.queryByRole('button', { name: /展开全部/ })).toBeNull();
  });
});

describe('TreeNodesPreview', () => {
  const data = {
    nodes: [
      {
        name: 'src',
        type: 'dir' as const,
        children: [
          {
            name: 'nested',
            type: 'dir' as const,
            children: [{ name: 'deep.ts', type: 'file' as const }],
          },
        ],
      },
    ],
  };

  it('独立使用时目录保持折叠', () => {
    const { container } = render(<TreeNodesPreview data={data} />);

    expect(container.querySelectorAll('.tool-call-tree-row')).toHaveLength(1);
    expect(screen.queryByText('deep.ts')).toBeNull();
  });

  it('卡片展开态内目录全部展开', () => {
    const { container } = renderInsideExpandedCard(<TreeNodesPreview data={data} />);

    expect(screen.getByText('deep.ts')).toBeTruthy();
    expect(container.querySelectorAll('[data-expanded="true"]')).toHaveLength(2);
  });
});

describe('JsonPreview', () => {
  const payload = Array.from({ length: 30 }, (_, i) => ({ index: i, label: `row-${i}` }));

  it('独立使用时标记 data-collapsed 并提供展开按钮', () => {
    const { container } = render(<JsonPreview data={payload} />);

    expect(container.querySelector('.json-preview-content')?.getAttribute('data-collapsed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: /展开全部/ })).toBeTruthy();
  });

  it('卡片展开态内不折叠且无二级按钮', () => {
    const { container } = renderInsideExpandedCard(<JsonPreview data={payload} />);

    expect(container.querySelector('.json-preview-content')?.getAttribute('data-collapsed')).toBe(
      'false',
    );
    expect(screen.queryByRole('button', { name: /展开全部/ })).toBeNull();
  });
});

describe('ParameterListPreview', () => {
  const input = {
    prompt: 'x'.repeat(300),
    todos: [{ content: 'a' }, { content: 'b' }, { content: 'c' }, { content: 'd' }],
  };

  it('独立使用时长参数收进 <details>', () => {
    const { container } = render(<ParameterListPreview input={input} />);
    const details = container.querySelectorAll('details.param-list-nested');

    expect(details.length).toBeGreaterThan(0);
    expect([...details].every((node) => !node.hasAttribute('open'))).toBe(true);
  });

  it('卡片展开态内嵌套参数全部默认展开', () => {
    const { container } = renderInsideExpandedCard(<ParameterListPreview input={input} />);
    const details = container.querySelectorAll('details.param-list-nested');

    expect(details.length).toBeGreaterThan(0);
    expect([...details].every((node) => node.hasAttribute('open'))).toBe(true);
  });
});
