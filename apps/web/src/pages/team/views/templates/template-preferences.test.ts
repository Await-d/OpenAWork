/**
 * template-preferences 纯函数测试：解析容错 / 收藏切换 / 使用记录 / 裁剪 / 最近排序。
 */

import { describe, expect, it } from 'vitest';
import {
  emptyPreferences,
  isFavorite,
  parsePreferences,
  pruneToExisting,
  recentTemplateIds,
  toggleFavorite,
  touchUsage,
  type TemplatePreferences,
} from './template-preferences.js';

describe('parsePreferences 容错', () => {
  it('null / 空串回退空偏好', () => {
    expect(parsePreferences(null)).toEqual(emptyPreferences());
    expect(parsePreferences('')).toEqual(emptyPreferences());
  });

  it('非法 JSON 回退空偏好', () => {
    expect(parsePreferences('{bad json')).toEqual(emptyPreferences());
  });

  it('非对象顶层回退空偏好', () => {
    expect(parsePreferences('123')).toEqual(emptyPreferences());
    expect(parsePreferences('"x"')).toEqual(emptyPreferences());
    expect(parsePreferences('[1,2]')).toEqual(emptyPreferences());
  });

  it('过滤 favorites 中的非字符串项', () => {
    const result = parsePreferences(JSON.stringify({ favorites: ['a', 1, null, 'b'] }));
    expect(result.favorites).toEqual(['a', 'b']);
  });

  it('对 favorites 去重', () => {
    const result = parsePreferences(JSON.stringify({ favorites: ['a', 'a', 'b'] }));
    expect(result.favorites).toEqual(['a', 'b']);
  });

  it('recent / usage 非数字 map 时降级为空', () => {
    const result = parsePreferences(
      JSON.stringify({ recent: { a: 'x' }, usage: { b: true } }),
    );
    expect(result.recent).toEqual({});
    expect(result.usage).toEqual({});
  });

  it('保留合法 recent / usage', () => {
    const result = parsePreferences(
      JSON.stringify({ recent: { a: 100 }, usage: { a: 3 } }),
    );
    expect(result.recent).toEqual({ a: 100 });
    expect(result.usage).toEqual({ a: 3 });
  });
});

describe('toggleFavorite / isFavorite', () => {
  it('未收藏 → 加入', () => {
    const next = toggleFavorite(emptyPreferences(), 'a');
    expect(isFavorite(next, 'a')).toBe(true);
  });

  it('已收藏 → 取消', () => {
    const once = toggleFavorite(emptyPreferences(), 'a');
    const twice = toggleFavorite(once, 'a');
    expect(isFavorite(twice, 'a')).toBe(false);
  });

  it('不修改原对象（纯函数）', () => {
    const base = emptyPreferences();
    toggleFavorite(base, 'a');
    expect(base.favorites).toEqual([]);
  });
});

describe('touchUsage', () => {
  it('首次使用：recent 写时间戳 + usage 置 1', () => {
    const next = touchUsage(emptyPreferences(), 'a', 1000);
    expect(next.recent['a']).toBe(1000);
    expect(next.usage['a']).toBe(1);
  });

  it('再次使用：usage 累加、recent 刷新时间', () => {
    const once = touchUsage(emptyPreferences(), 'a', 1000);
    const twice = touchUsage(once, 'a', 2000);
    expect(twice.usage['a']).toBe(2);
    expect(twice.recent['a']).toBe(2000);
  });

  it('recent 超过 20 条时裁剪到最近 20 条', () => {
    let prefs: TemplatePreferences = emptyPreferences();
    for (let i = 0; i < 25; i++) {
      prefs = touchUsage(prefs, `t-${i}`, 1000 + i);
    }
    expect(Object.keys(prefs.recent)).toHaveLength(20);
    // 最早的几个（t-0..t-4）应被裁掉
    expect(prefs.recent['t-0']).toBeUndefined();
    expect(prefs.recent['t-24']).toBeDefined();
  });

  it('usage 不受 recent 裁剪影响（累计保留）', () => {
    let prefs: TemplatePreferences = emptyPreferences();
    for (let i = 0; i < 25; i++) {
      prefs = touchUsage(prefs, `t-${i}`, 1000 + i);
    }
    // usage 记录所有 25 个
    expect(Object.keys(prefs.usage)).toHaveLength(25);
  });

  it('不修改原对象（纯函数）', () => {
    const base = emptyPreferences();
    touchUsage(base, 'a', 1000);
    expect(base.recent).toEqual({});
    expect(base.usage).toEqual({});
  });
});

describe('pruneToExisting', () => {
  it('清理已不存在的 id', () => {
    const prefs: TemplatePreferences = {
      favorites: ['a', 'gone'],
      recent: { a: 100, gone: 200 },
      usage: { a: 1, gone: 5 },
    };
    const pruned = pruneToExisting(prefs, new Set(['a']));
    expect(pruned.favorites).toEqual(['a']);
    expect(pruned.recent).toEqual({ a: 100 });
    expect(pruned.usage).toEqual({ a: 1 });
  });

  it('全部存在时保持不变', () => {
    const prefs: TemplatePreferences = {
      favorites: ['a', 'b'],
      recent: { a: 100, b: 200 },
      usage: { a: 1, b: 2 },
    };
    const pruned = pruneToExisting(prefs, new Set(['a', 'b']));
    expect(pruned).toEqual(prefs);
  });

  it('空集合清空所有', () => {
    const prefs: TemplatePreferences = {
      favorites: ['a'],
      recent: { a: 100 },
      usage: { a: 1 },
    };
    const pruned = pruneToExisting(prefs, new Set());
    expect(pruned).toEqual(emptyPreferences());
  });
});

describe('recentTemplateIds', () => {
  it('按时间倒序返回', () => {
    const prefs: TemplatePreferences = {
      favorites: [],
      recent: { a: 100, b: 300, c: 200 },
      usage: {},
    };
    expect(recentTemplateIds(prefs)).toEqual(['b', 'c', 'a']);
  });

  it('limit 限制数量', () => {
    const prefs: TemplatePreferences = {
      favorites: [],
      recent: { a: 100, b: 300, c: 200 },
      usage: {},
    };
    expect(recentTemplateIds(prefs, 2)).toEqual(['b', 'c']);
  });

  it('空 recent 返回空数组', () => {
    expect(recentTemplateIds(emptyPreferences())).toEqual([]);
  });
});
