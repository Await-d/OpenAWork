import { describe, expect, it } from 'vitest';
import {
  estimateTextWidth,
  resolveStatsBarFit,
  type StatsBarItemMetrics,
} from './composer-stats-bar-fit.js';

function stat(label: string, value: string, priority: number, hasMeter = false) {
  return { kind: 'stat', label, value, priority, hasMeter } as const satisfies StatsBarItemMetrics;
}

const ITEMS: StatsBarItemMetrics[] = [
  stat('Token', '543.8K', 60),
  stat('输入', '536.9K', 0),
  stat('输出', '6.9K', 0),
  stat('推理', '1.2K', 40),
  { kind: 'separator', label: '', value: '', priority: 0 },
  stat('上下文', '110.3K', 0, true),
  stat('窗口', '272.0K', 20),
  { kind: 'separator', label: '', value: '', priority: 0 },
  stat('轮数', '28', 0),
  stat('隐藏', '11', 45),
  { kind: 'note', label: '', value: '* 估算', priority: 80 },
];

describe('resolveStatsBarFit', () => {
  it('宽度充足时全部可见且不进入紧凑模式', () => {
    const fit = resolveStatsBarFit({ availableWidth: 2000, items: ITEMS });

    expect(fit.compact).toBe(false);
    expect(fit.visible.every(Boolean)).toBe(true);
  });

  it('宽度收窄时按优先级从低到高裁项，并保留核心项', () => {
    const fit = resolveStatsBarFit({ availableWidth: 420, items: ITEMS });

    expect(fit.compact).toBe(false);
    // 脚注（80）→ 隐藏（45）→ 推理（40）→ 总 Token（60 之后按索引）→ 窗口（20）
    expect(fit.visible[10]).toBe(false); // * 估算
    expect(fit.visible[9]).toBe(false); // 隐藏
    expect(fit.visible[3]).toBe(false); // 推理
    expect(fit.visible[0]).toBe(false); // Token 合计
    expect(fit.visible[6]).toBe(false); // 窗口
    // 核心项永不隐藏。
    expect(fit.visible[1]).toBe(true); // 输入
    expect(fit.visible[2]).toBe(true); // 输出
    expect(fit.visible[5]).toBe(true); // 上下文
    expect(fit.visible[8]).toBe(true); // 轮数
  });

  it('窄容器下进入紧凑模式并保留全部核心项', () => {
    const fit = resolveStatsBarFit({ availableWidth: 340, items: ITEMS });

    expect(fit.compact).toBe(true);
    expect(fit.visible[1]).toBe(true); // 输入
    expect(fit.visible[2]).toBe(true); // 输出
    expect(fit.visible[5]).toBe(true); // 上下文
    expect(fit.visible[8]).toBe(true); // 轮数
    // 紧凑模式放不下更高优先级的项。
    expect(fit.visible[10]).toBe(false); // * 估算
    expect(fit.visible[9]).toBe(false); // 隐藏
    expect(fit.visible[0]).toBe(false); // Token 合计
  });

  it('极窄容器下退化为单项展示', () => {
    const fit = resolveStatsBarFit({ availableWidth: 60, items: ITEMS });

    expect(fit.compact).toBe(true);
    expect(fit.visible.filter(Boolean)).toHaveLength(1);
  });

  it('容器宽度未知时全部可见，交由 overflow 兜底', () => {
    const fit = resolveStatsBarFit({ availableWidth: 0, items: ITEMS });

    expect(fit.compact).toBe(false);
    expect(fit.visible.every(Boolean)).toBe(true);
  });

  it('空列表不报错', () => {
    expect(resolveStatsBarFit({ availableWidth: 600, items: [] })).toEqual({
      visible: [],
      compact: false,
    });
  });
});

describe('estimateTextWidth', () => {
  it('全角字符按 1em、ASCII 按 0.58em 估算', () => {
    expect(estimateTextWidth('输入', 10)).toBe(20);
    expect(estimateTextWidth('543.8K', 10)).toBeCloseTo(6 * 0.58 * 10, 5);
  });
});
