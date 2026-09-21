/**
 * 移动端图片查看器缩放层的平台无关纯逻辑（W2b / T-09）。
 *
 * 这里是缩放层数学契约的单一事实来源：距离比缩放、焦点缩放、平移夹取、双击目标与
 * 门控布尔派生。模块**不 import `react` / `react-native`**，可在纯 Node（Vitest）
 * 下直接测试；平台差异（iOS 原生 `ScrollView` / Android 自研 `PanResponder`）只影响
 * 手势来源，不影响这里的任何一条公式。
 *
 * 坐标系约定（与 RN `transform` 语义逐字对齐）：本模块出现的坐标一律是**相对内容
 * 中心**的局部坐标；`translate` 与 `focal` 同处一个空间。`transform` 数组按
 * `[{ translateX }, { translateY }, { scale }]` 书写时，屏幕坐标为
 * `screen = translate + scale × local`（已核对两平台原生实现：
 * iOS `React/Views/RCTConvert+Transform.m` 的 `CATransform3DTranslate(transform, …)`、
 * Android `ReactAndroid/…/TransformHelper.kt` 的 `multiplyInto(result, result, helper)`
 * 都是「先缩放、后平移」，即平移量不被缩放放大）。焦点缩放公式与它在同一坐标系下成对，
 * 换坐标系会让锚点整体偏移。
 *
 * 缩放上下界**复用** `./lightbox-model` 的常量（本模块只再导出，不重新定义），
 * 保证图片查看器只有一份缩放语义。
 */
import { MAX_ZOOM_SCALE, MIN_ZOOM_SCALE, ZOOM_STEP, type DisplaySize } from './lightbox-model';

export { MAX_ZOOM_SCALE, MIN_ZOOM_SCALE, ZOOM_STEP };

/** 双击判定窗口（毫秒）：RN 无内置双击，只能手写时间戳窗口。 */
export const DOUBLE_TAP_WINDOW_MS = 300;

/** 双击放大到的比例（双击在 `1 ↔ DOUBLE_TAP_SCALE` 之间切换）。 */
export const DOUBLE_TAP_SCALE = 2;

/** `deriveZoomed` 的默认容差：回弹期的 `1.0001` 必须仍算「未缩放」。 */
export const ZOOMED_TOLERANCE = 0.01;

/**
 * 容差比较的浮点补偿。
 *
 * `1 - 0.99 === 0.010000000000000009`，差值比 `0.01` 大一个 1e-18 量级，
 * 若直接用 `Math.abs(scale - 1) > tolerance` 判定，边界值 `0.99` 会被误判成「已缩放」。
 */
const TOLERANCE_FLOAT_COMPENSATION = 1e-9;

/** 未缩放比例（1×）。 */
const FIT_SCALE = 1;

/** 2D 点 / 平移量（相对内容中心的局部坐标）。 */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** `focusPointZoom` 入参。 */
export interface FocusPointZoomInput {
  /** 本次缩放前的比例（必须 > 0）。 */
  readonly scale: number;
  /** 本次缩放的目标比例。 */
  readonly nextScale: number;
  /** 焦点（局部坐标）：该处的像素在缩放前后屏幕位置不变。 */
  readonly focal: Point;
  /** 本次缩放前的位移。 */
  readonly translate: Point;
}

/** `clampTranslate` 入参。 */
export interface ClampTranslateInput {
  readonly translate: Point;
  /** 内容在 `scale = 1` 时的尺寸（如 contain 适配后的图片尺寸）。 */
  readonly contentSize: DisplaySize;
  /** 可见视口尺寸。 */
  readonly viewportSize: DisplaySize;
  readonly scale: number;
}

/** 恒零位移（内容不大于视口时复用同一对象，便于 RN 侧跳过重渲染）。 */
const ZERO_TRANSLATE: Point = Object.freeze({ x: 0, y: 0 });

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

