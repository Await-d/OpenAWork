// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  UnifiedCodeDiff,
  findFirstChangedRowIndex,
  highlightCodeLines,
  parseSnapshotDiffRows,
  parseUnifiedDiffRows,
  summarizeSnapshotDiff,
  toUnifiedDisplayRows,
} from './UnifiedCodeDiff.js';

const BEFORE_TEXT = ['const a = 1;', 'const b = 2;', 'const c = 3;', 'const d = 4;'].join('\n');
const AFTER_TEXT = ['const a = 1;', 'const b = 2;', 'const c = 33;', 'const d = 4;'].join('\n');
const ANCHOR_TOP = 120;
const ANCHOR_PADDING = 8;

function stubDiffLayout(anchorTop: number): void {
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(200);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: Element,
  ): DOMRect {
    const top = this.getAttribute('data-diff-anchor') === 'true' ? anchorTop : 0;
    return new DOMRect(0, top, 0, 0);
  });
}

function findAnchors(container: HTMLElement): NodeListOf<Element> {
  return container.querySelectorAll('[data-diff-anchor="true"]');
}

function findScrollViewport(container: HTMLElement): Element | null {
  return container.firstElementChild?.lastElementChild ?? null;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('findFirstChangedRowIndex', () => {
  it('跳过前导 context 行并返回第一处变更的索引', () => {
    const rows = parseSnapshotDiffRows(BEFORE_TEXT, AFTER_TEXT);

    expect(findFirstChangedRowIndex(rows)).toBe(2);
  });

  it('前后均为空文本时返回 -1', () => {
    expect(findFirstChangedRowIndex(parseSnapshotDiffRows('', ''))).toBe(-1);
  });

  it('内容完全一致（无变更）时返回 -1', () => {
    expect(findFirstChangedRowIndex(parseSnapshotDiffRows(BEFORE_TEXT, BEFORE_TEXT))).toBe(-1);
  });

  it('跳过 hunk 头行并返回首个新增行的索引', () => {
    const rows = parseUnifiedDiffRows('@@ -1,2 +1,3 @@\n+added\n');

    expect(findFirstChangedRowIndex(rows)).toBe(1);
  });
});

describe('UnifiedCodeDiff revealFirstChange', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
  });

  it('unified 模式下锚定第一处变更行，并将视口滚动到其上方留白处', () => {
    stubDiffLayout(ANCHOR_TOP);
    const { container } = render(
      <UnifiedCodeDiff
        afterText={AFTER_TEXT}
        beforeText={BEFORE_TEXT}
        chrome="minimal"
        revealFirstChange
      />,
    );

    const anchors = findAnchors(container);
    expect(anchors).toHaveLength(1);
    const anchor = anchors[0];
    expect(anchor?.textContent).toContain('const c = 3;');
    expect(anchor?.previousElementSibling?.textContent).toContain('const b = 2;');
    expect(anchor?.parentElement?.parentElement?.scrollTop).toBe(ANCHOR_TOP - ANCHOR_PADDING);
  });

  it('split 模式下锚点标记在变更行容器上，且不再停留在第 1 行', () => {
    stubDiffLayout(ANCHOR_TOP);
    const { container } = render(
      <UnifiedCodeDiff
        afterText={AFTER_TEXT}
        beforeText={BEFORE_TEXT}
        chrome="minimal"
        revealFirstChange
        viewMode="split"
      />,
    );

    const anchors = findAnchors(container);
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.textContent).toContain('const c = 3;');
    expect(anchors[0]?.textContent).toContain('const c = 33;');
    expect(findScrollViewport(container)?.scrollTop).toBe(ANCHOR_TOP - ANCHOR_PADDING);
  });

  it('未传 revealFirstChange 时不渲染锚点，也不改变滚动位置', () => {
    stubDiffLayout(ANCHOR_TOP);
    const { container } = render(
      <UnifiedCodeDiff afterText={AFTER_TEXT} beforeText={BEFORE_TEXT} chrome="minimal" />,
    );

    expect(findAnchors(container)).toHaveLength(0);
    expect(findScrollViewport(container)?.scrollTop).toBe(0);
  });

  it('组件保持挂载时内容变化会重新定位到新的首处变更行', () => {
    stubDiffLayout(ANCHOR_TOP);
    const { container, rerender } = render(
      <UnifiedCodeDiff
        afterText={BEFORE_TEXT}
        beforeText={BEFORE_TEXT}
        chrome="minimal"
        revealFirstChange
      />,
    );
    expect(findAnchors(container)).toHaveLength(0);

    rerender(
      <UnifiedCodeDiff
        afterText={AFTER_TEXT}
        beforeText={BEFORE_TEXT}
        chrome="minimal"
        revealFirstChange
      />,
    );

    const anchors = findAnchors(container);
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.textContent).toContain('const c = 3;');
    expect(anchors[0]?.parentElement?.parentElement?.scrollTop).toBe(ANCHOR_TOP - ANCHOR_PADDING);
  });
});

