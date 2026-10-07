import { useCallback, useEffect, useState, type RefObject } from 'react';

/** 缩放区间与步进：图表与 SVG 预览共用同一套手感。 */
export const PREVIEW_MIN_ZOOM = 0.25;
export const PREVIEW_MAX_ZOOM = 4;
export const PREVIEW_ZOOM_STEP = 1.25;

/**
 * `.oaw-preview-figure` 的水平内边距（12px × 2）与边框（1px × 2）之和。
 * 「适应宽度」要按真实可视区计算，不能把这一圈留白算进图形里。
 */
export const PREVIEW_FIGURE_INSET = 26;

export function clampPreviewZoom(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.min(PREVIEW_MAX_ZOOM, Math.max(PREVIEW_MIN_ZOOM, value));
}

export interface PreviewZoom {
  zoom: number;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  /** 缩放到刚好占满可用宽度；图形或视口尚未就绪时是空操作。 */
  fit: () => void;
}

/**
 * 「按固有尺寸缩放 + 适应宽度」的状态逻辑。
 *
 * 与消息内图表（`MermaidPreviewCodeBlock`）行为一致，抽出来是为了让
 * 图表与 SVG 预览共用一份缩放手感，而不是各写一遍常量与钳位。
 *
 * @param size 图形固有尺寸；`null`（还没出图 / 拿不到 viewBox）时只渲染不定尺
 */
export function usePreviewZoom(
  viewportRef: RefObject<HTMLElement | null>,
  size: { width: number; height: number } | null,
  inset: number = PREVIEW_FIGURE_INSET,
): PreviewZoom {
  const [zoom, setZoom] = useState(1);

  const fit = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || !size) {
      return;
    }

    const available = viewport.clientWidth - inset;
    if (available <= 0) {
      return;
    }

    setZoom(clampPreviewZoom(available / size.width));
  }, [viewportRef, size, inset]);

  // 图形尺寸变化（首次出图、主题切换重出图）后自动回到「适应宽度」。
  useEffect(() => {
    fit();
  }, [fit]);

  return {
    zoom,
    zoomIn: useCallback(() => setZoom((value) => clampPreviewZoom(value * PREVIEW_ZOOM_STEP)), []),
    zoomOut: useCallback(() => setZoom((value) => clampPreviewZoom(value / PREVIEW_ZOOM_STEP)), []),
    resetZoom: useCallback(() => setZoom(1), []),
    fit,
  };
}
