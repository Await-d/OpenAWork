// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { LspCallHierarchyPreview } from './lsp-call-hierarchy-preview.js';

afterEach(cleanup);

describe('LspCallHierarchyPreview', () => {
  it('展示符号、调用方与被调用方', () => {
    const { container } = render(
      <LspCallHierarchyPreview
        view={{
          symbol: { name: 'run', filePath: '/repo/src/a.ts', line: 12, column: 4 },
          incoming: [{ name: 'caller', filePath: '/repo/src/b.ts', line: 8 }],
          outgoing: [{ name: 'callee', detail: 'helper', filePath: '/repo/src/d.ts', line: 1 }],
        }}
      />,
    );

    expect(container.textContent).toContain('run');
    expect(container.textContent).toContain('↑ 调用方（1）');
    expect(container.textContent).toContain('caller');
    expect(container.textContent).toContain('↓ 被调用（1）');
    expect(container.textContent).toContain('helper');
    expect(container.textContent).toContain('12:4');
    // 多文件时公共目录提为前缀徽标。
    expect(container.querySelector('.styled-path-prefix')?.textContent).toContain('/repo/src/');
  });

  it('空组给出「没有」提示', () => {
    const { container } = render(
      <LspCallHierarchyPreview
        view={{
          symbol: { name: 'run', filePath: 'a.ts', line: 1 },
          incoming: [],
          outgoing: [],
        }}
      />,
    );

    expect(container.textContent).toContain('没有调用方');
    expect(container.textContent).toContain('没有调用其它符号');
  });

  it('超过 50 条时提示剩余数量', () => {
    const incoming = Array.from({ length: 55 }, (_, index) => ({
      name: `caller${index}`,
      filePath: 'a.ts',
      line: index + 1,
    }));

    const { container } = render(
      <LspCallHierarchyPreview view={{ symbol: null, incoming, outgoing: [] }} />,
    );

    expect(container.textContent).toContain('还有 5 条未展示');
  });
});
