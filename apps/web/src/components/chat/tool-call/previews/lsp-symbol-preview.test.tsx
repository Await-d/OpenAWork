// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { LspSymbolPreview } from './lsp-symbol-preview.js';

afterEach(cleanup);

describe('LspSymbolPreview', () => {
  it('document 模式展示名称 / kind / 行号', () => {
    const { container } = render(
      <LspSymbolPreview
        filePath="/repo/src/a.ts"
        entries={[
          { depth: 0, name: 'ChatPage', kindCode: 12, kindLabel: '函数', line: 10 },
          { depth: 1, name: 'render', kindCode: 6, kindLabel: '方法', line: 24 },
        ]}
      />,
    );

    expect(container.textContent).toContain('ChatPage');
    expect(container.textContent).toContain('函数');
    expect(container.textContent).toContain('line 10');
    expect(container.textContent).toContain('render');
  });

  it('层级用左缩进表达', () => {
    const { container } = render(
      <LspSymbolPreview
        entries={[
          { depth: 0, name: 'A', kindCode: 5, kindLabel: '类', line: 1 },
          { depth: 2, name: 'B', kindCode: 6, kindLabel: '方法', line: 5 },
        ]}
      />,
    );

    const items = container.querySelectorAll('li');
    const nested = items[1] as HTMLElement | undefined;
    expect(nested?.style.paddingLeft).toBe('24px');
  });

  it('workspace 模式展示容器与路径，并提取公共前缀', () => {
    const { container } = render(
      <LspSymbolPreview
        entries={[
          {
            depth: 0,
            name: 'useThing',
            kindCode: 12,
            kindLabel: '函数',
            containerName: 'Foo',
            filePath: '/repo/src/a.ts',
            line: 12,
            column: 4,
          },
          {
            depth: 0,
            name: 'useOther',
            kindCode: 12,
            kindLabel: '函数',
            filePath: '/repo/src/b.ts',
            line: 3,
            column: 0,
          },
        ]}
      />,
    );

    expect(container.textContent).toContain('in Foo');
    expect(container.textContent).toContain('12:4');
    expect(container.querySelector('.styled-path-prefix')?.textContent).toContain('/repo/src/');
  });

  it('空列表给出空态', () => {
    const { container } = render(<LspSymbolPreview entries={[]} />);

    expect(container.textContent).toContain('（没有符号）');
  });

  it('超过 200 条时提示剩余数量', () => {
    const entries = Array.from({ length: 205 }, (_, index) => ({
      depth: 0,
      name: `sym${index}`,
      kindCode: 13,
      kindLabel: '变量',
      line: index + 1,
    }));

    const { container } = render(<LspSymbolPreview entries={entries} />);

    expect(container.textContent).toContain('还有 5 个符号未展示');
    expect(container.querySelectorAll('li')).toHaveLength(200);
  });
});
