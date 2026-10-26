// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { LspHoverPreview } from './lsp-hover-preview.js';

afterEach(cleanup);

describe('LspHoverPreview', () => {
  it('按 Markdown 渲染签名与文档段落', () => {
    const { container } = render(
      <LspHoverPreview text={'```ts\nfunction run(): void\n```\n\n**运行**入口'} />,
    );

    expect(container.querySelector('pre code')?.textContent).toContain('function run');
    expect(container.querySelector('strong')?.textContent).toBe('运行');
  });

  it('空文本给出空态', () => {
    const { container } = render(<LspHoverPreview text="   " />);

    expect(container.textContent).toContain('（没有 hover 内容）');
  });

  it('原始 HTML 不当成可执行结构渲染', () => {
    const { container } = render(<LspHoverPreview text={'<script>alert(1)</script>'} />);

    expect(container.querySelector('script')).toBeNull();
  });
});
