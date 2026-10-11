import { describe, expect, it } from 'vitest';
import { parseJSON } from '../utils/partial-json.js';
import { parsePartialJSON } from '../../index.js';

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

  it('恢复未闭合字符串值中已完整写出的命令', () => {
    expect(parseJSON('{"command": "docker ps -a --filter \\"publish=8096\\" 2/')).toEqual({
      command: 'docker ps -a --filter "publish=8096" 2/',
    });
  });

  it('保留已完成的兄弟字段,丢弃截断到一半的键', () => {
    expect(parseJSON('{"command": "ls", "description": "查看目录", "timeout":')).toEqual({
      command: 'ls',
      description: '查看目录',
    });
  });
});

describe('partial-json 包入口导出', () => {
  it('从包入口导出 parsePartialJSON,供网关累积器复用', () => {
    expect(typeof parsePartialJSON).toBe('function');
    expect(parsePartialJSON('{"command": "ls -la", "cwd":')).toEqual({ command: 'ls -la' });
  });
});
