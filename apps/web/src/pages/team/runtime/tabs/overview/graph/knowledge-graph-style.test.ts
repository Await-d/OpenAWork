import { describe, expect, it } from 'vitest';
import type {
  GraphEdge,
  GraphEdgeKind,
  GraphNode,
  GraphNodeKind,
  GraphNodeGroup,
  GraphRoleLayer,
} from '../../../data/build-knowledge-graph.js';
import type { GraphEdgeModel, GraphNodeModel } from './knowledge-graph-model.js';
import {
  AGGREGATE_BADGE_FONT_MAX,
  AGGREGATE_BADGE_FONT_MIN,
  AGGREGATE_BADGE_INNER_RATIO,
  aggregateBadgeLayout,
  estimateLabelTextWidth,
  truncateLabelToWidth,
} from './knowledge-graph-label-text.js';
import type { GraphPalette } from './knowledge-graph-style.js';
import {
  NODE_DEPTH_INNER_MIX,
  buildEdgeStyle,
  buildNodeStyle,
  depthMixAmount,
  mixColorToward,
  resolveEdgeColor,
  resolveGlyphColor,
  resolveGroupSurfaceColor,
  resolveHighlightColor,
  resolveNodeColor,
} from './knowledge-graph-style.js';

const PALETTE: GraphPalette = {
  accent: '#6461f0',
  contrast: '#a06bff',
  complement: '#e0497a',
  aux: '#3aa0ff',
  success: '#38e2c1',
  warning: '#a06bff',
  chart1: '#6461f0',
  chart2: '#a06bff',
  chart3: '#3aa0ff',
  chart4: '#e0497a',
  chart5: '#c084fc',
  chart6: '#38e2c1',
  chart7: '#67e8f9',
  chart8: '#f0abfc',
  fgStrong: '#f3f4ff',
  fgDefault: '#c8ccca',
  fgMuted: '#8e94b8',
  fgSubtle: '#5a6088',
  bgBase: '#060818',
  bgOverlay: '#11142a',
  bgRaised: '#0a0c1f',
  borderSubtle: '#11111111',
  borderDefault: '#22222222',
  borderEmphasis: '#33333333',
};

interface NodeOverrides {
  id: string;
  kind?: GraphNodeKind;
  group?: GraphNodeGroup;
  label?: string;
  detail?: string | null;
  phase?: string | null;
  depth?: number;
  persisted?: boolean;
  roleLayers?: GraphRoleLayer[] | null;
  collapsed?: boolean;
  descendantCount?: number;
}

function makeNode(overrides: NodeOverrides): GraphNodeModel {
  const node: GraphNode = {
    id: overrides.id,
    kind: overrides.kind ?? 'knowledge',
    label: overrides.label ?? '节点',
    group: overrides.group ?? 'knowledge',
    content: null,
    detail: overrides.detail ?? null,
    memoryType: null,
    persistedMemoryId: null,
    roleLayers: overrides.roleLayers ?? null,
    searchText: null,
    sourceRef: null,
    state: overrides.phase ?? null,
  };
  return {
    id: overrides.id,
    kind: overrides.kind ?? 'knowledge',
    group: overrides.group ?? 'knowledge',
    label: overrides.label ?? '节点',
    detail: overrides.detail ?? null,
    phase: overrides.phase ?? null,
    depth: overrides.depth ?? 0,
    persisted: overrides.persisted ?? false,
    roleLayers: overrides.roleLayers ?? null,
    collapsed: overrides.collapsed ?? false,
    descendantCount: overrides.descendantCount ?? 0,
    node,
  };
}

function makeEdge(kind: GraphEdgeKind): GraphEdgeModel {
  const edge: GraphEdge = {
    id: `edge:${kind}`,
    from: 'a',
    to: 'b',
    kind,
    state: null,
  };
  return { id: edge.id, from: edge.from, to: edge.to, kind, edge };
}

