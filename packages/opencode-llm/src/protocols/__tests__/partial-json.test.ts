import { describe, expect, it } from 'vitest';
import { parseJSON } from '../utils/partial-json.js';

describe('partial-json', () => {
  it('解析合法 JSON', () => {
    expect(parseJSON('{"a":1}')).toEqual({ a: 1 });
  });

  it('修复字符串中未转义的换行控制符', () => {
    expect(parseJSON('{"command":"echo a\nls"}')).toEqual({ command: 'echo a\nls' });
  });

  it('修复字符串中多余的裸反斜杠', () => {
    expect(parseJSON('{"path":"D:\\data"}')).toEqual({ path: 'D:\\data' });
  });

  it('部分解析被截断的对象', () => {
    expect(parseJSON('{"command":"ls -la","cwd":')).toEqual({ command: 'ls -la' });
  });

  it('部分解析被截断的数组', () => {
    expect(parseJSON('[1, 2,')).toEqual([1, 2]);
  });

  it('对完全无法解析的输入抛错', () => {
    expect(() => parseJSON('not json at all')).toThrow();
  });
});
