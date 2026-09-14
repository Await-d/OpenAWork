// @vitest-environment jsdom
/**
 * 展开态持久化的行为约定：
 *   1. 按 scopeKey（会话）分键，互不串味；
 *   2. 没有 scopeKey 时完全不读写 —— 内嵌 / 测试场景不该悄悄污染 localStorage；
 *   3. 存量数据形状不对（非数组 / 混入非字符串）时按「没有持久化」处理，不抛异常；
 *   4. localStorage 抛异常（隐私模式 / 配额耗尽）时读返回空集、写静默失败。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cardWallExpandedStorageKey,
  readCardWallExpandedKeys,
  writeCardWallExpandedKeys,
} from './card-wall-expanded-state.js';

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('card-wall-expanded-state', () => {
  it('写入后可原样读回', () => {
    writeCardWallExpandedKeys('s-1', ['s-exec', 's-pm1']);

    expect([...readCardWallExpandedKeys('s-1')].sort()).toEqual(['s-exec', 's-pm1']);
  });

  it('会话之间互不串味', () => {
    writeCardWallExpandedKeys('s-1', ['a']);
    writeCardWallExpandedKeys('s-2', ['b']);

    expect([...readCardWallExpandedKeys('s-1')]).toEqual(['a']);
    expect([...readCardWallExpandedKeys('s-2')]).toEqual(['b']);
    expect([...readCardWallExpandedKeys('s-3')]).toEqual([]);
  });

  it('没有 scopeKey 时不写也不读', () => {
    writeCardWallExpandedKeys(null, ['a']);
    writeCardWallExpandedKeys(undefined, ['a']);

    expect(window.localStorage.length).toBe(0);
    expect(readCardWallExpandedKeys(null).size).toBe(0);
    expect(readCardWallExpandedKeys(undefined).size).toBe(0);
  });

  it('存量数据形状不对时降级为空集，不抛异常', () => {
    window.localStorage.setItem(cardWallExpandedStorageKey('s-1'), '{not-json');
    expect(readCardWallExpandedKeys('s-1').size).toBe(0);

    window.localStorage.setItem(cardWallExpandedStorageKey('s-2'), '{"a":1}');
    expect(readCardWallExpandedKeys('s-2').size).toBe(0);

    window.localStorage.setItem(cardWallExpandedStorageKey('s-3'), '["ok", 42, null, ""]');
    expect([...readCardWallExpandedKeys('s-3')]).toEqual(['ok']);
  });

  it('localStorage 抛异常时读空集、写不向外抛', () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => readCardWallExpandedKeys('s-1')).not.toThrow();
    expect(readCardWallExpandedKeys('s-1').size).toBe(0);

    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => writeCardWallExpandedKeys('s-1', ['a'])).not.toThrow();
  });
});