/** 非有限分量按 0 归一：手势事件在旋转 / 多指切换瞬间可能给出无效坐标。 */
function normalizeComponent(value: number): number {
  return isFiniteNumber(value) ? value : 0;
}

function normalizePoint(point: Point): Point {
  return { x: normalizeComponent(point.x), y: normalizeComponent(point.y) };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** 缩放区间：非法值回退到正式上下界，反向区间自动交换。 */
function resolveScaleRange(
  min: number,
  max: number,
): { readonly min: number; readonly max: number } {
  const low = isFiniteNumber(min) ? min : MIN_ZOOM_SCALE;
  const high = isFiniteNumber(max) ? max : MAX_ZOOM_SCALE;
  return low <= high ? { min: low, max: high } : { min: high, max: low };
}

/** 归一并 clamp 后的比例。 */
function resolveScale(
  scale: number,
  range: { readonly min: number; readonly max: number },
): number {
  return clamp(isFiniteNumber(scale) ? scale : FIT_SCALE, range.min, range.max);
}

/**
 * 双指距离 → 目标比例：`startScale × (currentDistance / startDistance)`，再 clamp 到
 * `[min, max]`。
 *
 * 这是**绝对**计算：比例始终相对手势起点，不做逐帧累乘，因此不会漂移。
 *
 * 安全性（旋转 / 手势基线失真的兜底）：
 * - `startDistance <= 0` / 非有限值 / `currentDistance` 非有限值 → 返回 clamp 后的
 *   `startScale`，绝不产生 `NaN` / `Infinity`；
 * - `startScale` 非有限值 → 以 1× 为基线；
 * - `min > max` → 自动交换。
 */
export function scaleFromPinchDistance(
  startDistance: number,
  currentDistance: number,
  startScale: number,
  min: number = MIN_ZOOM_SCALE,
  max: number = MAX_ZOOM_SCALE,
): number {
  const range = resolveScaleRange(min, max);
  const baseScale = resolveScale(startScale, range);
  if (!isFiniteNumber(startDistance) || startDistance <= 0 || !isFiniteNumber(currentDistance)) {
    return baseScale;
  }
  return resolveScale(baseScale * (currentDistance / startDistance), range);
}

/**
 * 焦点缩放：`t' = f - (f - t) × (s' / s)`。
 *
 * 不变量：焦点 `f` 下方的那个像素缩放前后停在同一个屏幕位置 —— 设
 * `c = (f - t) / s`，则 `c × s' + t' = f` 恒成立（测试里逐组数值验证）。
 *
 * 非法入参不抛错、不中断手势链：比例非法（非有限 / `<= 0`）时原样返回位移，
 * 焦点或位移含非有限分量时按 0 归一。
 */
export function focusPointZoom(input: FocusPointZoomInput): Point {
  const { scale, nextScale, focal, translate } = input;
  const currentTranslate = normalizePoint(translate);
  if (!isFiniteNumber(scale) || scale <= 0 || !isFiniteNumber(nextScale) || nextScale <= 0) {
    return currentTranslate;
  }
  const focus = normalizePoint(focal);
  const ratio = nextScale / scale;
  return {
    x: focus.x - (focus.x - currentTranslate.x) * ratio,
    y: focus.y - (focus.y - currentTranslate.y) * ratio,
  };
}

/** 单轴夹取：内容（含缩放）不大于视口时恒为 0。 */
function clampAxis(
  value: number,
  contentSpan: number,
  viewportSpan: number,
  scale: number,
): number {
  if (
    !isFiniteNumber(contentSpan) ||
    !isFiniteNumber(viewportSpan) ||
    contentSpan <= 0 ||
    viewportSpan <= 0
  ) {
    return 0;
  }
  const scaledSpan = contentSpan * scale;
  if (!isFiniteNumber(scaledSpan) || scaledSpan <= viewportSpan) {
    return 0;
  }
  const limit = (scaledSpan - viewportSpan) / 2;
  return clamp(value, -limit, limit);
}

/**
 * 平移夹取（防「图飘走」）：逐轴独立计算，只有内容放大到超出视口的部分才允许平移，
 * 且位移对称限制在 `±(内容 × scale − 视口) / 2`（内容与视口同心）。
 *
 * **内容（含缩放）不大于视口时位移恒为 0**：1× 下图片必然居中，缩回 1× 时自动归位；
 * 非法尺寸 / `scale <= 0` / 非有限值同样按「内容小于视口」处理，返回零位移。
 */
export function clampTranslate(input: ClampTranslateInput): Point {
  const { scale } = input;
  const translate = normalizePoint(input.translate);
  if (!isFiniteNumber(scale) || scale <= 0) {
    return ZERO_TRANSLATE;
  }
  const x = clampAxis(translate.x, input.contentSize.width, input.viewportSize.width, scale);
  const y = clampAxis(translate.y, input.contentSize.height, input.viewportSize.height, scale);
  return x === 0 && y === 0 ? ZERO_TRANSLATE : { x, y };
}

/**
 * 双击目标比例：`scale > 1` → 1（复位），否则 → `DOUBLE_TAP_SCALE`（2×）。
 *
 * `tolerance` 默认 0（严格按 `scale > 1` 判定）；Android 手势层传
 * `ZOOMED_TOLERANCE`，让回弹期停在 `1.005` 这类值时双击仍能放大到 2×，
 * 而不是得到一个「看起来没反应」的 1×。
 *
 * 非有限值按「未放大」处理，保证双击永远有可见反馈。
 */
export function nextDoubleTapScale(scale: number, tolerance: number = 0): number {
  if (!isFiniteNumber(scale)) {
    return DOUBLE_TAP_SCALE;
  }
  const relaxedTolerance = isFiniteNumber(tolerance) && tolerance > 0 ? tolerance : 0;
  return scale > FIT_SCALE + relaxedTolerance ? FIT_SCALE : DOUBLE_TAP_SCALE;
}

/**
 * 缩放门控布尔（**单一事实来源**）：`|scale − 1| > tolerance` 才算「已缩放」。
 *
 * 容差的理由：iOS 原生回弹（`bouncesZoom`）与浮点误差会把比例停在 `1.0001` 这类值上，
 * 没有容差就会把翻页永久锁死。边界值 `0.99` 同样必须落在容差内（浮点补偿见
 * `TOLERANCE_FLOAT_COMPENSATION`）。
 *
 * 非有限值一律视为「未缩放」（fail-open）：宁可放行翻页，也不让异常状态锁死导航。
 */
export function deriveZoomed(scale: number, tolerance: number = ZOOMED_TOLERANCE): boolean {
  if (!isFiniteNumber(scale)) {
    return false;
  }
  const effectiveTolerance =
    isFiniteNumber(tolerance) && tolerance >= 0 ? tolerance : ZOOMED_TOLERANCE;
  return Math.abs(scale - FIT_SCALE) > effectiveTolerance + TOLERANCE_FLOAT_COMPENSATION;
}

/** 两点距离（双指初始距离 / 实时距离）；含非有限分量时按 0 归一，绝不返回 `NaN`。 */
export function distanceBetween(from: Point, to: Point): number {
  const deltaX = normalizeComponent(from.x) - normalizeComponent(to.x);
  const deltaY = normalizeComponent(from.y) - normalizeComponent(to.y);
  const distance = Math.hypot(deltaX, deltaY);
  return isFiniteNumber(distance) ? distance : 0;
}

/** 两点中点（双指焦点）；含非有限分量时按 0 归一。 */
export function midpoint(from: Point, to: Point): Point {
  return {
    x: (normalizeComponent(from.x) + normalizeComponent(to.x)) / 2,
    y: (normalizeComponent(from.y) + normalizeComponent(to.y)) / 2,
  };
}
