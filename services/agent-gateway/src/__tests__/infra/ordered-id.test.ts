import { describe, expect, it } from 'vitest';
import { compareOrderedIds, makeOrderedMessageId } from '../../infra/ordered-id.js';

const ORDERED_ID_TIME_PERIOD_MS = 2 ** 36;
const WRAP_REFERENCE_MS = 26 * ORDERED_ID_TIME_PERIOD_MS;
const NORMAL_REFERENCE_MS = 1_700_000_000_000;

describe('compareOrderedIds', () => {
  it('orders ids across the 48-bit timestamp wrap by true creation time', () => {
    const beforeWrap = makeOrderedMessageId(WRAP_REFERENCE_MS - 1000);
    const afterWrap = makeOrderedMessageId(WRAP_REFERENCE_MS + 1000);

    expect(beforeWrap.localeCompare(afterWrap)).toBeGreaterThan(0);
    expect(compareOrderedIds(beforeWrap, afterWrap, WRAP_REFERENCE_MS)).toBe(-1);
    expect(compareOrderedIds(afterWrap, beforeWrap, WRAP_REFERENCE_MS)).toBe(1);
  });

  it('orders a normal ascending pair', () => {
    const earlier = makeOrderedMessageId(NORMAL_REFERENCE_MS);
    const later = makeOrderedMessageId(NORMAL_REFERENCE_MS + 5000);

    expect(compareOrderedIds(earlier, later, NORMAL_REFERENCE_MS)).toBe(-1);
    expect(compareOrderedIds(later, earlier, NORMAL_REFERENCE_MS)).toBe(1);
  });

  it('returns 0 for identical ids', () => {
    const id = makeOrderedMessageId(NORMAL_REFERENCE_MS);
    expect(compareOrderedIds(id, id, NORMAL_REFERENCE_MS)).toBe(0);
  });

  it('falls back to localeCompare for ids without the ordered-id shape', () => {
    const left = '__streaming__';
    const right = makeOrderedMessageId(WRAP_REFERENCE_MS);

    expect(compareOrderedIds(left, right, WRAP_REFERENCE_MS)).toBe(left.localeCompare(right));
    expect(compareOrderedIds(right, left, WRAP_REFERENCE_MS)).toBe(right.localeCompare(left));
    expect(compareOrderedIds(left, '__tool__', WRAP_REFERENCE_MS)).toBe(
      left.localeCompare('__tool__'),
    );
    expect(compareOrderedIds('', '', WRAP_REFERENCE_MS)).toBe(0);
  });

  it('orders same-millisecond ids by their counter', () => {
    const sameMs = NORMAL_REFERENCE_MS + 1000;
    const first = makeOrderedMessageId(sameMs);
    const second = makeOrderedMessageId(sameMs);

    expect(first).not.toBe(second);
    expect(compareOrderedIds(first, second, sameMs)).toBe(-1);
    expect(compareOrderedIds(second, first, sameMs)).toBe(1);
  });
});
