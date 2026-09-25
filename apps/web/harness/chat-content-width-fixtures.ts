/**
 * 对话内容列「随可用宽度自适应」验收夹具（entry 与 verify 共用）。
 *
 * 期望值按**文档规则独立重算**（`clamp(基准, 容器 × 88%, 基准 × 1.5)`），
 * 而不是调用被测的 `resolveResponsiveContentMaxWidth` —— 避免实现改坏时
 * 两侧一起变（与 `terminal-tab-label-fixtures.ts` 同一口径）。
 */

export interface ContentWidthPaneSpec {
  readonly id: string;
  readonly label: string;
  readonly paneWidthPx: number;
  readonly baselinePx: number;
}

/**
 * 固定宽度的容器用例（不依赖视口尺寸：本策略以**容器**宽度为基准，
 * 视口单位 `vw` / `vh` 在分栏面板里会失真，正是要验证这一点的反面）。
 */
export const CONTENT_WIDTH_PANES: readonly ContentWidthPaneSpec[] = [
  {
    id: 'b1024-narrow',
    label: '容器 900 · 基准 1024：窄于基准 → 铺满容器（下限不产生横向溢出）',
    paneWidthPx: 900,
    baselinePx: 1024,
  },
  {
    id: 'b1024-mid',
    label: '容器 1200 · 基准 1024：按容器 88% 加宽',
    paneWidthPx: 1200,
    baselinePx: 1024,
  },
  {
    id: 'b1024-wide',
    label: '容器 1800 · 基准 1024：到基准 1.5 倍封顶',
    paneWidthPx: 1800,
    baselinePx: 1024,
  },
  {
    id: 'b820-wide',
    label: '容器 1600 · 基准 820（fusion 居中列）：到 1.5 倍封顶',
    paneWidthPx: 1600,
    baselinePx: 820,
  },
  {
    id: 'b1536-split',
    label: '容器 1800 · 基准 1536（split 抬高后的基线）：仍按 88% 自适应',
    paneWidthPx: 1800,
    baselinePx: 1536,
  },
];

export const EXPECTED_RATIO_PERCENT = 88;
export const EXPECTED_GROWTH_FACTOR = 1.5;

/** 期望的 `max-width` 声明上限（px，规则里取整）。 */
export function expectedCeilingPx(baselinePx: number): number {
  return Math.round(baselinePx * EXPECTED_GROWTH_FACTOR);
}

/** 期望的 `max-width` 解析值（px）。 */
export function expectedMaxWidthPx(containerWidthPx: number, baselinePx: number): number {
  const ratioWidthPx = (containerWidthPx * EXPECTED_RATIO_PERCENT) / 100;
  return Math.min(Math.max(baselinePx, ratioWidthPx), expectedCeilingPx(baselinePx));
}

/** 期望的实际渲染宽度（px）：`max-width` 只是上限，`width: 100%` 仍受容器约束。 */
export function expectedColumnWidthPx(containerWidthPx: number, baselinePx: number): number {
  return Math.min(containerWidthPx, expectedMaxWidthPx(containerWidthPx, baselinePx));
}
