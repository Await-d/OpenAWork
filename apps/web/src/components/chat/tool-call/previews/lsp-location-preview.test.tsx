// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { LspLocationPreview } from './lsp-location-preview.js';

afterEach(cleanup);

describe('LspLocationPreview', () => {
  it('渲染多个位置与行:列', () => {
    const { container } = render(
      <LspLocationPreview
        entries={[
          { filePath: '/repo/src/a.ts', line: 12, column: 4 },
          { filePath: '/repo/src/b.ts', line: 3, column: 0 },
        ]}
      />,
    );

    expect(container.textContent).toContain('a.ts');
    expect(container.textContent).toContain('b.ts');
    expect(container.textContent).toContain('12:4');
    expect(container.textContent).toContain('3:0');
  });

  it('多文件时把公共目录提到前缀徽标', () => {
    const { container } = render(
      <LspLocationPreview
        entries={[
          { filePath: '/repo/src/a.ts', line: 1 },
          { filePath: '/repo/src/b.ts', line: 2 },
        ]}
      />,
    );

    const prefix = container.querySelector('.styled-path-prefix');
    expect(prefix?.textContent).toContain('/repo/src/');
  });

  it('空列表给出空态', () => {
    const { container } = render(<LspLocationPreview entries={[]} />);

    expect(container.textContent).toContain('（没有位置结果）');
  });

  it('超过 100 条时提示剩余数量', () => {
    const entries = Array.from({ length: 120 }, (_, index) => ({
      filePath: 'a.ts',
      line: index + 1,
    }));

    const { container } = render(<LspLocationPreview entries={entries} />);

    expect(container.textContent).toContain('还有 20 条位置未展示');
    expect(container.querySelectorAll('li')).toHaveLength(100);
  });
});
