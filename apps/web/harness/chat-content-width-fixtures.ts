/**
 * 对话内容列「随可用宽度自适应」验收夹具(entry 与 verify 共用)。
 *
 * 期望值按**文档规则独立重算**(`max(容器 × 72%, 420px)`,上限由 `width: 100%` 约束),
 * 而不是调用被测的 `resolveResponsiveContentMaxWidth` —— 避免实现改坏时两侧一起变
 * (与 `terminal-tab-label-fixtures.ts` 同一口径)。
 */

export interface ContentWidthPaneSpec {
  readonly id: string;
  readonly label: string;
  readonly paneWidthPx: number;
}

/**
 * 固定宽度的容器用例(不依赖视口尺寸:本策略以**容器**宽度为基准,
 * 视口单位 `vw` / `vh` 在分栏面板里会失真,正是要验证这一点的反面)。
 */
export const CONTENT_WIDTH_PANES: readonly ContentWidthPaneSpec[] = [
  {
    id: 'mid',
    label: '容器 1200:按 72% 收窄并居中',
    paneWidthPx: 1200,
  },
  {
    id: 'wide',
    label: '容器 1800:继续按 72% 加宽(不设上限)',
    paneWidthPx: 1800,
  },
  {
    id: 'floor',
    label: '容器 600:72% 低于 420px → 取 420px 下限',
    paneWidthPx: 600,
  },
  {
    id: 'narrow-floor',
    label: '容器 400:窄于 420px 下限 → 铺满容器且不溢出',
    paneWidthPx: 400,
  },
];

export const EXPECTED_RATIO_PERCENT = 72;
export const EXPECTED_FLOOR_PX = 420;

/** 期望的 `max-width` 解析值(px):容器占比与固定下限取大。 */
export function expectedMaxWidthPx(containerWidthPx: number): number {
  return Math.max((containerWidthPx * EXPECTED_RATIO_PERCENT) / 100, EXPECTED_FLOOR_PX);
}

/** 期望的实际渲染宽度(px):`max-width` 只是上限,`width: 100%` 仍受容器约束。 */
export function expectedColumnWidthPx(containerWidthPx: number): number {
  return Math.min(containerWidthPx, expectedMaxWidthPx(containerWidthPx));
}
