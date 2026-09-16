/**
 * 控制台调用栈的纯展示格式化。
 *
 * 实时引擎（CDP）会在控制台条目上附带两类栈帧：`stack` 是打包后文件的原始
 * 位置，`sourceMappedStack` 是 dev server source map 解析后的源码位置。两者的
 * 行列都是 0-based（与 CDP 一致），而面板展示必须转成人类习惯的 1-based。
 *
 * 这里只做「数据 → 展示字符串」的纯计算：坐标转换、长 URL 截断、未映射判定、
 * 帧数上限。渲染与交互在 `browser-console-stack.tsx`，本模块因此可直接单测。
 */

import type {
  ConsoleEntry,
  ConsoleSourceMappedStackFrame,
  ConsoleStackFrame,
} from './browser-console-types.js';

/** 面板最多展示的帧数（后端已按 ~12 帧截断，前端保持同量级上限）。 */
export const CONSOLE_STACK_MAX_FRAMES = 12;

/** 位置串（`文件:行:列`）超过该长度时按尾部截断展示。 */
export const CONSOLE_STACK_LOCATION_MAX_CHARS = 64;

/** 未映射帧的固定标记；渲染与测试共用同一常量，避免字面量漂移。 */
export const CONSOLE_STACK_UNMAPPED_LABEL = '未映射';

/** 输入帧：原始帧或 source map 解析帧（由是否携带 `mapped` 区分）。 */
export type ConsoleStackFrameInput = ConsoleStackFrame | ConsoleSourceMappedStackFrame;

export interface ConsoleStackFrameView {
  /** 展示序号（1-based，与「堆栈 · N 帧」的计数一致）。 */
  ordinal: number;
  /** 函数名；缺省或空白串时为 null。 */
  functionName: string | null;
  /** 完整位置串 `文件:行:列`（行列已 +1），悬停与复制都用它。 */
  location: string;
  /** 实际渲染的位置串；超长时被尾部截断。 */
  displayLocation: string;
  /** `displayLocation` 是否发生过截断。 */
  truncated: boolean;
  /** 该帧是否未能映射到源码（展示的是打包后位置）。 */
  unmapped: boolean;
}

export interface ConsoleStackView {
  /** 实际展示的帧（最多 `CONSOLE_STACK_MAX_FRAMES` 帧）。 */
  frames: ConsoleStackFrameView[];
  /** 输入帧总数（截断前）。 */
  total: number;
  /** 因超出上限而未展示的帧数。 */
  hiddenCount: number;
  /** 是否存在至少一个成功映射到源码的帧。 */
  hasMappedFrames: boolean;
}

/**
 * CDP / source map 的行列都是 0-based；展示统一 +1。
 *
 * 非有限值与负数按 0 处理，保证任何 wire 脏数据都得到稳定的 1-based 结果。
 */
export function toDisplayPosition(zeroBased: number): number {
  return (Number.isFinite(zeroBased) ? Math.max(0, Math.trunc(zeroBased)) : 0) + 1;
}

/**
 * 超长位置串按尾部截断：保留结尾的 `文件:行:列` 坐标，前缀用 `…` 标记。
 *
 * 完整值在这里不丢失——调用方仍持有原始 `location`（悬停 / 复制用）。
 */
export function truncateStackLocation(
  location: string,
  maxChars: number = CONSOLE_STACK_LOCATION_MAX_CHARS,
): { text: string; truncated: boolean } {
  if (location.length <= maxChars) return { text: location, truncated: false };
  if (maxChars <= 1) return { text: '…', truncated: true };
  return { text: `…${location.slice(location.length - (maxChars - 1))}`, truncated: true };
}

/**
 * 单帧 → 视图；`functionName` 空白串按缺省处理。
 *
 * `rawFallback` 是 source map 解析帧对应的原始帧（同下标）：解析帧未映射时
 * 优先用它，缺省时退回解析帧自带的原始 `url` / `line` / `column` 字段。
 */
export function toStackFrameView(
  frame: ConsoleStackFrameInput,
  rawFallback?: ConsoleStackFrame,
  ordinal = 1,
): ConsoleStackFrameView {
  const mappedLocation = resolveMappedLocation(frame);
  const raw = rawFallback ?? frame;
  const location = mappedLocation ?? formatRawLocation(raw);
  const { text, truncated } = truncateStackLocation(location);

  return {
    ordinal,
    functionName: normalizeFunctionName(frame.functionName),
    location,
    displayLocation: text,
    truncated,
    unmapped: mappedLocation === null,
  };
}

/**
 * 把条目携带的栈整理成可渲染视图；没有任何帧时返回 null（不渲染展开入口）。
 *
 * 优先级：`sourceMappedStack` 非空时逐帧优先源码位置；该帧 `mapped: false`
 * 或解析结果缺 `sourceName` / `sourceLine` 时，回落到同下标的原始帧并标记
 * `unmapped`。`sourceMappedStack` 缺失或为空数组时整条回落 `stack`，同样标记。
 */
export function buildConsoleStackView(
  entry: Pick<ConsoleEntry, 'stack' | 'sourceMappedStack'>,
  maxFrames: number = CONSOLE_STACK_MAX_FRAMES,
): ConsoleStackView | null {
  const raw = entry.stack ?? [];
  const resolved = entry.sourceMappedStack ?? [];
  const useResolved = resolved.length > 0;
  const frames: ConsoleStackFrameInput[] = useResolved ? resolved : raw;
  if (frames.length === 0) return null;

  const limit = maxFrames > 0 ? maxFrames : frames.length;
  const views = frames
    .slice(0, limit)
    .map((frame, index) => toStackFrameView(frame, useResolved ? raw[index] : undefined, index + 1));

  return {
    frames: views,
    total: frames.length,
    hiddenCount: frames.length - views.length,
    hasMappedFrames: views.some((view) => !view.unmapped),
  };
}

function resolveMappedLocation(frame: ConsoleStackFrameInput): string | null {
  if (!('mapped' in frame) || frame.mapped !== true) return null;
  const name = frame.sourceName;
  if (typeof name !== 'string' || name.length === 0) return null;
  if (typeof frame.sourceLine !== 'number') return null;

  const column =
    typeof frame.sourceColumn === 'number' ? `:${toDisplayPosition(frame.sourceColumn)}` : '';
  return `${name}:${toDisplayPosition(frame.sourceLine)}${column}`;
}

function formatRawLocation(frame: ConsoleStackFrame): string {
  return `${frame.url}:${toDisplayPosition(frame.line)}:${toDisplayPosition(frame.column)}`;
}

function normalizeFunctionName(value: string | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
