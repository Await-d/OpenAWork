// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AstGrepPreview } from './ast-grep-preview.js';

afterEach(cleanup);

describe('AstGrepPreview', () => {
  it('展示匹配数、路径、行号与片段', () => {
    const { container } = render(
      <AstGrepPreview
        matches={[
          { filePath: '/repo/src/a.ts', line: 12, column: 5, snippet: 'const a = 1;' },
          { filePath: '/repo/src/b.ts', line: 40, column: 1, snippet: 'const b = 2;' },
        ]}
      />,
    );

    expect(container.textContent).toContain('找到 2 处匹配');
    expect(container.textContent).toContain('a.ts');
    expect(container.textContent).toContain('12:5');
    expect(container.textContent).toContain('const a = 1;');
    // 多文件时公共目录提为前缀徽标。
    expect(container.querySelector('.styled-path-prefix')?.textContent).toContain('/repo/src/');
    expect(container.querySelectorAll('[data-ast-grep-match]')).toHaveLength(2);
  });

  it('空匹配给出空态', () => {
    const { container } = render(<AstGrepPreview matches={[]} />);

    expect(container.textContent).toContain('（未找到匹配）');
  });

  it('超过 20 处时提示剩余数量', () => {
    const matches = Array.from({ length: 25 }, (_, index) => ({
      filePath: 'a.ts',
      line: index + 1,
      column: 1,
      snippet: `line ${index + 1}`,
    }));

    const { container } = render(<AstGrepPreview matches={matches} />);

    expect(container.textContent).toContain('还有 5 处未展示');
    expect(container.querySelectorAll('[data-ast-grep-match]')).toHaveLength(20);
  });

  it('片段超过 12 行时提示剩余行数', () => {
    const snippet = Array.from({ length: 15 }, (_, index) => `line ${index + 1}`).join('\n');

    const { container } = render(
      <AstGrepPreview matches={[{ filePath: 'a.ts', line: 1, column: 1, snippet }]} />,
    );

    expect(container.textContent).toContain('… 还有 3 行未展示');
  });
});
