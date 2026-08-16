/**
 * 工具结果解析器单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ToolResultParser } from '../result-parser.js';
import type { RawToolResult } from '../result-parser.js';

describe('ToolResultParser', () => {
  let parser: ToolResultParser;

  beforeEach(() => {
    parser = new ToolResultParser();
  });

  describe('parse - 成功结果', () => {
    it('应该解析字符串输出', () => {
      const raw: RawToolResult = {
        toolCallId: 'call_123',
        toolName: 'test_tool',
        output: 'Hello, world!',
        isError: false,
        durationMs: 100,
      };

      const result = parser.parse(raw);

      expect(result.isError).toBe(false);
      expect(result.result.type).toBe('text');
      expect(result.result.value).toBe('Hello, world!');
      expect(result.durationMs).toBe(100);
    });

    it('应该解析 JSON 对象输出', () => {
      const raw: RawToolResult = {
        toolCallId: 'call_123',
        toolName: 'test_tool',
        output: { success: true, data: [1, 2, 3] },
        isError: false,
      };

      const result = parser.parse(raw);

      expect(result.isError).toBe(false);
      expect(result.result.type).toBe('json');
      expect(result.result.value).toEqual({ success: true, data: [1, 2, 3] });
    });

    it('应该解析 null 输出', () => {
      const raw: RawToolResult = {
        toolCallId: 'call_123',
        toolName: 'test_tool',
        output: null,
        isError: false,
      };

      const result = parser.parse(raw);

      expect(result.isError).toBe(false);
      expect(result.result.type).toBe('json');
      expect(result.result.value).toBe(null);
    });

    it('应该解析 undefined 输出', () => {
      const raw: RawToolResult = {
        toolCallId: 'call_123',
        toolName: 'test_tool',
        output: undefined,
        isError: false,
      };

      const result = parser.parse(raw);

      expect(result.isError).toBe(false);
      expect(result.result.type).toBe('json');
      expect(result.result.value).toBe(undefined);
    });

    it('应该解析 ToolContent 数组输出', () => {
      const raw: RawToolResult = {
        toolCallId: 'call_123',
        toolName: 'test_tool',
        output: [
          { type: 'text', text: 'Hello' },
          { type: 'text', text: 'World' },
        ],
        isError: false,
      };

      const result = parser.parse(raw);

      expect(result.isError).toBe(false);
      expect(result.result.type).toBe('content');
      expect(result.result.value).toHaveLength(2);
    });
  });

  describe('parse - 错误结果', () => {
    it('应该解析字符串错误', () => {
      const raw: RawToolResult = {
        toolCallId: 'call_123',
        toolName: 'test_tool',
        output: 'Tool execution failed',
        isError: true,
      };

      const result = parser.parse(raw);

      expect(result.isError).toBe(true);
      expect(result.result.type).toBe('error');
      expect(result.result.value).toBe('Tool execution failed');
    });

    it('应该解析 Error 对象', () => {
      const error = new Error('Something went wrong');
      const raw: RawToolResult = {
        toolCallId: 'call_123',
        toolName: 'test_tool',
        output: error,
        isError: true,
      };

      const result = parser.parse(raw);

      expect(result.isError).toBe(true);
      expect(result.result.type).toBe('error');
      expect(result.result.value).toBe('Something went wrong');
    });

    it('应该解析带堆栈的错误', () => {
      const parserWithStack = new ToolResultParser({ preserveErrorStack: true });
      const error = new Error('Stack error');
      error.stack = 'Error: Stack error\n  at test.ts:10:5';

      const raw: RawToolResult = {
        toolCallId: 'call_123',
        toolName: 'test_tool',
        output: error,
        isError: true,
      };

      const result = parserWithStack.parse(raw);

      expect(result.isError).toBe(true);
      expect(result.result.value).toContain('Stack error');
      expect(result.result.value).toContain('test.ts:10:5');
    });

    it('应该解析对象格式的错误', () => {
      const raw: RawToolResult = {
        toolCallId: 'call_123',
        toolName: 'test_tool',
        output: { message: 'Custom error message' },
        isError: true,
      };

      const result = parser.parse(raw);

      expect(result.isError).toBe(true);
      expect(result.result.type).toBe('error');
      expect(result.result.value).toBe('Custom error message');
    });
  });

  describe('输出截断', () => {
    it('应该截断超长输出', () => {
      const longString = 'x'.repeat(300_000);
      const parserWithLimit = new ToolResultParser({ maxOutputLength: 1000 });

      const raw: RawToolResult = {
        toolCallId: 'call_123',
        toolName: 'test_tool',
        output: longString,
        isError: false,
      };

      const result = parserWithLimit.parse(raw);

      expect((result.result.value as string).length).toBeLessThan(1100);
      expect(result.result.value).toContain('[输出已截断');
    });

    it('应该不截断短输出', () => {
      const shortString = 'Short output';
      const raw: RawToolResult = {
        toolCallId: 'call_123',
        toolName: 'test_tool',
        output: shortString,
        isError: false,
      };

      const result = parser.parse(raw);

      expect(result.result.value).toBe(shortString);
      expect(result.result.value).not.toContain('[输出已截断');
    });
  });

  describe('parseMany', () => {
    it('应该批量解析结果', () => {
      const rawResults: RawToolResult[] = [
        {
          toolCallId: 'call_1',
          toolName: 'tool1',
          output: 'result1',
          isError: false,
        },
        {
          toolCallId: 'call_2',
          toolName: 'tool2',
          output: 'error',
          isError: true,
        },
      ];

      const results = parser.parseMany(rawResults);

      expect(results).toHaveLength(2);
      expect(results[0]?.isError).toBe(false);
      expect(results[1]?.isError).toBe(true);
    });
  });

  describe('特殊情况', () => {
    it('应该处理循环引用的对象', () => {
      const obj: Record<string, unknown> = { name: 'test' };
      obj.self = obj; // 创建循环引用

      const raw: RawToolResult = {
        toolCallId: 'call_123',
        toolName: 'test_tool',
        output: obj,
        isError: false,
      };

      const result = parser.parse(raw);

      expect(result.isError).toBe(false);
      expect(result.result.type).toBe('json');
    });

    it('应该处理 BigInt 值', () => {
      const raw: RawToolResult = {
        toolCallId: 'call_123',
        toolName: 'test_tool',
        output: { value: BigInt(9007199254740991) },
        isError: false,
      };

      const result = parser.parse(raw);

      expect(result.isError).toBe(false);
      expect(result.result.type).toBe('json');
    });
  });
});
