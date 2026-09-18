/**
 * 知识图谱 · G6 实例周边的纯辅助（无 React）。
 *
 * 从 `knowledge-graph-canvas.tsx` 拆出，宿主组件只保留 React 生命周期编排。
 */

import type { Graph } from '@antv/g6';
import type { GraphViewportSize } from './knowledge-graph-layout.js';

export const CANVAS_ARIA_LABEL = '工作区知识图谱画布';

/** 只在尺寸真正变化时回调，避免 ResizeObserver 与 React 之间来回触发。 */
export function createGraphResizeObserver(
  container: HTMLElement,
  graph: Graph,
  onResize: (size: GraphViewportSize) => void,
): ResizeObserver | null {
  if (typeof ResizeObserver === 'undefined') {
    return null;
  }
  const observer = new ResizeObserver(() => {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width <= 0 || height <= 0) {
      return;
    }
    graph.resize();
    onResize({ width, height });
  });
  observer.observe(container);
  return observer;
}

/** 幂等销毁：StrictMode 双调用与回退路径都可能在已销毁实例上再次触发。 */
export function safeDestroyGraph(graph: Graph | null): void {
  if (graph && !graph.destroyed) {
    graph.destroy();
  }
}

/** 标记实际生效的渲染器并给 canvas 补无障碍标签。 */
export function applyCanvasA11y(container: HTMLElement, renderer: string): void {
  container.dataset.renderer = renderer;
  for (const canvas of container.querySelectorAll('canvas')) {
    canvas.setAttribute('aria-label', CANVAS_ARIA_LABEL);
  }
}
