/**
 * team-page-v2-tabs · 子视图记忆（leaf memory）单测
 *
 * 验证：切走再切回主 tab 时能恢复上次停留的子视图（含非法/损坏记录的退化）。
 */

import { describe, expect, it } from 'vitest';
import {
  LEAF_BY_PRIMARY_STORAGE_KEY,
  readRememberedLeaf,
  rememberLeaf,
  type TabMemoryStorage,
} from './team-page-v2-tabs.js';

function createMemoryStorage(): TabMemoryStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

describe('主 tab 子视图记忆', () => {
  it('记录后可按所属主 tab 读回', () => {
    const storage = createMemoryStorage();
    rememberLeaf('review', storage);
    expect(readRememberedLeaf('tasks', storage)).toBe('review');
  });

  it('多个主 tab 各自独立记忆', () => {
    const storage = createMemoryStorage();
    rememberLeaf('review', storage);
    rememberLeaf('graph', storage);
    expect(readRememberedLeaf('tasks', storage)).toBe('review');
    expect(readRememberedLeaf('overview', storage)).toBe('graph');
  });

  it('无记录时返回 null（回落到默认子 tab）', () => {
    const storage = createMemoryStorage();
    expect(readRememberedLeaf('tasks', storage)).toBeNull();
  });

  it('JSON 损坏时返回 null 而不是抛错', () => {
    const storage = createMemoryStorage();
    storage.setItem(LEAF_BY_PRIMARY_STORAGE_KEY, 'not-json');
    expect(readRememberedLeaf('tasks', storage)).toBeNull();
  });

  it('记录的 leaf 不属于该主 tab 时视为无效', () => {
    const storage = createMemoryStorage();
    storage.setItem(LEAF_BY_PRIMARY_STORAGE_KEY, JSON.stringify({ tasks: 'graph' }));
    expect(readRememberedLeaf('tasks', storage)).toBeNull();
  });

  it('office 等无主 tab 的 leaf 不记录', () => {
    const storage = createMemoryStorage();
    rememberLeaf('office', storage);
    expect(storage.getItem(LEAF_BY_PRIMARY_STORAGE_KEY)).toBeNull();
  });

  it('同一主 tab 后写覆盖先写（只保留最后位置）', () => {
    const storage = createMemoryStorage();
    rememberLeaf('taskboard', storage);
    rememberLeaf('review', storage);
    expect(readRememberedLeaf('tasks', storage)).toBe('review');
  });

  it('存储抛错时安全退化（读返回 null / 写不抛错）', () => {
    const broken: TabMemoryStorage = {
      getItem: () => {
        throw new Error('storage broken');
      },
      setItem: () => {
        throw new Error('storage broken');
      },
    };
    expect(readRememberedLeaf('tasks', broken)).toBeNull();
    expect(() => rememberLeaf('review', broken)).not.toThrow();
  });
});
