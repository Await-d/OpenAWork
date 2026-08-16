/**
 * 工具调用日志记录器单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ToolCallLogger,
  createToolCallLogger,
  getGlobalLogger,
  setGlobalLogger,
} from '../logger.js';
import type { LogLevel } from '../logger.js';

describe('ToolCallLogger', () => {
  let logger: ToolCallLogger;

  beforeEach(() => {
    logger = new ToolCallLogger({ enableStats: true, level: 'debug' });
  });

  describe('基本日志记录', () => {
    it('应该记录工具调用开始', () => {
      logger.startCall('call_123', 'test_tool', { param: 'value' });

      const entries = logger.getEntries();

      expect(entries.length).toBeGreaterThan(0);
      expect(entries[0]?.toolName).toBe('test_tool');
      expect(entries[0]?.callId).toBe('call_123');
      expect(entries[0]?.phase).toBe('validation');
    });

    it('应该记录工具调用成功', () => {
      logger.startCall('call_123', 'test_tool');
      logger.logSuccess('call_123', 'test_tool', 'result');

      const entries = logger.getEntries();
      const successEntry = entries.find((e) => e.phase === 'completed');

      expect(successEntry).toBeDefined();
      expect(successEntry?.level).toBe('info');
      expect(successEntry?.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('应该记录工具调用失败', () => {
      const error = new Error('Tool failed');

      logger.startCall('call_123', 'test_tool');
      logger.logFailure('call_123', 'test_tool', error);

      const entries = logger.getEntries();
      const failureEntry = entries.find((e) => e.phase === 'failed');

      expect(failureEntry).toBeDefined();
      expect(failureEntry?.level).toBe('error');
      expect(failureEntry?.error).toBe(error);
    });

    it('应该记录重试', () => {
      const error = new Error('Temporary failure');

      logger.logRetry('call_123', 'test_tool', 2, error);

      const entries = logger.getEntries();
      const retryEntry = entries.find((e) => e.phase === 'retry');

      expect(retryEntry).toBeDefined();
      expect(retryEntry?.level).toBe('warn');
      expect(retryEntry?.data?.attempt).toBe(2);
    });

    it('应该记录降级', () => {
      logger.logFallback('call_123', 'test_tool', 'fallback_tool');

      const entries = logger.getEntries();
      const fallbackEntry = entries.find((e) => e.phase === 'fallback');

      expect(fallbackEntry).toBeDefined();
      expect(fallbackEntry?.level).toBe('warn');
      expect(fallbackEntry?.data?.fallbackToolName).toBe('fallback_tool');
    });

    it('应该记录自定义日志', () => {
      logger.logCustom('info', 'test_tool', 'call_123', 'execution', 'Custom message', {
        extra: 'data',
      });

      const entries = logger.getEntries();
      const customEntry = entries.find((e) => e.message === 'Custom message');

      expect(customEntry).toBeDefined();
      expect(customEntry?.data?.extra).toBe('data');
    });
  });

  describe('日志级别过滤', () => {
    it('应该根据日志级别过滤', () => {
      const warnLogger = new ToolCallLogger({ level: 'warn' });

      warnLogger.logCustom('debug', 'tool', 'call', 'execution', 'Debug message');
      warnLogger.logCustom('info', 'tool', 'call', 'execution', 'Info message');
      warnLogger.logCustom('warn', 'tool', 'call', 'execution', 'Warn message');
      warnLogger.logCustom('error', 'tool', 'call', 'execution', 'Error message');

      const entries = warnLogger.getEntries();

      expect(entries.length).toBe(2); // 只有 warn 和 error
      expect(entries.some((e) => e.level === 'debug')).toBe(false);
      expect(entries.some((e) => e.level === 'info')).toBe(false);
      expect(entries.some((e) => e.level === 'warn')).toBe(true);
      expect(entries.some((e) => e.level === 'error')).toBe(true);
    });
  });

  describe('日志查询', () => {
    beforeEach(() => {
      logger.startCall('call_1', 'tool1');
      logger.logSuccess('call_1', 'tool1', 'result1');

      logger.startCall('call_2', 'tool2');
      logger.logSuccess('call_2', 'tool2', 'result2');

      logger.startCall('call_3', 'tool1');
      logger.logFailure('call_3', 'tool1', new Error('Failed'));
    });

    it('应该获取指定工具的日志', () => {
      const tool1Entries = logger.getEntriesForTool('tool1');

      expect(tool1Entries.length).toBeGreaterThan(0);
      expect(tool1Entries.every((e) => e.toolName === 'tool1')).toBe(true);
    });

    it('应该获取指定调用的日志', () => {
      const call2Entries = logger.getEntriesForCall('call_2');

      expect(call2Entries.length).toBeGreaterThan(0);
      expect(call2Entries.every((e) => e.callId === 'call_2')).toBe(true);
    });
  });

  describe('统计功能', () => {
    it('应该统计工具调用', () => {
      logger.startCall('call_1', 'test_tool');
      logger.logSuccess('call_1', 'test_tool', 'result');

      logger.startCall('call_2', 'test_tool');
      logger.logFailure('call_2', 'test_tool', new Error('Failed'));

      const stats = logger.getStatsForTool('test_tool');

      expect(stats).toBeDefined();
      expect(stats?.totalCalls).toBe(2);
      expect(stats?.successCount).toBe(1);
      expect(stats?.failureCount).toBe(1);
      expect(stats?.avgDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('应该统计重试次数', () => {
      const warnLogger = new ToolCallLogger({ enableStats: true, level: 'warn' });

      warnLogger.startCall('call_1', 'test_tool');
      warnLogger.logRetry('call_1', 'test_tool', 1, new Error('Retry'));
      warnLogger.logRetry('call_1', 'test_tool', 2, new Error('Retry'));
      warnLogger.logSuccess('call_1', 'test_tool', 'result');

      const stats = warnLogger.getStatsForTool('test_tool');

      expect(stats?.retryCount).toBe(2);
    });

    it('应该统计降级次数', () => {
      const warnLogger = new ToolCallLogger({ enableStats: true, level: 'warn' });

      warnLogger.startCall('call_1', 'test_tool');
      warnLogger.logFallback('call_1', 'test_tool', 'fallback_tool');
      warnLogger.logSuccess('call_1', 'test_tool', 'result');

      const stats = warnLogger.getStatsForTool('test_tool');

      expect(stats?.fallbackCount).toBe(1);
    });

    it('应该计算平均耗时', () => {
      logger.startCall('call_1', 'test_tool');
      logger.logSuccess('call_1', 'test_tool', 'result1');

      logger.startCall('call_2', 'test_tool');
      logger.logSuccess('call_2', 'test_tool', 'result2');

      const stats = logger.getStatsForTool('test_tool');

      expect(stats).toBeDefined();
      expect(stats?.avgDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('应该记录最小和最大耗时', () => {
      logger.startCall('call_1', 'test_tool');
      logger.logSuccess('call_1', 'test_tool', 'result1');

      logger.startCall('call_2', 'test_tool');
      logger.logSuccess('call_2', 'test_tool', 'result2');

      const stats = logger.getStatsForTool('test_tool');

      expect(stats?.minDurationMs).toBeDefined();
      expect(stats?.maxDurationMs).toBeDefined();
      expect(stats?.minDurationMs).toBeLessThanOrEqual(stats?.maxDurationMs ?? 0);
    });
  });

  describe('日志清除', () => {
    beforeEach(() => {
      logger.startCall('call_1', 'tool1');
      logger.logSuccess('call_1', 'tool1', 'result');

      logger.startCall('call_2', 'tool2');
      logger.logSuccess('call_2', 'tool2', 'result');
    });

    it('应该清除所有日志', () => {
      logger.clear();

      expect(logger.getEntries().length).toBe(0);
      expect(logger.getStats().length).toBe(0);
    });

    it('应该清除指定工具的日志', () => {
      logger.clearForTool('tool1');

      const entries = logger.getEntries();
      const stats = logger.getStats();

      expect(entries.every((e) => e.toolName !== 'tool1')).toBe(true);
      expect(stats.every((s) => s.toolName !== 'tool1')).toBe(true);
    });
  });

  describe('循环缓冲', () => {
    it('应该限制日志条目数量', () => {
      const limitedLogger = new ToolCallLogger({ maxEntries: 5 });

      for (let i = 0; i < 10; i++) {
        limitedLogger.startCall(`call_${i}`, 'test_tool');
      }

      const entries = limitedLogger.getEntries();

      expect(entries.length).toBeLessThanOrEqual(5);
    });
  });

  describe('禁用日志', () => {
    it('应该在禁用时不记录日志', () => {
      const disabledLogger = new ToolCallLogger({ enabled: false });

      disabledLogger.startCall('call_1', 'test_tool');
      disabledLogger.logSuccess('call_1', 'test_tool', 'result');

      expect(disabledLogger.getEntries().length).toBe(0);
    });
  });

  describe('自定义输出函数', () => {
    it('应该使用自定义输出函数', () => {
      const outputs: string[] = [];
      const customLogger = new ToolCallLogger({
        level: 'debug',
        outputFn: (entry) => {
          outputs.push(`${entry.level}: ${entry.message}`);
        },
      });

      customLogger.startCall('call_1', 'test_tool');

      expect(outputs.length).toBeGreaterThan(0);
      expect(outputs[0]).toContain('Starting tool call');
    });
  });

  describe('全局日志记录器', () => {
    it('应该获取全局日志记录器', () => {
      const global1 = getGlobalLogger();
      const global2 = getGlobalLogger();

      expect(global1).toBe(global2); // 单例
    });

    it('应该设置全局日志记录器', () => {
      const customLogger = new ToolCallLogger({ level: 'error' });

      setGlobalLogger(customLogger);

      const retrieved = getGlobalLogger();

      expect(retrieved).toBe(customLogger);
    });
  });

  describe('createToolCallLogger 工厂函数', () => {
    it('应该创建新的日志记录器实例', () => {
      const logger1 = createToolCallLogger({ level: 'debug' });
      const logger2 = createToolCallLogger({ level: 'info' });

      expect(logger1).not.toBe(logger2);
    });
  });
});
