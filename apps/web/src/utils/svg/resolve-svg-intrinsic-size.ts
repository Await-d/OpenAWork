/**
 * 从 SVG 源码解析根元素的固有尺寸，供「缩放 / 适应宽度」按真实比例计算。
 *
 * 两种来源，按可靠性排序：
 * 1. `viewBox` —— 设计工具（Figma / Illustrator / draw.io）导出时基本都带，
 *    且带单位，是最可靠的比例来源；
 * 2. 根元素 `width` / `height` —— 部分手写 SVG 只有这两个属性。
 *
 * 两者都拿不到时返回 `null`，调用方应退回「按容器宽度自适应」，
 * 而不是用 1×1 之类的假尺寸把图缩成看不见。
 */

export interface SvgIntrinsicSize {
  width: number;
  height: number;
}

/** 匹配第一个 viewBox，容忍单引号 / 缺省分隔符等常见写法。 */
function parseViewBoxSize(svg: string): SvgIntrinsicSize | null {
  const match = /viewBox\s*=\s*["']([^"']+)["']/iu.exec(svg);
  const raw = match?.[1];
  if (!raw) {
    return null;
  }

  const parts = raw.trim().split(/[\s,]+/);
  if (parts.length < 4) {
    return null;
  }

  return toPositiveSize(parts[2], parts[3]);
}

/** 读取根 `<svg>` 上的 width / height，兼容 `640`、`640px`、`100%` 之外的写法。 */
function parseWidthHeightSize(svg: string): SvgIntrinsicSize | null {
  const rootTag = /<svg\b[^>]*>/iu.exec(svg)?.[0];
  if (!rootTag) {
    return null;
  }

  const readAttribute = (name: string): string | undefined => {
    const match = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'iu').exec(rootTag);
    return match?.[1];
  };

  // 无单位数值与 px 是可靠的固有尺寸；百分比 / em 依赖上下文，不作为尺寸来源。
  const parseLength = (value: string | undefined): number | null => {
    if (!value) {
      return null;
    }
    const match = /^\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*$/u.exec(value);
    if (!match?.[1]) {
      return null;
    }
    const parsed = Number.parseFloat(match[1]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };

  const width = parseLength(readAttribute('width'));
  const height = parseLength(readAttribute('height'));
  if (width === null || height === null) {
    return null;
  }

  return { width, height };
}

function toPositiveSize(rawWidth: string | undefined, rawHeight: string | undefined) {
  const width = Number.parseFloat(rawWidth ?? '');
  const height = Number.parseFloat(rawHeight ?? '');
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  return { width, height } satisfies SvgIntrinsicSize;
}

export function resolveSvgIntrinsicSize(svg: string): SvgIntrinsicSize | null {
  return parseViewBoxSize(svg) ?? parseWidthHeightSize(svg);
}
