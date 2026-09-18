/**
 * 知识图谱主题 · G6 v5 静态主题注册
 *
 * G6 主题样式是**静态**的：不能挂回调、不能按元素设置 `type`。
 * 因此主题只提供基线外观与状态样式；每个节点的动态颜色一律由
 * `buildNodeStyle` / `buildEdgeStyle` 通过 `node.style` / `edge.style` 覆盖。
 */

import { ExtensionCategory, register } from '@antv/g6';
import type { GraphPalette } from './knowledge-graph-style.js';

export const NEBULA_THEME_NAME = 'openawork-nebula';

/**
 * 统一动效语言：一处缓动、两种时长。布局/状态变化用较长的 `update` 时长缓入，
 * 拖拽跟随时 `translate` 用更短时长，让邻居「弹」着追上而不是硬切。
 * 只有这一套动画，不叠加任何循环装饰动画。
 */
const SOFT_EASING = 'cubic-bezier(0.22, 0.61, 0.36, 1)';
const NODE_UPDATE_DURATION_MS = 420;
const NODE_TRANSLATE_DURATION_MS = 140;
const EDGE_UPDATE_DURATION_MS = 420;
const NODE_UPDATE_FIELDS = [
  'x',
  'y',
  'fill',
  'stroke',
  'lineWidth',
  'opacity',
  'haloLineWidth',
  'haloStrokeOpacity',
  'labelFill',
];
const EDGE_UPDATE_FIELDS = [
  'sourceNode',
  'targetNode',
  'stroke',
  'lineWidth',
  'strokeOpacity',
  'opacity',
  'haloLineWidth',
  'haloStrokeOpacity',
];

let nebulaThemeRegistered = false;

/** `prefers-reduced-motion: reduce` 时关闭一切进出场与补间。 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function nodeAnimation(reduced: boolean): unknown {
  if (reduced) {
    return false;
  }
  return {
    enter: 'fade',
    exit: 'fade',
    show: 'fade',
    hide: 'fade',
    update: [
      { fields: NODE_UPDATE_FIELDS, duration: NODE_UPDATE_DURATION_MS, easing: SOFT_EASING },
    ],
    translate: [{ fields: ['x', 'y'], duration: NODE_TRANSLATE_DURATION_MS, easing: SOFT_EASING }],
  };
}

function edgeAnimation(reduced: boolean): unknown {
  if (reduced) {
    return false;
  }
  return {
    enter: 'fade',
    exit: 'fade',
    show: 'fade',
    hide: 'fade',
    update: [
      { fields: EDGE_UPDATE_FIELDS, duration: EDGE_UPDATE_DURATION_MS, easing: SOFT_EASING },
    ],
    translate: [
      {
        fields: ['sourceNode', 'targetNode'],
        duration: NODE_TRANSLATE_DURATION_MS,
        easing: SOFT_EASING,
      },
    ],
  };
}

/**
 * 构建 E · Nebula 主题对象。所有颜色取自解析后的 `palette`，无硬编码色值。
 * 状态覆盖 G6 内置的 `selected / highlight / active / inactive / disabled`，
 * 并额外定义 `persisted`，让「已入库」节点通过 state 获得可见标识（而非新节点类）。
 */
export function buildNebulaTheme(palette: GraphPalette): Record<string, unknown> {
  const reduced = prefersReducedMotion();

  return {
    background: palette.bgBase,
    node: {
      style: {
        size: 30,
        fill: palette.accent,
        stroke: palette.bgBase,
        lineWidth: 1.5,
        cursor: 'pointer',
        zIndex: 2,
        halo: false,
        iconFill: palette.fgStrong,
        iconFontSize: 11,
        labelPlacement: 'bottom',
        labelTextAlign: 'center',
        labelFill: palette.fgDefault,
        labelFontSize: 13,
        labelMaxWidth: 132,
        labelMaxLines: 1,
        labelTextOverflow: 'ellipsis',
        labelOffsetY: 6,
        labelShadowBlur: 6,
        labelShadowColor: palette.bgBase,
      },
      state: {
        selected: {
          halo: true,
          haloStroke: palette.accent,
          haloLineWidth: 16,
          haloStrokeOpacity: 0.35,
          lineWidth: 3,
          labelFill: palette.fgStrong,
          labelFontWeight: 600,
          zIndex: 12,
        },
        highlight: {
          halo: true,
          haloStroke: palette.accent,
          haloLineWidth: 12,
          haloStrokeOpacity: 0.22,
          lineWidth: 2.5,
          labelFontWeight: 600,
          zIndex: 8,
        },
        active: {
          halo: true,
          haloStroke: palette.aux,
          haloLineWidth: 10,
          haloStrokeOpacity: 0.18,
          lineWidth: 2,
        },
        inactive: {
          opacity: 0.18,
        },
        disabled: {
          opacity: 0.25,
        },
        persisted: {
          halo: true,
          haloStroke: palette.success,
          haloLineWidth: 10,
          haloStrokeOpacity: 0.18,
          stroke: palette.success,
          lineWidth: 2.5,
        },
      },
      animation: nodeAnimation(reduced),
    },
    edge: {
      style: {
        stroke: palette.fgSubtle,
        lineWidth: 1.2,
        strokeOpacity: 0.9,
        endArrow: false,
        zIndex: 1,
        halo: false,
        labelFill: palette.fgMuted,
        labelFontSize: 11,
        labelShadowBlur: 4,
        labelShadowColor: palette.bgBase,
      },
      state: {
        selected: {
          halo: true,
          haloStroke: palette.accent,
          haloLineWidth: 12,
          haloStrokeOpacity: 0.25,
          lineWidth: 2.5,
        },
        highlight: {
          halo: true,
          haloStroke: palette.accent,
          haloLineWidth: 12,
          haloStrokeOpacity: 0.2,
          lineWidth: 2.5,
        },
        active: {
          halo: true,
          haloStroke: palette.aux,
          haloLineWidth: 10,
          haloStrokeOpacity: 0.18,
          lineWidth: 2,
        },
        inactive: {
          opacity: 0.18,
        },
        disabled: {
          opacity: 0.25,
        },
      },
      animation: edgeAnimation(reduced),
    },
  };
}

/** 注册主题（幂等）。G6 主题只注册一次即可全局复用。 */
export function registerNebulaTheme(palette: GraphPalette): void {
  if (nebulaThemeRegistered) {
    return;
  }
  nebulaThemeRegistered = true;
  // `buildNebulaTheme` 的返回类型由冻结契约固定为 `Record<string, unknown>`，
  // 而 G6 的 `register` 需要内部 `Theme` 类型；该主题形状与 G6 `Theme` 完全一致。
  register(ExtensionCategory.THEME, NEBULA_THEME_NAME, buildNebulaTheme(palette) as never);
}
