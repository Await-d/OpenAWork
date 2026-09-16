/**
 * 文件编辑器工作区可拖拽尺寸的纯计算约束。
 *
 * 拖拽本身由共享的 `ResizeHandle`（pointer capture + 键盘 + ARIA）承担，
 * 这里只保留「约束 / 单位换算」这两段业务逻辑，便于单测覆盖边界值与持久化往返。
 *
 * - 文件树宽度：像素，仅存在组件内存（无持久化）。
 * - 编辑器分屏：持久化值是 20–80 的百分比数字（既有 store / 回调契约，勿改）。
 */

import type { ResizeHandleBounds } from '../layout/shared/resize-handle.js';

// ── 文件树宽度（px） ────────────────────────────────────────────────

export const FILE_TREE_WIDTH_MIN = 140;
export const FILE_TREE_WIDTH_MAX = 480;
export const FILE_TREE_WIDTH_DEFAULT = 220;

/** 文件树宽度钳制到 [140, 480]。 */
export function clampFileTreeWidth(width: number): number {
  if (!Number.isFinite(width)) return FILE_TREE_WIDTH_DEFAULT;
  return Math.min(FILE_TREE_WIDTH_MAX, Math.max(FILE_TREE_WIDTH_MIN, width));
}

// ── 编辑器分屏（持久化百分比） ──────────────────────────────────────

export const WORKSPACE_SPLIT_MIN_PCT = 20;
export const WORKSPACE_SPLIT_MAX_PCT = 80;
export const WORKSPACE_SPLIT_DEFAULT_PCT = 50;

/** 分屏值钳制到 [20, 80]（与 `uiState.setTeamSplitPos` 的约束一致）。 */
export function clampWorkspaceSplitPct(pct: number): number {
  if (!Number.isFinite(pct)) return WORKSPACE_SPLIT_DEFAULT_PCT;
  return Math.min(WORKSPACE_SPLIT_MAX_PCT, Math.max(WORKSPACE_SPLIT_MIN_PCT, pct));
}

/**
 * 持久化分屏值 → 编辑器面板像素宽度。
 *
 * 既有渲染约定：面板宽度 = 行宽 × (100 - splitPos)%，即 splitPos 越小面板越宽。
 */
export function splitPosToEditorWidthPx(splitPosPct: number, rowWidthPx: number): number {
  if (!(rowWidthPx > 0)) return 0;
  return ((100 - clampWorkspaceSplitPct(splitPosPct)) / 100) * rowWidthPx;
}

/**
 * 编辑器面板像素宽度 → 下一次持久化的分屏值（已钳制）。
 *
 * 与 {@link splitPosToEditorWidthPx} 互逆：面板宽度百分比 p 对应 splitPos = 100 - p。
 */
export function splitPosFromEditorWidthPx(editorWidthPx: number, rowWidthPx: number): number {
  if (!(rowWidthPx > 0)) return WORKSPACE_SPLIT_DEFAULT_PCT;
  return clampWorkspaceSplitPct(100 - (editorWidthPx / rowWidthPx) * 100);
}

/** 面板像素宽度的合法区间（行宽的 20%–80%，默认 50%）。 */
export function editorWidthBoundsPx(rowWidthPx: number): ResizeHandleBounds {
  return {
    min: (WORKSPACE_SPLIT_MIN_PCT / 100) * rowWidthPx,
    max: (WORKSPACE_SPLIT_MAX_PCT / 100) * rowWidthPx,
    default: (WORKSPACE_SPLIT_DEFAULT_PCT / 100) * rowWidthPx,
  };
}

/** 面板像素宽度钳制到 [20%, 80%] 行宽。 */
export function clampEditorWidthPx(editorWidthPx: number, rowWidthPx: number): number {
  const { min, max } = editorWidthBoundsPx(rowWidthPx);
  if (!(max > min)) return 0;
  return Math.min(max, Math.max(min, editorWidthPx));
}
