// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { UnifiedCodeDiff } from './UnifiedCodeDiff.js';

/** 构造 N 行文件，只在指定行改一处 —— 典型的「大文件小改动」。 */
function makeLargeDiff(lineCount: number, changedLine: number): { before: string; after: string } {
  const lines = Array.from({ length: lineCount }, (_, index) => `line ${index + 1}`);
  const after = [...lines];
  after[changedLine - 1] = 'CHANGED';
  return { before: lines.join('\n'), after: after.join('\n') };
}

function countDiffRows(container: HTMLElement): number {
  return container.querySelectorAll('[data-diff-row]').length;
}

afterEach(() => {
  cleanup();
});

describe('UnifiedCodeDiff 折叠与展开', () => {
  it('大文件默认折叠，并提供「显示全部」入口', () => {
    const { before, after } = makeLargeDiff(1200, 800);
    const { container } = render(
      <UnifiedCodeDiff beforeText={before} afterText={after} viewMode="unified" />,
    );

    // 默认不铺全文
    expect(countDiffRows(container)).toBeLessThan(60);
    // 变更仍在（折叠的核心不变量）
    expect(
      container.querySelectorAll('[data-diff-row="removed"], [data-diff-row="added"]').length,
    ).toBeGreaterThan(0);

    const expand = container.querySelector('[data-diff-expand-collapsed="true"]');
    expect(expand).not.toBeNull();
    expect(expand?.textContent).toContain('显示全部');
    // 文案里的行数应是折叠前的完整行数
    expect(expand?.textContent).toContain('1200');
  });

  it('点击后按完整行数渲染，按钮消失', () => {
    const { before, after } = makeLargeDiff(1200, 800);
    const { container } = render(
      <UnifiedCodeDiff beforeText={before} afterText={after} viewMode="unified" />,
    );

    const collapsedCount = countDiffRows(container);
    fireEvent.click(container.querySelector('[data-diff-expand-collapsed="true"]')!);

    // 展开后行数显著增加，且不再有折叠入口
    expect(countDiffRows(container)).toBeGreaterThan(collapsedCount);
    expect(container.querySelector('[data-diff-expand-collapsed="true"]')).toBeNull();
  });

  it('小文件不折叠，也不出现「显示全部」入口', () => {
    const { before, after } = makeLargeDiff(8, 4);
    const { container } = render(
      <UnifiedCodeDiff beforeText={before} afterText={after} viewMode="unified" />,
    );

    expect(container.querySelector('[data-diff-expand-collapsed="true"]')).toBeNull();
    expect(container.querySelectorAll('[data-diff-row="hunk"]').length).toBe(0);
  });

  it('patch（diffText）路径不折叠，也不出现折叠入口', () => {
    const diffText = ['@@ -1,3 +1,3 @@', ' line 1', '-line 2', '+CHANGED', ' line 3'].join('\n');
    const { container } = render(<UnifiedCodeDiff diffText={diffText} viewMode="unified" />);

    expect(container.querySelector('[data-diff-expand-collapsed="true"]')).toBeNull();
  });
});
