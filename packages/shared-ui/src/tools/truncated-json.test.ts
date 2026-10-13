import { describe, expect, it } from 'vitest';
import { parseJsonObjectTolerant, repairTruncatedJsonObject } from './truncated-json.js';

/**
 * 修复只做「补闭合」：保留截断点之前已收到的内容，丢弃无法判断的半截 token。
 * 任何臆造字段都会让 diff 与真实变更不一致，因此实现里不允许「猜」。
 */
describe('parseJsonObjectTolerant', () => {
  it('完整 JSON 走严格解析且不标记截断', () => {
    expect(parseJsonObjectTolerant('{"a":1}')).toEqual({ value: { a: 1 }, truncated: false });
  });

  it('截断在值字符串里：补 `"` 保留已收到的正文', () => {
    const parsed = parseJsonObjectTolerant('{"before":"","after":"正文被截断');

    expect(parsed?.truncated).toBe(true);
    expect(parsed?.value).toEqual({ before: '', after: '正文被截断' });
  });

  it('截断在半个 \\uXXXX 转义里：丢弃该转义序列后再闭合', () => {
    expect(parseJsonObjectTolerant('{"a":"x\\u4e2')?.value).toEqual({ a: 'x' });
  });

  it('截断在结尾反斜杠上：丢弃半截转义', () => {
    expect(parseJsonObjectTolerant('{"a":"x\\')?.value).toEqual({ a: 'x' });
  });

  it('截断在键上：回退到最后一个完整字段', () => {
    expect(parseJsonObjectTolerant('{"a":1,"b')?.value).toEqual({ a: 1 });
  });

  it('截断在冒号 / 逗号后：回退到最后一个完整字段', () => {
    expect(parseJsonObjectTolerant('{"a":1,"b":')?.value).toEqual({ a: 1 });
    expect(parseJsonObjectTolerant('{"a":1,')?.value).toEqual({ a: 1 });
  });

  it('截断在嵌套对象里：内层已完成字段保留', () => {
    const parsed = parseJsonObjectTolerant('{"ok":true,"filediff":{"file":"/a.md","after":"y');

    expect(parsed?.value).toEqual({ ok: true, filediff: { file: '/a.md', after: 'y' } });
  });

  it('截断在数组项里：已完成项与半截项都保留', () => {
    const parsed = parseJsonObjectTolerant('{"files":[{"path":"a"},{"path":"b');

    expect(parsed?.value).toEqual({ files: [{ path: 'a' }, { path: 'b' }] });
  });

  it('裸文本 / 数组 / 空串一律不处理（bash 输出不得进入 JSON 解析）', () => {
    expect(parseJsonObjectTolerant('hi\n')).toBeNull();
    expect(parseJsonObjectTolerant('[1,2')).toBeNull();
    expect(parseJsonObjectTolerant('')).toBeNull();
  });

  it('完全不是 JSON 的 `{` 前缀文本不臆造结果', () => {
    expect(parseJsonObjectTolerant('{ this is not valid json')).toBeNull();
  });
});

describe('repairTruncatedJsonObject', () => {
  it('无法恢复时返回 null', () => {
    expect(repairTruncatedJsonObject('{')).toBeNull();
    expect(repairTruncatedJsonObject('{"a"')).toBeNull();
  });
});
