/**
 * `workspace-resize` 纯函数单测。
 *
 * 真实拖拽断言（pointer capture + 键盘）已由共享 primitive 的
 * `layout/shared/resize-handle.test.tsx` 覆盖；这里只锁住本适配器独有的
 * 「约束钳制」与「像素 ↔ 持久化百分比往返」，避免 jsdom 中做无意义的合成拖拽。
 */
import { describe, expect, it } from 'vitest';
import {
  FILE_TREE_WIDTH_DEFAULT,
  FILE_TREE_WIDTH_MAX,
  FILE_TREE_WIDTH_MIN,
  WORKSPACE_SPLIT_DEFAULT_PCT,
  WORKSPACE_SPLIT_MAX_PCT,
  WORKSPACE_SPLIT_MIN_PCT,
  clampEditorWidthPx,
  clampFileTreeWidth,
  clampWorkspaceSplitPct,
  editorWidthBoundsPx,
  splitPosFromEditorWidthPx,
  splitPosToEditorWidthPx,
} from './workspace-resize.js';

const ROW_WIDTH_PX = 1200;

describe('clampFileTreeWidth', () => {
  it('钳制到 [140, 480]，非法值回落到默认 220', () => {
    expect(clampFileTreeWidth(0)).toBe(FILE_TREE_WIDTH_MIN);
    expect(clampFileTreeWidth(FILE_TREE_WIDTH_MIN - 1)).toBe(FILE_TREE_WIDTH_MIN);
    expect(clampFileTreeWidth(300)).toBe(300);
    expect(clampFileTreeWidth(FILE_TREE_WIDTH_MAX + 1)).toBe(FILE_TREE_WIDTH_MAX);
    expect(clampFileTreeWidth(Number.NaN)).toBe(FILE_TREE_WIDTH_DEFAULT);
  });
});

describe('clampWorkspaceSplitPct', () => {
  it('钳制到持久化契约的 [20, 80]', () => {
    expect(clampWorkspaceSplitPct(WORKSPACE_SPLIT_MIN_PCT - 1)).toBe(WORKSPACE_SPLIT_MIN_PCT);
    expect(clampWorkspaceSplitPct(WORKSPACE_SPLIT_MAX_PCT + 1)).toBe(WORKSPACE_SPLIT_MAX_PCT);
    expect(clampWorkspaceSplitPct(63)).toBe(63);
    expect(clampWorkspaceSplitPct(Number.NaN)).toBe(WORKSPACE_SPLIT_DEFAULT_PCT);
  });
});

describe('splitPosToEditorWidthPx', () => {
  it('按面板宽度 = 行宽 × (100 - splitPos)% 换算，并在边界钳制', () => {
    expect(splitPosToEditorWidthPx(WORKSPACE_SPLIT_DEFAULT_PCT, ROW_WIDTH_PX)).toBe(600);
    expect(splitPosToEditorWidthPx(WORKSPACE_SPLIT_MIN_PCT, ROW_WIDTH_PX)).toBe(960);
    expect(splitPosToEditorWidthPx(WORKSPACE_SPLIT_MAX_PCT, ROW_WIDTH_PX)).toBe(240);
    expect(splitPosToEditorWidthPx(10, ROW_WIDTH_PX)).toBe(960);
    expect(splitPosToEditorWidthPx(50, 0)).toBe(0);
  });
});

describe('splitPosFromEditorWidthPx', () => {
  it('像素宽度换算回百分比，并在 min/max 处钳制', () => {
    expect(splitPosFromEditorWidthPx(600, ROW_WIDTH_PX)).toBe(50);
    expect(splitPosFromEditorWidthPx(960, ROW_WIDTH_PX)).toBe(WORKSPACE_SPLIT_MIN_PCT);
    expect(splitPosFromEditorWidthPx(240, ROW_WIDTH_PX)).toBe(WORKSPACE_SPLIT_MAX_PCT);
    expect(splitPosFromEditorWidthPx(0, ROW_WIDTH_PX)).toBe(WORKSPACE_SPLIT_MAX_PCT);
    expect(splitPosFromEditorWidthPx(ROW_WIDTH_PX, ROW_WIDTH_PX)).toBe(WORKSPACE_SPLIT_MIN_PCT);
    expect(splitPosFromEditorWidthPx(200, ROW_WIDTH_PX)).toBe(WORKSPACE_SPLIT_MAX_PCT);
    expect(splitPosFromEditorWidthPx(1000, ROW_WIDTH_PX)).toBe(WORKSPACE_SPLIT_MIN_PCT);
    expect(splitPosFromEditorWidthPx(600, 0)).toBe(WORKSPACE_SPLIT_DEFAULT_PCT);
  });

  it('像素 ↔ 百分比往返稳定（持久化 round-trip）', () => {
    for (const pct of [20, 33, 50, 66.67, 80]) {
      const px = splitPosToEditorWidthPx(pct, ROW_WIDTH_PX);
      expect(splitPosFromEditorWidthPx(px, ROW_WIDTH_PX)).toBeCloseTo(pct, 8);
    }
  });
});

describe('editorWidthBoundsPx / clampEditorWidthPx', () => {
  it('bounds 为行宽的 20%–80%，默认 50%', () => {
    expect(editorWidthBoundsPx(ROW_WIDTH_PX)).toEqual({ min: 240, max: 960, default: 600 });
  });

  it('拖拽像素宽度钳制在 bounds 内', () => {
    expect(clampEditorWidthPx(-100, ROW_WIDTH_PX)).toBe(240);
    expect(clampEditorWidthPx(700, ROW_WIDTH_PX)).toBe(700);
    expect(clampEditorWidthPx(2400, ROW_WIDTH_PX)).toBe(960);
    expect(clampEditorWidthPx(700, 0)).toBe(0);
  });
});