describe('toUnifiedDisplayRows — hunk 分隔条', () => {
  it('把 hunk 头折算成「第 N 行起 / N 行未变更」，不再铺原始 @@ 文本', () => {
    const rows = parseUnifiedDiffRows(
      [
        '@@ -1,3 +1,3 @@',
        ' a',
        '-b',
        '+bb',
        ' c',
        '@@ -20,3 +20,4 @@',
        ' x',
        '+y',
        ' z',
        ' w',
      ].join('\n'),
    );

    const hunks = toUnifiedDisplayRows(rows)
      .filter((row) => row.kind === 'hunk')
      .map((row) => row.text);

    expect(hunks).toEqual(['⋯ 第 1 行起', '⋯ 16 行未变更']);
  });

  it('hunk 头缺省计数（`@@ -1 +1 @@`）时按 1 行处理', () => {
    const rows = parseUnifiedDiffRows(['@@ -1 +1 @@', ' a', '@@ -5 +5 @@', '+b'].join('\n'));

    const hunks = toUnifiedDisplayRows(rows)
      .filter((row) => row.kind === 'hunk')
      .map((row) => row.text);

    expect(hunks).toEqual(['⋯ 第 1 行起', '⋯ 3 行未变更']);
  });
});

describe('highlightCodeLines', () => {
  it('整段高亮后按行拆分，token 带 hljs 类名（多行结构不丢）', () => {
    const lines = highlightCodeLines('export const a = 1;\n// comment\n', 'typescript');

    expect(lines).toBeDefined();
    expect(lines?.[0]?.some((token) => token.className?.includes('hljs-keyword'))).toBe(true);
    expect(lines?.[1]?.some((token) => token.className?.includes('hljs-comment'))).toBe(true);
  });

  it('未指定语言 / 超预算时返回 undefined（调用方退回纯文本）', () => {
    expect(highlightCodeLines('const a = 1;', undefined)).toBeUndefined();
    expect(highlightCodeLines('x'.repeat(80_001), 'typescript')).toBeUndefined();
  });

  it('minimal chrome 的 diff 渲染 hljs token 而不是纯文本', () => {
    const { container } = render(
      <UnifiedCodeDiff
        afterText={AFTER_TEXT}
        beforeText={BEFORE_TEXT}
        chrome="minimal"
        filePath="src/a.ts"
      />,
    );

    expect(container.querySelectorAll('span[class*="hljs-"]').length).toBeGreaterThan(0);
  });
});

describe('parseSnapshotDiffRows — 新建文件（before 为空）', () => {
  it('全部按新增处理，不产生幽灵 context 行', () => {
    const after = ['const a = 1;', '', 'const b = 2;'].join('\n');
    const rows = parseSnapshotDiffRows('', after);

    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.left.kind === 'empty' && row.right.kind === 'added')).toBe(true);
    expect(summarizeSnapshotDiff('', after)).toEqual({ added: 3, removed: 0 });
  });
});

describe('split 视图高亮 / 超长 diff 渲染上限', () => {
  it('split 模式左右两侧都渲染 hljs token', () => {
    const { container } = render(
      <UnifiedCodeDiff
        afterText={AFTER_TEXT}
        beforeText={BEFORE_TEXT}
        chrome="minimal"
        filePath="src/a.ts"
        viewMode="split"
      />,
    );

    expect(container.querySelectorAll('span[class*="hljs-"]').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('[class*="hljs-keyword"]').length).toBeGreaterThan(0);
  });

  it('超过 600 行时先渲染上限 + 展开入口，点击后放开全部', () => {
    const count = 320; // 320 组替换 → 640 行（刚好越过上限，测试保持轻量）
    const before = Array.from({ length: count }, (_, i) => `const v${i} = ${i};`).join('\n');
    const after = Array.from({ length: count }, (_, i) => `const v${i} = ${i + 1};`).join('\n');
    const { container } = render(
      <UnifiedCodeDiff afterText={after} beforeText={before} chrome="minimal" />,
    );

    expect(container.querySelectorAll('[data-diff-row]')).toHaveLength(600);
    const expand = container.querySelector('[data-diff-expand="true"]');
    expect(expand?.textContent).toContain('还有');

    if (!expand) throw new Error('未渲染展开入口');
    fireEvent.click(expand);
    expect(container.querySelectorAll('[data-diff-row]')).toHaveLength(640);
    expect(container.querySelector('[data-diff-expand="true"]')).toBeNull();
  });
});
