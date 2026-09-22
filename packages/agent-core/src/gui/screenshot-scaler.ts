/**
 * 截图缩放预算计算（纯计算）。
 *
 * 说明：本模块**只做尺寸数学计算，不做实际像素重采样**——项目当前未引入图像处理库，
 * 真正的缩放（解码 / resize / 重新编码）由调用方负责，本模块只给出目标宽高与缩放系数。
 *
 * 三个模型族的像素预算均以 `28 × 28` 为最小视觉单元（IMAGE_FACTOR）。
 */

/** V1.0 模型最大像素预算：2700 × 28 × 28。 */
export const GUI_MAX_PIXELS_V1_0 = 2700 * 28 * 28;

/** Doubao 模型最大像素预算：5120 × 28 × 28。 */
export const GUI_MAX_PIXELS_DOUBAO = 5120 * 28 * 28;

/** V1.5 模型最大像素预算：16384 × 28 × 28。 */
export const GUI_MAX_PIXELS_V1_5 = 16384 * 28 * 28;

/** 截图缩放结果：目标宽高、缩放系数，以及是否发生了缩放。 */
export interface GuiScreenshotScale {
  readonly width: number;
  readonly height: number;
  readonly factor: number;
  readonly scaled: boolean;
}

/**
 * 计算缩放系数。
 *
 * - 像素数 `width × height <= maxPixels` 时返回 1；
 * - 否则返回 `Math.sqrt(maxPixels / pixels)`，并收敛到 `(0, 1]`；
 * - 宽高或预算非法（非有限数 / 非正数）时保守返回 1。
 */
export function computeScaleFactor(input: {
  width: number;
  height: number;
  maxPixels: number;
}): number {
  const { width, height, maxPixels } = input;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 1;
  }
  if (!Number.isFinite(maxPixels) || maxPixels <= 0) {
    return 1;
  }
  const pixels = width * height;
  if (pixels <= maxPixels) {
    return 1;
  }
  const factor = Math.sqrt(maxPixels / pixels);
  // 理论上 factor ∈ (0,1)，此处双重收敛确保落在 (0,1]
  return Math.min(1, Math.max(factor, Number.MIN_VALUE));
}

/**
 * 按预算缩放截图尺寸。
 *
 * 使用 {@link computeScaleFactor} 得到系数，再对宽高 `Math.floor`。
 * 由于 floor 只会减小尺寸，`width × height` 必然不超过 `maxPixels`。
 * 缩放后宽高至少为 1，避免出现 0 尺寸。
 */
export function scaleScreenshotSize(input: {
  width: number;
  height: number;
  maxPixels: number;
}): GuiScreenshotScale {
  const { width, height } = input;
  const factor = computeScaleFactor(input);
  if (factor >= 1) {
    return { width, height, factor: 1, scaled: false };
  }
  const scaledWidth = Math.max(1, Math.floor(width * factor));
  const scaledHeight = Math.max(1, Math.floor(height * factor));
  return { width: scaledWidth, height: scaledHeight, factor, scaled: true };
}

/** 按模型族解析像素预算。 */
export function resolveMaxPixels(modelFamily: 'v1.0' | 'doubao' | 'v1.5'): number {
  switch (modelFamily) {
    case 'v1.0':
      return GUI_MAX_PIXELS_V1_0;
    case 'doubao':
      return GUI_MAX_PIXELS_DOUBAO;
    case 'v1.5':
      return GUI_MAX_PIXELS_V1_5;
  }
}
