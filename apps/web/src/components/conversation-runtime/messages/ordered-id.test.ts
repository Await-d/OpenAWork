import { describe, expect, it } from 'vitest';

import { compareOrderedIds, makeOrderedMessageId } from './ordered-id.js';

/** 26 * 2^36 ms = 2026-08-14T11:19:55.136Z，最近一次 48 位时间戳回绕。 */
const WRAP_MS = 26 * 2 ** 36;

describe('compareOrderedIds', () => {
  it('回绕前后各 1 秒的 ID 按真实创建时间升序（字符串比较会反转）', () => {
    const beforeWrap = makeOrderedMessageId(WRAP_MS - 1_000);
    const afterWrap = makeOrderedMessageId(WRAP_MS + 1_000);

    expect(beforeWrap > afterWrap).toBe(true);
    expect(compareOrderedIds(beforeWrap, afterWrap, WRAP_MS)).toBe(-1);
    expect(compareOrderedIds(afterWrap, beforeWrap, WRAP_MS)).toBe(1);
  });

  it('同一时间周期内的两个 ID 按创建时间升序', () => {
    const referenceMs = 1_700_000_001_000;
    const earlier = makeOrderedMessageId(1_700_000_000_000);
    const later = makeOrderedMessageId(referenceMs);

    expect(compareOrderedIds(earlier, later, referenceMs)).toBe(-1);
    expect(compareOrderedIds(later, earlier, referenceMs)).toBe(1);
  });

  it('非有序 ID（如实时占位符）返回 null', () => {
    const ordered = makeOrderedMessageId(1_700_000_000_000);

    expect(compareOrderedIds('__streaming__', ordered)).toBeNull();
    expect(compareOrderedIds(ordered, '__streaming__')).toBeNull();
    expect(compareOrderedIds('legacy-id', 'another-legacy-id')).toBeNull();
  });

  it('同一毫秒内的两个 ID 按同毫秒计数器升序', () => {
    const sameMs = 1_600_000_000_000;
    const first = makeOrderedMessageId(sameMs);
    const second = makeOrderedMessageId(sameMs);

    expect(compareOrderedIds(first, second, sameMs)).toBe(-1);
    expect(compareOrderedIds(second, first, sameMs)).toBe(1);
  });
});
