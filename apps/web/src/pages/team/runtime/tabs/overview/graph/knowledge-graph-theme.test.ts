import { describe, expect, it } from 'vitest';
import type { GraphPalette } from './knowledge-graph-palette.js';
import { buildNebulaTheme } from './knowledge-graph-theme.js';

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

interface AnimationStage {
  readonly fields?: readonly string[];
  readonly duration?: number;
  readonly easing?: string;
}

interface ElementAnimation {
  readonly update?: readonly AnimationStage[];
  readonly translate?: readonly AnimationStage[];
}

function elementAnimation(theme: Record<string, unknown>, key: 'node' | 'edge'): ElementAnimation {
  const element = theme[key] as { animation?: ElementAnimation } | undefined;
  if (!element?.animation) {
    throw new Error(`missing ${key} animation`);
  }
  return element.animation;
}

describe('buildNebulaTheme 动效配置', () => {
  it('节点 update 覆盖 x / y 与强调相关字段，并带明确时长与缓动', () => {
    const theme = buildNebulaTheme(PALETTE);
    const update = elementAnimation(theme, 'node').update ?? [];
    const fields = update.flatMap((stage) => stage.fields ?? []);
    for (const field of ['x', 'y', 'fill', 'stroke', 'lineWidth', 'opacity', 'labelFill']) {
      expect(fields).toContain(field);
    }
    for (const stage of update) {
      expect(typeof stage.duration).toBe('number');
      expect(stage.duration as number).toBeGreaterThan(0);
      expect(typeof stage.easing).toBe('string');
    }
  });

  it('节点 translate 只动 x / y，且比 update 更短（拖拽跟手、布局缓入）', () => {
    const theme = buildNebulaTheme(PALETTE);
    const animation = elementAnimation(theme, 'node');
    const translate = animation.translate?.[0];
    const update = animation.update?.[0];
    if (!translate || !update) {
      throw new Error('missing node translate/update animation');
    }
    expect(translate.fields).toEqual(['x', 'y']);
    expect(translate.duration as number).toBeLessThan(update.duration as number);
  });

  it('边 update 覆盖端点与强调字段，让边跟随移动中的节点', () => {
    const theme = buildNebulaTheme(PALETTE);
    const fields = (elementAnimation(theme, 'edge').update ?? []).flatMap(
      (stage) => stage.fields ?? [],
    );
    for (const field of ['sourceNode', 'targetNode', 'stroke', 'lineWidth', 'strokeOpacity']) {
      expect(fields).toContain(field);
    }
  });
});
