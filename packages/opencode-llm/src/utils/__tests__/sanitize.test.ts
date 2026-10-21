/**
 * `sanitizeSurrogates` 契约测试（对齐上游 `packages/ai@v2.0.28` 的 `utils/sanitize.ts`）。
 *
 * 目的：未配对的 UTF-16 代理会被 `JSON.stringify` 序列化成裸 `\uD800` 转义，
 * 严格上游以 400 拒绝整个请求。清洗必须**只**动孤立代理，合法代理对与二进制载荷
 * 必须原样保留，否则等于数据损坏。
 */

import { describe, expect, it } from 'vitest';
import { sanitizeSurrogates } from '../sanitize.js';

const REPLACEMENT = '\uFFFD';

describe('sanitizeSurrogates', () => {
  it('孤立高位代理替换为 U+FFFD', () => {
    expect(sanitizeSurrogates('a\uD800b')).toBe(`a${REPLACEMENT}b`);
  });

  it('孤立低位代理替换为 U+FFFD', () => {
    expect(sanitizeSurrogates('a\uDC00b')).toBe(`a${REPLACEMENT}b`);
  });

  it('连续两个孤立低位代理都要替换（零宽断言不漏第二个）', () => {
    expect(sanitizeSurrogates('\uDC00\uDC00')).toBe(`${REPLACEMENT}${REPLACEMENT}`);
  });

  it('合法代理对（emoji）原样保留', () => {
    expect(sanitizeSurrogates('ok 😀 done')).toBe('ok 😀 done');
  });

  it('尾部被截断的 emoji 只替换缺的一半', () => {
    // '😀' = \uD83D\uDE00；截掉低位代理后高位成为孤立代理。
    expect(sanitizeSurrogates('a\uD83D')).toBe(`a${REPLACEMENT}`);
  });

  it('递归处理数组', () => {
    expect(sanitizeSurrogates(['\uD800', 'ok'])).toEqual([REPLACEMENT, 'ok']);
  });

  it('递归处理对象值', () => {
    expect(sanitizeSurrogates({ a: '\uDC00' })).toEqual({ a: REPLACEMENT });
  });

  it('清洗对象键里的孤立代理', () => {
    expect(sanitizeSurrogates({ '\uD800key': 1 })).toEqual({ [`${REPLACEMENT}key`]: 1 });
  });

  it('深层嵌套结构逐层清洗', () => {
    expect(sanitizeSurrogates({ a: [{ b: ['\uD800'] }] })).toEqual({
      a: [{ b: [REPLACEMENT] }],
    });
  });

  it('Uint8Array 原样返回（二进制载荷不逐码元改写）', () => {
    const bytes = new Uint8Array([0xd8, 0x00, 0xff]);
    expect(sanitizeSurrogates(bytes)).toBe(bytes);
  });

  it('Error 原样返回', () => {
    const error = new Error('\uD800');
    expect(sanitizeSurrogates(error)).toBe(error);
  });

  it('数字/布尔/null 原样返回', () => {
    expect(sanitizeSurrogates(42)).toBe(42);
    expect(sanitizeSurrogates(false)).toBe(false);
    expect(sanitizeSurrogates(null)).toBe(null);
  });

  it('清洗后的字符串可被 JSON.stringify 安全序列化（无裸代理转义）', () => {
    const serialized = JSON.stringify({ text: sanitizeSurrogates('x\uD800y') });
    expect(serialized).toBe(`{"text":"x${REPLACEMENT}y"}`);
    expect(serialized).not.toContain('\\ud800');
  });
});
