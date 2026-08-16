/**
 * 增量 JSON 解析器测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Effect } from 'effect';
import { IncrementalJsonParser } from '../incremental-json-parser.js';

describe('IncrementalJsonParser', () => {
  let parser: IncrementalJsonParser;

  beforeEach(() => {
    parser = new IncrementalJsonParser();
  });

  describe('基本功能', () => {
    it('应该解析完整的 JSON 对象', async () => {
      const result = await Effect.runPromise(parser.append('{"key": "value"}'));
      expect(result).toEqual([{ key: 'value' }]);
    });

    it('应该解析完整的 JSON 数组', async () => {
      const result = await Effect.runPromise(parser.append('[1, 2, 3]'));
      expect(result).toEqual([[1, 2, 3]]);
    });

    it('应该处理空缓冲区', async () => {
      const result = await Effect.runPromise(parser.append(''));
      expect(result).toEqual([]);
    });

    it('应该处理空白字符', async () => {
      const result = await Effect.runPromise(parser.append('  \n\t  '));
      expect(result).toEqual([]);
    });
  });

  describe('增量解析', () => {
    it('应该处理分块的 JSON 对象', async () => {
      const result1 = await Effect.runPromise(parser.append('{"key":'));
      expect(result1).toEqual([]);

      const result2 = await Effect.runPromise(parser.append(' "val'));
      expect(result2).toEqual([]);

      const result3 = await Effect.runPromise(parser.append('ue"}'));
      expect(result3).toEqual([{ key: 'value' }]);
    });

    it('应该处理多个连续的对象', async () => {
      const result = await Effect.runPromise(parser.append('{"a": 1}{"b": 2}{"c": 3}'));
      expect(result).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
    });

    it('应该处理对象间的空白', async () => {
      const result = await Effect.runPromise(parser.append('{"a": 1}  \n  {"b": 2}  '));
      expect(result).toEqual([{ a: 1 }, { b: 2 }]);
    });

    it('应该保留未完成的部分', async () => {
      const result1 = await Effect.runPromise(parser.append('{"a": 1}{"b":'));
      expect(result1).toEqual([{ a: 1 }]);
      expect(parser.getBuffer()).toBe('{"b":');

      const result2 = await Effect.runPromise(parser.append(' 2}'));
      expect(result2).toEqual([{ b: 2 }]);
      expect(parser.getBuffer()).toBe('');
    });
  });

  describe('嵌套结构', () => {
    it('应该处理嵌套对象', async () => {
      const result = await Effect.runPromise(parser.append('{"outer": {"inner": "value"}}'));
      expect(result).toEqual([{ outer: { inner: 'value' } }]);
    });

    it('应该处理嵌套数组', async () => {
      const result = await Effect.runPromise(parser.append('{"arr": [[1, 2], [3, 4]]}'));
      expect(result).toEqual([
        {
          arr: [
            [1, 2],
            [3, 4],
          ],
        },
      ]);
    });

    it('应该正确跟踪嵌套深度', async () => {
      const result1 = await Effect.runPromise(parser.append('{"a": {"b": {'));
      expect(result1).toEqual([]);

      const result2 = await Effect.runPromise(parser.append('"c": 1}}}'));
      expect(result2).toEqual([{ a: { b: { c: 1 } } }]);
    });
  });

  describe('字符串处理', () => {
    it('应该处理字符串中的引号', async () => {
      const result = await Effect.runPromise(parser.append('{"key": "va\\"lue"}'));
      expect(result).toEqual([{ key: 'va"lue' }]);
    });

    it('应该处理字符串中的花括号', async () => {
      const result = await Effect.runPromise(parser.append('{"key": "value{with}braces"}'));
      expect(result).toEqual([{ key: 'value{with}braces' }]);
    });

    it('应该处理字符串中的反斜杠', async () => {
      const result = await Effect.runPromise(parser.append('{"key": "path\\\\to\\\\file"}'));
      expect(result).toEqual([{ key: 'path\\to\\file' }]);
    });
  });

  describe('finish 方法', () => {
    it('应该解析完整的剩余内容', async () => {
      await Effect.runPromise(parser.append('{"key":'));
      await Effect.runPromise(parser.append(' "value"}'));

      const result = await Effect.runPromise(parser.finish());
      expect(result).toEqual([]);
      expect(parser.getBuffer()).toBe('');
    });

    it('应该在没有剩余内容时返回空数组', async () => {
      const result = await Effect.runPromise(parser.finish());
      expect(result).toEqual([]);
    });

    it('应该在内容不完整时抛出错误', async () => {
      await Effect.runPromise(parser.append('{"key": "val'));

      await expect(Effect.runPromise(parser.finish())).rejects.toThrow();
    });
  });

  describe('状态管理', () => {
    it('应该正确报告缓冲区大小', async () => {
      await Effect.runPromise(parser.append('{"partial"'));
      expect(parser.getBufferSize()).toBeGreaterThan(0);
    });

    it('应该检测缓冲数据', async () => {
      expect(parser.hasBufferedData()).toBe(false);

      await Effect.runPromise(parser.append('{"partial"'));
      expect(parser.hasBufferedData()).toBe(true);

      await Effect.runPromise(parser.append(': 1}'));
      expect(parser.hasBufferedData()).toBe(false);
    });

    it('应该正确清空状态', async () => {
      await Effect.runPromise(parser.append('{"partial"'));
      parser.clear();

      expect(parser.getBuffer()).toBe('');
      expect(parser.getBufferSize()).toBe(0);
      expect(parser.hasBufferedData()).toBe(false);
    });
  });

  describe('边界情况', () => {
    it('应该处理非常大的对象', async () => {
      const largeObj = { data: 'x'.repeat(10000) };
      const result = await Effect.runPromise(parser.append(JSON.stringify(largeObj)));
      expect(result).toEqual([largeObj]);
    });

    it('应该处理深度嵌套的结构', async () => {
      let nested: Record<string, unknown> = { value: 'deep' };
      for (let i = 0; i < 50; i++) {
        nested = { level: nested };
      }

      const result = await Effect.runPromise(parser.append(JSON.stringify(nested)));
      expect(result).toEqual([nested]);
    });

    it('应该处理 Unicode 字符', async () => {
      const result = await Effect.runPromise(parser.append('{"emoji": "😀", "chinese": "中文"}'));
      expect(result).toEqual([{ emoji: '😀', chinese: '中文' }]);
    });

    it('应该处理特殊数字值', async () => {
      const result = await Effect.runPromise(
        parser.append('{"int": 42, "float": 3.14, "exp": 1e10, "negative": -99}'),
      );
      expect(result).toEqual([{ int: 42, float: 3.14, exp: 1e10, negative: -99 }]);
    });
  });
});
