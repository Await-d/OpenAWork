/**
 * GUI Agent 坐标换算（纯函数，无副作用）。
 *
 * 模型输出的坐标可能是三种形态之一：
 *  - 比例（0~1）；
 *  - 归一化整数（0~factor，默认 factor = 1000）；
 *  - 已按 `GUI_IMAGE_FACTOR`（28）预缩放的图像像素。
 * `normalizedToRatio` 负责把它们统一归一为 [0, 1] 比例；
 * `ratioToPixel` 再把比例映射回逻辑像素（点击用逻辑坐标，截图可能是物理像素）。
 */

/** 归一化坐标的默认分母（UI-TARS 训练空间为 0~1000）。 */
export const GUI_DEFAULT_FACTOR = 1000;

/** 模型图像预缩放因子（28 的倍数），用于识别已预缩放的像素坐标。 */
export const GUI_IMAGE_FACTOR = 28;

/** 逻辑尺寸（宽高，单位：逻辑像素）。 */
export interface GuiSize {
  readonly width: number;
  readonly height: number;
}

/** 二维点坐标。 */
export interface GuiPoint {
  readonly x: number;
  readonly y: number;
}

/** 矩形框：`[x1, y1, x2, y2]`，需满足 x1 < x2 且 y1 < y2。 */
export type GuiBox = readonly [number, number, number, number];

/**
 * 把任意数值收敛到 [0, 1]：
 *  - 非有限数（NaN / Infinity）返回 0；
 *  - 小于 0 返回 0；大于 1 返回 1。
 */
export function clampRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

/**
 * 把模型输出的坐标值归一为 [0, 1] 比例。
 *
 * 判定规则（按 value 的取值区间）：
 *  - `value <= 1`：视为已经是比例；
 *  - `1 < value <= factor`：视为归一化整数，`value / factor`；
 *  - `value > factor`：视为已按 `GUI_IMAGE_FACTOR` 预缩放的图像像素，
 *    结果 = `value / GUI_IMAGE_FACTOR / factor`。
 *
 * 非有限数返回 0；最终结果统一过 {@link clampRatio} 收敛到 [0, 1]。
 */
export function normalizedToRatio(value: number, factor: number = GUI_DEFAULT_FACTOR): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  // factor 非法时回退到默认分母，避免除零或 NaN 传播
  const safeFactor = Number.isFinite(factor) && factor > 0 ? factor : GUI_DEFAULT_FACTOR;

  let ratio: number;
  if (value <= 1) {
    ratio = value;
  } else if (value <= safeFactor) {
    ratio = value / safeFactor;
  } else {
    ratio = value / GUI_IMAGE_FACTOR / safeFactor;
  }
  return clampRatio(ratio);
}

/**
 * 求矩形框中心点。
 *
 * 非法 box 直接抛错（中文消息）：包含非有限数，或 x1 >= x2、y1 >= y2 的退化框。
 */
export function boxCenter(box: GuiBox): GuiPoint {
  const [x1, y1, x2, y2] = box;
  if (
    !Number.isFinite(x1) ||
    !Number.isFinite(y1) ||
    !Number.isFinite(x2) ||
    !Number.isFinite(y2)
  ) {
    throw new Error('非法 box：四个坐标必须均为有限数');
  }
  if (x1 >= x2 || y1 >= y2) {
    throw new Error('非法 box：需满足 x1 < x2 且 y1 < y2');
  }
  return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
}

/**
 * 比例 → 逻辑像素。
 *
 * `ratio × size` 得到逻辑坐标；`dpr` 默认 1，`dpr > 1` 时表示尺寸来自物理像素截图，
 * 需要除以 dpr 还原为逻辑坐标（点击使用逻辑坐标）。非法 dpr 回退为 1。
 */
export function ratioToPixel(ratio: GuiPoint, size: GuiSize, dpr: number = 1): GuiPoint {
  const safeDpr = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  return {
    x: (clampRatio(ratio.x) * size.width) / safeDpr,
    y: (clampRatio(ratio.y) * size.height) / safeDpr,
  };
}

/**
 * 归一化 box → 逻辑像素中心点。
 *
 * 先取 box 中心，再用 `normalizedToRatio` 把中心归一为比例，最后 `ratioToPixel`。
 * `options.factor` 默认 {@link GUI_DEFAULT_FACTOR}，`options.dpr` 默认 1。
 */
export function boxToPixelCenter(
  box: GuiBox,
  size: GuiSize,
  options: { factor?: number; dpr?: number } = {},
): GuiPoint {
  const factor = options.factor ?? GUI_DEFAULT_FACTOR;
  const center = boxCenter(box);
  const ratio: GuiPoint = {
    x: normalizedToRatio(center.x, factor),
    y: normalizedToRatio(center.y, factor),
  };
  return ratioToPixel(ratio, size, options.dpr ?? 1);
}

/**
 * 归一化点 → 逻辑像素。
 *
 * 先 `normalizedToRatio` 归一为比例，再 `ratioToPixel` 映射到尺寸。
 * `options.factor` 默认 {@link GUI_DEFAULT_FACTOR}，`options.dpr` 默认 1。
 */
export function pointToPixel(
  point: GuiPoint,
  size: GuiSize,
  options: { factor?: number; dpr?: number } = {},
): GuiPoint {
  const factor = options.factor ?? GUI_DEFAULT_FACTOR;
  const ratio: GuiPoint = {
    x: normalizedToRatio(point.x, factor),
    y: normalizedToRatio(point.y, factor),
  };
  return ratioToPixel(ratio, size, options.dpr ?? 1);
}
