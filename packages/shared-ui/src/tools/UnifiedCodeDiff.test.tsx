// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  UnifiedCodeDiff,
  findFirstChangedRowIndex,
  parseSnapshotDiffRows,
  parseUnifiedDiffRows,
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
