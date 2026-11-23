import { describe, expect, it } from 'vitest';
import { collapseSnapshotRows, parseSnapshotDiffRows } from './UnifiedCodeDiff.js';

/** 构造一个 N 行的文件内容（每行内容不同，便于定位）。 */
function makeFile(lineCount: number, prefix = 'line'): string {
  return Array.from({ length: lineCount }, (_, index) => `${prefix} ${index + 1}`).join('\n');
}

/** 把某一行替换掉，制造一处单行修改。 */
function replaceLine(text: string, lineNumber: number, replacement: string): string {
  const lines = text.split('\n');
  lines[lineNumber - 1] = replacement;
  return lines.join('\n');
}

function changedRowCount(
  rows: readonly ReturnType<typeof parseSnapshotDiffRows>[number][],
): number {
  return rows.filter(
    (row) => row.type === 'change' && (row.left.kind === 'removed' || row.right.kind === 'added'),
  ).length;
}

describe('collapseSnapshotRows', () => {
  it('小文件不折叠（改动本来就在视野内）', () => {
    const before = makeFile(6);
    const after = replaceLine(before, 3, 'changed');
    const rows = parseSnapshotDiffRows(before, after);
    expect(collapseSnapshotRows(rows)).toHaveLength(rows.length);
  });

  it('大文件只改一行时，渲染量降到「变更 + 上下文」量级', () => {
    const before = makeFile(2000);
    const after = replaceLine(before, 1000, 'changed');
    const rows = parseSnapshotDiffRows(before, after);
    const collapsed = collapseSnapshotRows(rows);

    // 2000 行文件 → 折叠后应远小于原行数
    expect(collapsed.length).toBeLessThan(20);
    expect(collapsed.length).toBeGreaterThan(0);
    // 变更行必须仍然在结果里（这是本函数存在的唯一理由）
    expect(changedRowCount(collapsed)).toBeGreaterThan(0);
  });

  it('变更位于文件末尾时，前面的未变更区被折叠而不是把变更挤出视野', () => {
    const before = makeFile(1500);
    const after = replaceLine(before, 1490, 'changed');
    const rows = parseSnapshotDiffRows(before, after);
    const collapsed = collapseSnapshotRows(rows);

    expect(changedRowCount(collapsed)).toBeGreaterThan(0);
    expect(collapsed.length).toBeLessThan(30);
    // 折叠占位行出现在变更之前
    const firstCollapsedIndex = collapsed.findIndex((row) => row.type === 'hunk');
    const firstChangedIndex = collapsed.findIndex(
      (row) => row.type === 'change' && (row.left.kind === 'removed' || row.right.kind === 'added'),
    );
    expect(firstCollapsedIndex).toBeGreaterThanOrEqual(0);
    expect(firstCollapsedIndex).toBeLessThan(firstChangedIndex);
  });

  it('多处相隔很远的变更各自保留上下文，中间各有一个占位行', () => {
    let after = makeFile(3000);
    after = replaceLine(after, 100, 'first change');
    after = replaceLine(after, 1500, 'second change');
    after = replaceLine(after, 2900, 'third change');
    const before = makeFile(3000);

    const collapsed = collapseSnapshotRows(parseSnapshotDiffRows(before, after));
    const hunkCount = collapsed.filter((row) => row.type === 'hunk').length;
    expect(hunkCount).toBeGreaterThanOrEqual(2);
    expect(changedRowCount(collapsed)).toBeGreaterThanOrEqual(3);
  });

  it('占位行如实报出被折叠的行数，不吞掉信息', () => {
    const before = makeFile(1000);
    const after = replaceLine(before, 500, 'changed');
    const collapsed = collapseSnapshotRows(parseSnapshotDiffRows(before, after), 3);

    const placeholders = collapsed.filter((row) => row.type === 'hunk');
    expect(placeholders.length).toBeGreaterThan(0);

    const reported = placeholders.reduce((sum, row) => {
      const match = /(\d+) 行未变更/u.exec(row.left.text);
      return sum + Number.parseInt(match?.[1] ?? '0', 10);
    }, 0);
    const keptContext = collapsed.filter(
      (row) => row.type === 'change' && row.left.kind === 'context',
    ).length;
    // 折叠掉的 + 保留的上下文 ≈ 原文件行数（允许 ±2 的边界误差）
    expect(Math.abs(reported + keptContext - 1000)).toBeLessThanOrEqual(2);
  });

  it('上下文行数可配置', () => {
    const before = makeFile(500);
    const after = replaceLine(before, 250, 'changed');
    const rows = parseSnapshotDiffRows(before, after);

    const tight = collapseSnapshotRows(rows, 1);
    const loose = collapseSnapshotRows(rows, 8);
    expect(loose.length).toBeGreaterThan(tight.length);
  });

  it('没有任何变更时不折叠（纯上下文折叠没有意义）', () => {
    const text = makeFile(800);
    const rows = parseSnapshotDiffRows(text, text);
    expect(collapseSnapshotRows(rows)).toHaveLength(rows.length);
  });

  it('变更过于密集、折叠不减少行数时保持原样', () => {
    // 每隔一行改一次 → 上下文窗口几乎覆盖全文
    const before = makeFile(40);
    const after = before
      .split('\n')
      .map((line, index) => (index % 2 === 0 ? `${line} changed` : line))
      .join('\n');
    const rows = parseSnapshotDiffRows(before, after);
    expect(collapseSnapshotRows(rows, 3)).toHaveLength(rows.length);
  });

  it('空输入返回空数组', () => {
    expect(collapseSnapshotRows([])).toEqual([]);
  });

  it('折叠不改变差异统计口径（行数统计仍按完整内容算）', () => {
    const before = makeFile(2000);
    const after = replaceLine(before, 1200, 'changed');
    const collapsed = collapseSnapshotRows(parseSnapshotDiffRows(before, after));

    // 折叠后仍然能数出 1 处删除 + 1 处新增（单行替换）
    const removed = collapsed.filter(
      (row) => row.type === 'change' && row.left.kind === 'removed',
    ).length;
    const added = collapsed.filter(
      (row) => row.type === 'change' && row.right.kind === 'added',
    ).length;
    expect(removed).toBe(1);
    expect(added).toBe(1);
  });
});
