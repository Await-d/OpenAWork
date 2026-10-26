// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { MarkdownTextPreview } from './markdown-text-preview.js';

afterEach(cleanup);

describe('MarkdownTextPreview', () => {
  it('代码围栏与强调按 Markdown 渲染', () => {
    const { container } = render(
      <MarkdownTextPreview text={'```ts\nconst a = 1;\n```\n\n**说明**'} />,
    );

    expect(container.querySelector('pre code')?.textContent).toContain('const a = 1;');
    expect(container.querySelector('strong')?.textContent).toBe('说明');
  });

  it('空白文本使用默认空态', () => {
    const { container } = render(<MarkdownTextPreview text="   " />);

    expect(container.textContent).toContain('（没有内容）');
  });

  it('支持自定义空态文案（hover 场景）', () => {
    const { container } = render(<MarkdownTextPreview text="" emptyText="（没有 hover 内容）" />);

    expect(container.textContent).toContain('（没有 hover 内容）');
  });

  it('原始 HTML 不作为可执行结构渲染', () => {
    const { container } = render(<MarkdownTextPreview text={'<script>alert(1)</script>'} />);

    expect(container.querySelector('script')).toBeNull();
  });
});
