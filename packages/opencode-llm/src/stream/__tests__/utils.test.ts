/**
 * 工具函数测试
 */

import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import {
  isValidJson,
  calculateBackoff,
  isRetryableError,
  formatBytes,
  safeParseJson,
} from '../utils.js';
import { LLMError } from '../../schema/index.js';

describe('StreamUtils', () => {
  describe('isValidJson', () => {
    it('应该识别有效的 JSON', () => {
      expect(isValidJson('{}')).toBe(true);
      expect(isValidJson('[]')).toBe(true);
      expect(isValidJson('{"key": "value"}')).toBe(true);
      expect(isValidJson('[1, 2, 3]')).toBe(true);
      expect(isValidJson('"string"')).toBe(true);
      expect(isValidJson('123')).toBe(true);
      expect(isValidJson('true')).toBe(true);
      expect(isValidJson('null')).toBe(true);
    });

    it('应该识别无效的 JSON', () => {
      expect(isValidJson('{')).toBe(false);
      expect(isValidJson('{"key"}')).toBe(false);
      expect(isValidJson('[1, 2,')).toBe(false);
      expect(isValidJson('undefined')).toBe(false);
      expect(isValidJson('')).toBe(false);
    });
  });

  describe('safeParseJson', () => {
    it('应该成功解析有效的 JSON', async () => {
      const result = await Effect.runPromise(safeParseJson('{"key": "value"}'));
      expect(result).toEqual({ key: 'value' });
    });

    it('应该对无效 JSON 返回错误', async () => {
      await expect(Effect.runPromise(safeParseJson('{invalid}'))).rejects.toThrow();
    });
  });

  describe('calculateBackoff', () => {
    it('应该计算指数退避时间', () => {
      const baseDelay = 1000;
      const maxDelay = 30000;

      // 无抖动的情况
      expect(calculateBackoff(0, baseDelay, maxDelay, false)).toBe(1000);
      expect(calculateBackoff(1, baseDelay, maxDelay, false)).toBe(2000);
      expect(calculateBackoff(2, baseDelay, maxDelay, false)).toBe(4000);
      expect(calculateBackoff(3, baseDelay, maxDelay, false)).toBe(8000);
      expect(calculateBackoff(10, baseDelay, maxDelay, false)).toBe(30000); // 达到上限
    });

    it('应该添加随机抖动', () => {
      const baseDelay = 1000;
      const maxDelay = 30000;

      const results = Array.from({ length: 10 }, () =>
        calculateBackoff(1, baseDelay, maxDelay, true),
      );

      // 所有结果应该在合理范围内 (2000 ± 500)
      results.forEach((result) => {
        expect(result).toBeGreaterThanOrEqual(1500);
        expect(result).toBeLessThanOrEqual(2500);
      });

      // 应该有不同的值（不是所有都相同）
      const uniqueValues = new Set(results);
      expect(uniqueValues.size).toBeGreaterThan(1);
    });
  });

  describe('isRetryableError', () => {
    it('应该识别可重试的网络错误', () => {
      expect(isRetryableError(new Error('Network timeout'))).toBe(true);
      expect(isRetryableError(new Error('ECONNRESET'))).toBe(true);
      expect(isRetryableError(new Error('ECONNREFUSED'))).toBe(true);
      expect(isRetryableError(new Error('socket hang up'))).toBe(true);
      expect(isRetryableError(new Error('503 Service Unavailable'))).toBe(true);
      expect(isRetryableError(new Error('504 Gateway Timeout'))).toBe(true);
      expect(isRetryableError(new Error('429 Too Many Requests'))).toBe(true);
    });

    it('应该识别不可重试的错误', () => {
      expect(isRetryableError(new Error('Invalid request'))).toBe(false);
      expect(isRetryableError(new Error('Authentication failed'))).toBe(false);
      expect(isRetryableError(new Error('400 Bad Request'))).toBe(false);
    });
  });

  describe('formatBytes', () => {
    it('应该正确格式化字节大小', () => {
      expect(formatBytes(0)).toBe('0 B');
      expect(formatBytes(512)).toBe('512.00 B');
      expect(formatBytes(1024)).toBe('1.00 KB');
      expect(formatBytes(1536)).toBe('1.50 KB');
      expect(formatBytes(1048576)).toBe('1.00 MB');
      expect(formatBytes(1073741824)).toBe('1.00 GB');
    });
  });
});
