// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ToolCardExpansionProvider } from '../shared/tool-card-expansion.js';
import { JsonPreview } from './json-preview.js';

afterEach(cleanup);

function codeHtml(container: HTMLElement): string {
  return container.querySelector('.json-preview-code code')?.innerHTML ?? '';
}

describe('JsonPreview 高亮', () => {
  it('键与冒号分属不同 span，且属性不被撕裂', () => {
    const { container } = render(<JsonPreview data={{ alpha: 1 }} />);
    const html = codeHtml(container);

    expect(html).toContain('<span class="json-key">"alpha"</span>');
    expect(html).toContain('<span class="json-colon">:</span>');
    // 旧实现的多轮 replace 会把刚注入的 class="json-key" 当 JSON 字符串再高亮一次，
    // 产出 `class=<span class="json-string">"json-key"</span>>` 这类破碎标记。
    expect(html).not.toContain('class=<span');
    expect(html).not.toContain('<span class="json-string">"json-key"</span>');
    expect(html).not.toContain('<span class="json-string">"json-colon"</span>');
  });

  it('字符串值不会被误判成键', () => {
    const { container } = render(<JsonPreview data={{ greeting: 'hello world' }} />);
    expect(codeHtml(container)).toContain('<span class="json-string">"hello world"</span>');
  });

  it('高亮数字、布尔与 null', () => {
    const { container } = render(<JsonPreview data={{ n: 42, ok: true, missing: null }} />);
    const html = codeHtml(container);
    expect(html).toContain('<span class="json-number">42</span>');
    expect(html).toContain('<span class="json-boolean">true</span>');
    expect(html).toContain('<span class="json-null">null</span>');
  });

  it('键后紧跟冒号 span，冒号后的空白作为原文本保留在 span 外', () => {
    const { container } = render(<JsonPreview data={{ a: 1 }} />);
    expect(codeHtml(container)).toContain(
      '<span class="json-key">"a"</span><span class="json-colon">:</span> <span class="json-number">1</span>',
    );
  });

  it('转义 HTML 特殊字符', () => {
    const { container } = render(<JsonPreview data={{ raw: '<img src=x>' }} />);
    const html = codeHtml(container);
    expect(html).toContain('&lt;img src=x&gt;');
    expect(html).not.toContain('<img');
  });
});

describe('JsonPreview 折叠', () => {
  const manyLines = Array.from({ length: 60 }, (_, i) => `  "k${i}": ${i},`).join('\n');

  it('超出行数上限时折叠并提供展开按钮', () => {
    render(<JsonPreview data={manyLines} />);
    expect(screen.getByRole('button', { name: /展开全部/ })).toBeTruthy();
  });

  it('折叠态只把前 20 行送进 DOM（真截断而非 CSS 裁剪）', () => {
    const { container } = render(<JsonPreview data={manyLines} />);
    const text = container.querySelector('.json-preview-code code')?.textContent ?? '';
    expect(text).toContain('"k0"');
    expect(text).not.toContain('"k40"');
  });

  it('卡片展开态内完整渲染', () => {
    const { container } = render(
      <ToolCardExpansionProvider>
        <JsonPreview data={manyLines} />
      </ToolCardExpansionProvider>,
    );
    const text = container.querySelector('.json-preview-code code')?.textContent ?? '';
    expect(text).toContain('"k59"');
  });

  it('超大输出按字符硬截断并提示，不全量进 DOM', () => {
    const huge = `"blob": "${'x'.repeat(60_000)}"`;
    const { container } = render(<JsonPreview data={huge} />);

    const text = container.querySelector('.json-preview-code code')?.textContent ?? '';
    expect(text.length).toBeLessThan(30_000);
    expect(container.textContent).toContain('已截断显示前');
  });
});