describe('mixColorToward', () => {
  it('线性混合两端的十六进制颜色', () => {
    expect(mixColorToward('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixColorToward('#000', '#fff', 0.5)).toBe('#808080');
  });

  it('amount 为 0/1 时分别返回原色与目标色', () => {
    expect(mixColorToward('#123456', '#ffffff', 0)).toBe('#123456');
    expect(mixColorToward('#123456', '#abcdef', 1)).toBe('#abcdef');
  });

  it('钳制越界 amount', () => {
    expect(mixColorToward('#000000', '#ffffff', -3)).toBe('#000000');
    expect(mixColorToward('#000000', '#ffffff', 9)).toBe('#ffffff');
  });

  it('支持 rgb() 输入', () => {
    expect(mixColorToward('rgb(0, 0, 0)', 'rgb(255, 255, 255)', 0.5)).toBe('#808080');
  });

  it('保留透明度（输出 8 位十六进制）', () => {
    expect(mixColorToward('#00000080', '#000000ff', 0.5)).toBe('#000000c0');
  });

  it('无法解析的颜色原样返回 base（降级安全）', () => {
    const hsl = 'hsl(215 20% 50% / 0.03)';
    expect(mixColorToward(hsl, '#ffffff', 0.5)).toBe(hsl);
  });
});

describe('depthMixAmount', () => {
  it('depth 0 不混合，越深混合越多，并在上限处收敛', () => {
    expect(depthMixAmount(0)).toBe(0);
    expect(depthMixAmount(1)).toBeGreaterThan(0);
    expect(depthMixAmount(2)).toBeGreaterThan(depthMixAmount(1));
    expect(depthMixAmount(100)).toBe(0.5);
  });

  it('明度台阶前重后轻：浅层就与旧线性值拉开差距', () => {
    expect(depthMixAmount(1)).toBeGreaterThan(0.15);
    expect(depthMixAmount(2)).toBeGreaterThan(0.28);
  });

  it('负值、非整数与非法值都安全收敛', () => {
    expect(depthMixAmount(-3)).toBe(0);
    expect(depthMixAmount(1.9)).toBe(depthMixAmount(1));
    expect(depthMixAmount(Number.NaN)).toBe(0);
  });
});

describe('resolveNodeColor', () => {
  it('group 模式保留组→token 映射，但统一到静息表面色（同色相、同明度带）', () => {
    const architecture = resolveNodeColor(
      'group',
      makeNode({ id: 'a', group: 'architecture' }),
      PALETTE,
    );
    const governance = resolveNodeColor(
      'group',
      makeNode({ id: 'b', group: 'governance' }),
      PALETTE,
    );
    const memory = resolveNodeColor('group', makeNode({ id: 'c', group: 'memory' }), PALETTE);
    const knowledge = resolveNodeColor('group', makeNode({ id: 'd', group: 'knowledge' }), PALETTE);
    const workspace = resolveNodeColor('group', makeNode({ id: 'e', group: 'workspace' }), PALETTE);

    expect(architecture).toBe(resolveGroupSurfaceColor('architecture', PALETTE));
    expect(governance).toBe(resolveGroupSurfaceColor('governance', PALETTE));
    expect(memory).toBe(resolveGroupSurfaceColor('memory', PALETTE));
    expect(knowledge).toBe(resolveGroupSurfaceColor('knowledge', PALETTE));
    // workspace 与 knowledge 共用 accent（语义映射不变）
    expect(workspace).toBe(knowledge);
    // 四组仍互相可区分，但都脱离了原始满饱和 token
    expect(architecture).not.toBe(PALETTE.aux);
    expect(new Set([architecture, governance, memory, knowledge]).size).toBe(4);

    const shallow = resolveNodeColor('group', makeNode({ id: 'f', depth: 0 }), PALETTE);
    const deep = resolveNodeColor('group', makeNode({ id: 'g', depth: 2 }), PALETTE);
    expect(deep).not.toBe(shallow);
  });

  it('persistence 模式已入库用 success，未入库用 fg-muted', () => {
    expect(resolveNodeColor('persistence', makeNode({ id: 'a', persisted: true }), PALETTE)).toBe(
      PALETTE.success,
    );
    expect(resolveNodeColor('persistence', makeNode({ id: 'b', persisted: false }), PALETTE)).toBe(
      PALETTE.fgMuted,
    );
  });

  it('role 模式取 roleLayers[0] 映射语义色，缺省回退 accent', () => {
    expect(
      resolveNodeColor('role', makeNode({ id: 'a', roleLayers: ['reception'] }), PALETTE),
    ).toBe(PALETTE.aux);
    expect(resolveNodeColor('role', makeNode({ id: 'b', roleLayers: ['pm1'] }), PALETTE)).toBe(
      PALETTE.accent,
    );
    expect(resolveNodeColor('role', makeNode({ id: 'c', roleLayers: ['pm2'] }), PALETTE)).toBe(
      PALETTE.contrast,
    );
    expect(resolveNodeColor('role', makeNode({ id: 'd', roleLayers: ['executor'] }), PALETTE)).toBe(
      PALETTE.success,
    );
    expect(resolveNodeColor('role', makeNode({ id: 'e', roleLayers: ['reviewer'] }), PALETTE)).toBe(
      PALETTE.warning,
    );
    expect(resolveNodeColor('role', makeNode({ id: 'f', roleLayers: null }), PALETTE)).toBe(
      PALETTE.accent,
    );
    expect(resolveNodeColor('role', makeNode({ id: 'g', roleLayers: [] }), PALETTE)).toBe(
      PALETTE.accent,
    );
  });
});

describe('resolveGroupSurfaceColor', () => {
  it('向背景混合固定比例，把四组色相压到同一明度带', () => {
    expect(resolveGroupSurfaceColor('architecture', PALETTE)).toBe(
      mixColorToward(PALETTE.aux, PALETTE.bgBase, 0.3),
    );
    expect(resolveGroupSurfaceColor('governance', PALETTE)).toBe(
      mixColorToward(PALETTE.contrast, PALETTE.bgBase, 0.3),
    );
    expect(resolveGroupSurfaceColor('memory', PALETTE)).toBe(
      mixColorToward(PALETTE.complement, PALETTE.bgBase, 0.3),
    );
    expect(resolveGroupSurfaceColor('knowledge', PALETTE)).toBe(
      mixColorToward(PALETTE.accent, PALETTE.bgBase, 0.3),
    );
  });
});

describe('resolveEdgeColor', () => {
  it('contains 的 base 与 dim 同色相，focus 更亮', () => {
    expect(resolveEdgeColor('contains', 'base', PALETTE)).toBe(PALETTE.fgMuted);
    expect(resolveEdgeColor('contains', 'dim', PALETTE)).toBe(PALETTE.fgMuted);
    expect(resolveEdgeColor('contains', 'focus', PALETTE)).toBe(PALETTE.fgDefault);
  });

  it('derives 的 base 与 dim 同色相（aux），focus 用 accent', () => {
    expect(resolveEdgeColor('derives', 'base', PALETTE)).toBe(PALETTE.aux);
    expect(resolveEdgeColor('derives', 'dim', PALETTE)).toBe(PALETTE.aux);
    expect(resolveEdgeColor('derives', 'focus', PALETTE)).toBe(PALETTE.accent);
  });
});

describe('resolveGlyphColor', () => {
  it('浅色填充选深色 glyph，深色填充选浅色 glyph', () => {
    expect(resolveGlyphColor('#ffffff', PALETTE)).toBe(PALETTE.bgBase);
    expect(resolveGlyphColor('#000000', PALETTE)).toBe(PALETTE.fgStrong);
  });

  it('无法解析的填充色回退 fg-strong', () => {
    expect(resolveGlyphColor('hsl(210 40% 60%)', PALETTE)).toBe(PALETTE.fgStrong);
  });
});

describe('resolveHighlightColor', () => {
  it('深色主题取 fg-strong，浅色主题取 bg-base，保证高光始终变亮', () => {
    expect(resolveHighlightColor(PALETTE)).toBe(PALETTE.fgStrong);
    const light: GraphPalette = { ...PALETTE, fgStrong: '#0a0e2e', bgBase: '#f4f6ff' };
    expect(resolveHighlightColor(light)).toBe(light.bgBase);
  });
});

describe('buildNodeStyle', () => {
  it('标签可见时写入 labelText 与截断配置，且不绘制背景块', () => {
    const node = makeNode({ id: 'a', label: '一个非常非常长的中文知识节点标签' });
    const style = buildNodeStyle(node, {
      colorMode: 'group',
      palette: PALETTE,
      focused: false,
      selected: false,
      dimmed: false,
      showLabel: true,
    });
    expect(style.label).toBe(true);
    expect(style.labelText).toBe(
      truncateLabelToWidth(node.label, Number(style.labelFontSize), Number(style.labelMaxWidth)),
    );
    expect(style.labelText).not.toBe(node.label);
    expect(String(style.labelText).endsWith('…')).toBe(true);
    expect(style.labelFill).toBe(PALETTE.fgDefault);
    expect(style.labelTextOverflow).toBe('ellipsis');
    expect(style.labelMaxLines).toBe(1);
    expect(style.labelBackground).toBe(false);
    expect(typeof style.labelMaxWidth).toBe('number');
    expect(style.labelMaxWidth).toBeGreaterThan(40);
  });

  it('短标签预截断后原样保留（不引入多余省略号）', () => {
    const node = makeNode({ id: 'short', label: '架构' });
    const style = buildNodeStyle(node, {
      colorMode: 'group',
      palette: PALETTE,
      focused: false,
      selected: false,
      dimmed: false,
      showLabel: true,
    });
    expect(style.labelText).toBe('架构');
  });

  it('标签隐藏时不写文本也不画背景，避免留下只有背景的空白灰框', () => {
    const node = makeNode({ id: 'a' });
    const style = buildNodeStyle(node, {
      colorMode: 'group',
      palette: PALETTE,
      focused: false,
      selected: false,
      dimmed: false,
      showLabel: false,
    });
    expect(style.label).toBe(false);
    expect(style.labelText).toBe('');
    expect(style.labelBackground).toBe(false);
  });

  it('变暗只用透明度，聚焦用 halo', () => {
    const node = makeNode({ id: 'a' });
    const dimmed = buildNodeStyle(node, {
      colorMode: 'group',
      palette: PALETTE,
      focused: false,
      selected: false,
      dimmed: true,
      showLabel: true,
    });
    expect(dimmed.opacity).toBe(0.18);

    const focused = buildNodeStyle(node, {
      colorMode: 'group',
      palette: PALETTE,
      focused: true,
      selected: false,
      dimmed: false,
      showLabel: true,
    });
    expect(focused.opacity).toBe(1);
    expect(focused.halo).toBe(true);
    expect(focused.labelFill).toBe(PALETTE.fgStrong);
  });

  it('artifact 阶段通过 iconText 单字缩写表达，非 artifact 无 iconText', () => {
    const artifact = makeNode({ id: 'a', kind: 'artifact', phase: 'spec' });
    const artifactStyle = buildNodeStyle(artifact, {
      colorMode: 'group',
      palette: PALETTE,
      focused: false,
      selected: false,
      dimmed: false,
      showLabel: true,
    });
    expect(artifactStyle.iconText).toBe('规');
    expect(artifactStyle.iconFill).toBe(
      resolveGlyphColor(resolveNodeColor('group', artifact, PALETTE), PALETTE),
    );

    const knowledge = makeNode({ id: 'b' });
    const knowledgeStyle = buildNodeStyle(knowledge, {
      colorMode: 'group',
      palette: PALETTE,
      focused: false,
      selected: false,
      dimmed: false,
      showLabel: true,
    });
    expect(knowledgeStyle.iconText).toBeUndefined();
  });

  it('深度越浅标签字号越大', () => {
    const shallow = buildNodeStyle(makeNode({ id: 'a', depth: 0 }), {
      colorMode: 'group',
      palette: PALETTE,
      focused: false,
      selected: false,
      dimmed: false,
      showLabel: true,
    });
    const deep = buildNodeStyle(makeNode({ id: 'b', depth: 3 }), {
      colorMode: 'group',
      palette: PALETTE,
      focused: false,
      selected: false,
      dimmed: false,
      showLabel: true,
    });
    expect(shallow.labelFontSize).toBeGreaterThan(deep.labelFontSize as number);
  });

  it('任何模式与可见性下 labelBackground 都必须为 false（回归：背景块会遮住文字）', () => {
    const nodes = [
      makeNode({ id: 'workspace', kind: 'workspace', depth: 0 }),
      makeNode({ id: 'category', kind: 'category', depth: 1 }),
      makeNode({ id: 'artifact', kind: 'artifact', phase: 'spec', depth: 2 }),
      makeNode({ id: 'memory', kind: 'memory', persisted: true, depth: 3 }),
    ];
    for (const node of nodes) {
      for (const colorMode of ['group', 'role', 'persistence'] as const) {
        for (const showLabel of [true, false]) {
          for (const emphasized of [false, true]) {
            const style = buildNodeStyle(node, {
              colorMode,
              palette: PALETTE,
              focused: emphasized,
              selected: emphasized,
              dimmed: false,
              showLabel,
            });
            expect(style.labelBackground).toBe(false);
          }
        }
      }
    }
  });
});

describe('折叠聚合计数徽标排版', () => {
  it('字号由盘半径派生并钳制在 [MIN, MAX]', () => {
    expect(aggregateBadgeLayout('30', 16).fontSize).toBe(AGGREGATE_BADGE_FONT_MIN);
    expect(aggregateBadgeLayout('30', 46).fontSize).toBe(AGGREGATE_BADGE_FONT_MAX);
    expect(aggregateBadgeLayout('30', 26).fontSize).toBeGreaterThan(
      aggregateBadgeLayout('30', 16).fontSize,
    );
  });

  it('盘面放不下最小字号时把半径撑到徽标所需，字形内接圆留在 rim 净空内', () => {
    const layout = aggregateBadgeLayout('1.1k', 16);
    expect(layout.radius).toBeGreaterThan(16);
    const halfDiagonal = Math.hypot(
      estimateLabelTextWidth('1.1k', layout.fontSize) / 2,
      layout.fontSize / 2,
    );
    expect(halfDiagonal).toBeLessThanOrEqual(layout.radius * AGGREGATE_BADGE_INNER_RATIO + 1e-6);
  });

  it('足够大的盘面不被撑大，徽标仍留在盘内', () => {
    const layout = aggregateBadgeLayout('1.1k', 46);
    expect(layout.radius).toBe(46);
    const halfDiagonal = Math.hypot(
      estimateLabelTextWidth('1.1k', layout.fontSize) / 2,
      layout.fontSize / 2,
    );
    expect(halfDiagonal).toBeLessThanOrEqual(46 * AGGREGATE_BADGE_INNER_RATIO + 1e-6);
  });

  it('buildNodeStyle 对折叠聚合写入半径派生的 iconFontSize，并把小盘撑到徽标所需', () => {
    const node = makeNode({ id: 'agg', collapsed: true, descendantCount: 1127, depth: 1 });
    const style = buildNodeStyle(node, {
      colorMode: 'group',
      palette: PALETTE,
      focused: false,
      selected: false,
      dimmed: false,
      showLabel: true,
      radius: 16,
    });
    expect(style.iconText).toBe('1.1k');
    expect(style.iconFontSize).toBe(aggregateBadgeLayout('1.1k', 16).fontSize);
    expect(style.size as number).toBeGreaterThan(32);
  });
});

describe('buildEdgeStyle', () => {
  it('contains 无箭头、无虚线，忽略动画开关，且基础可见度高于未聚焦的 derives', () => {
    const base = buildEdgeStyle(makeEdge('contains'), {
      palette: PALETTE,
      focused: false,
      dimmed: false,
      animating: true,
    });
    expect(base.endArrow).toBe(false);
    expect(base.lineDash).toBeUndefined();
    expect(base.lineDashOffset).toBeUndefined();
    expect(base.strokeOpacity).toBe(0.5);

    const focused = buildEdgeStyle(makeEdge('contains'), {
      palette: PALETTE,
      focused: true,
      dimmed: false,
      animating: true,
    });
    expect(focused.endArrow).toBe(false);
    expect(focused.strokeOpacity).toBe(0.85);
    expect(focused.strokeOpacity as number).toBeGreaterThan(base.strokeOpacity as number);
  });

  it('derives 未聚焦时是静态虚线且无箭头，聚焦时才出现箭头', () => {
    const unfocused = buildEdgeStyle(makeEdge('derives'), {
      palette: PALETTE,
      focused: false,
      dimmed: false,
      animating: false,
    });
    expect(unfocused.endArrow).toBe(false);
    expect(Array.isArray(unfocused.lineDash)).toBe(true);
    expect(unfocused.lineDashOffset).toBeUndefined();
    expect(unfocused.strokeOpacity).toBe(0.32);

    const focused = buildEdgeStyle(makeEdge('derives'), {
      palette: PALETTE,
      focused: true,
      dimmed: false,
      animating: false,
    });
    expect(focused.endArrow).toBe(true);
    expect(focused.strokeOpacity).toBe(0.95);
  });

  it('derives 仅在聚焦 + 动画时启用流动（lineDashOffset）', () => {
    const flowing = buildEdgeStyle(makeEdge('derives'), {
      palette: PALETTE,
      focused: true,
      dimmed: false,
      animating: true,
    });
    expect(flowing.lineDashOffset).toBe(0);

    const focusedButStatic = buildEdgeStyle(makeEdge('derives'), {
      palette: PALETTE,
      focused: true,
      dimmed: false,
      animating: false,
    });
    expect(focusedButStatic.lineDashOffset).toBeUndefined();

    const animatingButUnfocused = buildEdgeStyle(makeEdge('derives'), {
      palette: PALETTE,
      focused: false,
      dimmed: false,
      animating: true,
    });
    expect(animatingButUnfocused.lineDashOffset).toBeUndefined();
  });

  it('变暗只用透明度，色相不变', () => {
    const base = buildEdgeStyle(makeEdge('derives'), {
      palette: PALETTE,
      focused: false,
      dimmed: false,
      animating: false,
    });
    const dimmed = buildEdgeStyle(makeEdge('derives'), {
      palette: PALETTE,
      focused: false,
      dimmed: true,
      animating: false,
    });
    expect(dimmed.opacity).toBe(0.18);
    expect(dimmed.stroke).toBe(base.stroke);
  });
});

describe('buildEdgeStyle 曲线与强调键', () => {
  it('contains 使用 quadratic 的温和曲线参数，仍无箭头无虚线', () => {
    const style = buildEdgeStyle(makeEdge('contains'), {
      palette: PALETTE,
      focused: false,
      dimmed: false,
      animating: true,
    });
    expect(typeof style.curveOffset).toBe('number');
    expect(typeof style.curvePosition).toBe('number');
    expect(style.curveOffset as number).toBeGreaterThan(0);
    expect(style.curveOffset as number).toBeLessThanOrEqual(12);
    expect(style.curvePosition as number).toBeGreaterThan(0);
    expect(style.curvePosition as number).toBeLessThan(1);
    expect(style.endArrow).toBe(false);
    expect(style.lineDash).toBeUndefined();
    expect(style.lineDashOffset).toBeUndefined();
  });

  it('derives 拱形比 contains 更明显但有界，且保留箭头 / 虚线 / 流动开关', () => {
    const contains = buildEdgeStyle(makeEdge('contains'), {
      palette: PALETTE,
      focused: false,
      dimmed: false,
      animating: false,
    });
    const unfocused = buildEdgeStyle(makeEdge('derives'), {
      palette: PALETTE,
      focused: false,
      dimmed: false,
      animating: false,
    });
    expect(unfocused.curveOffset as number).toBeGreaterThan(contains.curveOffset as number);
    expect(unfocused.curveOffset as number).toBeLessThanOrEqual(32);
    expect(Array.isArray(unfocused.lineDash)).toBe(true);
    expect(unfocused.endArrow).toBe(false);
    expect(unfocused.lineDashOffset).toBeUndefined();

    const focused = buildEdgeStyle(makeEdge('derives'), {
      palette: PALETTE,
      focused: true,
      dimmed: false,
      animating: true,
    });
    expect(focused.endArrow).toBe(true);
    expect(focused.lineDashOffset).toBe(0);
    expect(focused.curveOffset).toBe(unfocused.curveOffset);
    expect(focused.curvePosition).toBe(unfocused.curvePosition);
  });
});

describe('buildNodeStyle 体积叠加键', () => {
  it('写入由 token 派生的实心叠加盘属性（外层柔光 + 内层不透明高光）', () => {
    const node = makeNode({ id: 'a' });
    const style = buildNodeStyle(node, {
      colorMode: 'group',
      palette: PALETTE,
      focused: false,
      selected: false,
      dimmed: false,
      showLabel: true,
    });
    expect(style.depthOuterRatio as number).toBeGreaterThan(1);
    expect(style.depthOuterFill).toBe(resolveNodeColor('group', node, PALETTE));
    expect(style.depthOuterOpacity as number).toBeGreaterThan(0);
    expect(style.depthInnerRatio as number).toBeGreaterThan(0);
    expect(style.depthInnerRatio as number).toBeLessThan(1);
    expect(style.depthInnerFill).not.toBe(style.depthOuterFill);
    expect(style.depthInnerFill).toBe(
      mixColorToward(
        resolveNodeColor('group', node, PALETTE),
        resolveHighlightColor(PALETTE),
        NODE_DEPTH_INNER_MIX,
      ),
    );
    // 高光必须是实心填充：WebGL 下低透明度填充会与背景错误合成。
    expect(style.depthInnerOpacity).toBeUndefined();
  });

  it('变暗时收起叠加盘，避免非焦点节点留下光斑', () => {
    const style = buildNodeStyle(makeNode({ id: 'a' }), {
      colorMode: 'group',
      palette: PALETTE,
      focused: false,
      selected: false,
      dimmed: true,
      showLabel: true,
    });
    expect(style.depthOuterOpacity).toBe(0);
    expect(style.depthInnerRatio).toBe(0);
  });
});
