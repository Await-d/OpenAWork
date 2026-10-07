/**
 * ComposerStatsBar 单行适配的纯计算层。
 *
 * 统计栏强制单行展示：宽度不足时按「优先级」从低到高裁掉统计项；仍不足时
 * 进入紧凑模式（隐藏文字标签，仅保留图标 + 数值）；极端窄容器下只保留优先级
 * 最高的一项。宽度采用文本估算而非 DOM 实测——统计栏随流式输出高频变化，
 * 实测会带来额外布局抖动与 ResizeObserver 循环。
 *
 * 容器层另有一层 `overflow-x: auto` 兜底，确保任何情况下都不会换成两行。
 */

export type StatsBarItemKind = 'stat' | 'separator' | 'note';

export interface StatsBarItemMetrics {
  /** 渲染形态：普通统计项 / 分隔线 / 脚注。 */
  readonly kind?: StatsBarItemKind;
  /** 标签文本（紧凑模式下隐藏）。 */
  readonly label: string;
  /** 数值文本。 */
  readonly value: string;
  /** 是否附带上下文占用条（占用条 + 百分比）。 */
  readonly hasMeter?: boolean;
  /** 裁剪优先级：数值越大越先被隐藏；0 表示永不隐藏。 */
  readonly priority: number;
}

export interface StatsBarFitInput {
  /** 容器可用宽度（px）；<= 0 表示尚未测量，按「全部可见」处理。 */
  readonly availableWidth: number;
  readonly items: readonly StatsBarItemMetrics[];
  /** 相邻项之间的间距（px）。 */
  readonly gap?: number;
}

export interface StatsBarFit {
  /** 与 `items` 等长的可见性标记。 */
  readonly visible: boolean[];
  /** 是否进入紧凑模式（隐藏标签文字）。 */
  readonly compact: boolean;
}

const ITEM_FONT_SIZE = 10;
const NOTE_FONT_SIZE = 9;
const ICON_SIZE = 12;
const ITEM_GAP = 4;
const METER_BAR_WIDTH = 36;
const METER_GAP = 3;
const SEPARATOR_WIDTH = 1;
const DEFAULT_COLUMN_GAP = 6;
/** 估算误差余量：宁可少显示一项，也不要让统计栏出现横向滚动。 */
const SAFETY_RATIO = 0.96;
/** 非 ASCII 可打印字符按全角计（CJK / 全角标点）。 */
const WIDE_CHAR = /[^\u0020-\u007e]/;
const NARROW_CHAR_RATIO = 0.58;

/** 估算文本像素宽度：全角按 1em，其余按 0.58em。 */
export function estimateTextWidth(text: string, fontSize: number = ITEM_FONT_SIZE): number {
  let units = 0;
  for (const char of text) {
    units += WIDE_CHAR.test(char) ? 1 : NARROW_CHAR_RATIO;
  }
  return units * fontSize;
}

function statItemWidth(item: StatsBarItemMetrics, compact: boolean): number {
  const label = compact ? 0 : estimateTextWidth(item.label) + ITEM_GAP;
  // 紧凑模式同时舍弃标签文字与占用条（百分比仍在 tooltip 里），否则核心项本身就放不下。
  const meter =
    item.hasMeter && !compact
      ? METER_GAP + METER_BAR_WIDTH + METER_GAP + estimateTextWidth('100%')
      : 0;
  return ICON_SIZE + ITEM_GAP + label + estimateTextWidth(item.value) + meter;
}

function itemWidth(item: StatsBarItemMetrics, compact: boolean): number {
  switch (item.kind) {
    case 'separator':
      // 紧凑模式是「图标 + 数值」的极简一排，分隔线只会制造视觉噪声。
      return compact ? 0 : SEPARATOR_WIDTH;
    case 'note':
      return estimateTextWidth(item.value, NOTE_FONT_SIZE);
    default:
      return statItemWidth(item, compact);
  }
}

function totalWidth(visible: boolean[], widths: number[], gap: number): number {
  let sum = 0;
  let shown = 0;
  visible.forEach((on, index) => {
    if (!on) return;
    sum += widths[index] ?? 0;
    shown += 1;
  });
  return shown === 0 ? 0 : sum + gap * (shown - 1);
}

/** 裁剪顺序：优先级高的先丢；同优先级时靠后的先丢。priority 0 永不隐藏。 */
function dropOrderOf(items: readonly StatsBarItemMetrics[]): number[] {
  return items
    .map((item, index) => ({ index, priority: item.priority }))
    .filter((entry) => entry.priority > 0)
    .sort((a, b) => b.priority - a.priority || b.index - a.index)
    .map((entry) => entry.index);
}

function dropUntilFits(
  items: readonly StatsBarItemMetrics[],
  compact: boolean,
  order: number[],
  budget: number,
  gap: number,
): boolean[] {
  const widths = items.map((item) => itemWidth(item, compact));
  const visible = items.map(() => true);
  for (const index of order) {
    if (totalWidth(visible, widths, gap) <= budget) break;
    visible[index] = false;
  }
  return visible;
}

/** 最关键的一项：priority 最低（同值取靠前），用于极窄容器兜底。 */
function keepOnlyPrimary(items: readonly StatsBarItemMetrics[]): boolean[] {
  let primary = 0;
  for (let index = 1; index < items.length; index += 1) {
    const current = items[index]?.priority ?? Number.MAX_SAFE_INTEGER;
    const best = items[primary]?.priority ?? Number.MAX_SAFE_INTEGER;
    if (current < best) primary = index;
  }
  return items.map((_, index) => index === primary);
}

export function resolveStatsBarFit({
  availableWidth,
  items,
  gap = DEFAULT_COLUMN_GAP,
}: StatsBarFitInput): StatsBarFit {
  if (items.length === 0) return { visible: [], compact: false };
  if (availableWidth <= 0) return { visible: items.map(() => true), compact: false };

  const budget = availableWidth * SAFETY_RATIO;
  const order = dropOrderOf(items);

  const full = dropUntilFits(items, false, order, budget, gap);
  if (
    totalWidth(
      full,
      items.map((item) => itemWidth(item, false)),
      gap,
    ) <= budget
  ) {
    return { visible: full, compact: false };
  }

  const compact = dropUntilFits(items, true, order, budget, gap);
  if (
    totalWidth(
      compact,
      items.map((item) => itemWidth(item, true)),
      gap,
    ) <= budget
  ) {
    return { visible: compact, compact: true };
  }

  return { visible: keepOnlyPrimary(items), compact: true };
}
