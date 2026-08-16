/**
 * 工具执行器单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import { ToolExecutor, createToolExecutor } from '../tool-executor.js';
import type { OpenAWorkToolDefinition } from '../adapter.js';
import type { ToolExecutionRequest } from '../tool-executor.js';

describe('ToolExecutor', () => {
  // 模拟工具定义
  const createMockTool = (
    name: string,
    executor?: (input: unknown, signal: AbortSignal) => Promise<unknown>,
  ): OpenAWorkToolDefinition => ({
    name,
    description: `Mock tool: ${name}`,
    inputSchema: z.object({ value: z.string() }),
    outputSchema: z.object({ result: z.string() }),
    execute: executor,
    timeout: 5000,
  });

  describe('constructor', () => {
    it('应该接受工具数组并创建执行器', () => {
      const tools = [createMockTool('tool1'), createMockTool('tool2')];
      const executor = new ToolExecutor(tools);

      expect(executor.listTools()).toHaveLength(2);
    });

    it('应该接受工具 Map 并创建执行器', () => {
      const toolsMap = new Map([
        ['tool1', createMockTool('tool1')],
        ['tool2', createMockTool('tool2')],
      ]);
      const executor = new ToolExecutor(toolsMap);

      expect(executor.listTools()).toHaveLength(2);
    });

    it('应该使用默认配置', () => {
      const executor = new ToolExecutor([]);
      const stats = executor.getStats();

      expect(stats).toEqual([]);
    });
  });

  describe('execute', () => {
    let executor: ToolExecutor;

    beforeEach(() => {
      executor = new ToolExecutor([]);
    });

    it('应该成功执行工具调用', async () => {
      const mockExecute = vi.fn().mockResolvedValue({ result: 'success' });
      const tool = createMockTool('test-tool', mockExecute);
      executor.registerTool(tool);

      const request: ToolExecutionRequest = {
        toolCallId: 'call-1',
        toolName: 'test-tool',
        input: { value: 'test' },
      };

      const result = await executor.execute(request);

      expect(result.success).toBe(true);
      expect(result.toolCallId).toBe('call-1');
      expect(result.toolName).toBe('test-tool');
      expect(mockExecute).toHaveBeenCalledWith({ value: 'test' }, expect.any(Object));
    });

    it('应该处理工具不存在的情况', async () => {
      const request: ToolExecutionRequest = {
        toolCallId: 'call-1',
        toolName: 'non-existent-tool',
        input: {},
      };

      const result = await executor.execute(request);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('Tool not found');
    });

    it('应该处理工具无执行器的情况', async () => {
      const tool = createMockTool('no-executor', undefined);
      executor.registerTool(tool);

      const request: ToolExecutionRequest = {
        toolCallId: 'call-1',
        toolName: 'no-executor',
        input: {},
      };

      const result = await executor.execute(request);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('no execute handler');
    });

    it('应该处理工具执行错误', async () => {
      const mockExecute = vi.fn().mockRejectedValue(new Error('Execution failed'));
      const tool = createMockTool('failing-tool', mockExecute);
      executor.registerTool(tool);

      const request: ToolExecutionRequest = {
        toolCallId: 'call-1',
        toolName: 'failing-tool',
        input: { value: 'test' },
      };

      const result = await executor.execute(request);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.attempts).toBeGreaterThan(0);
    });

    it('应该验证输入参数', async () => {
      const mockExecute = vi.fn().mockResolvedValue({ result: 'success' });
      const tool = createMockTool('strict-tool', mockExecute);
      executor.registerTool(tool);

      const request: ToolExecutionRequest = {
        toolCallId: 'call-1',
        toolName: 'strict-tool',
        input: { invalid: 'field' }, // 缺少 value 字段
      };

      const result = await executor.execute(request);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid input');
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('应该记录执行耗时', async () => {
      const mockExecute = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { result: 'success' };
      });
      const tool = createMockTool('slow-tool', mockExecute);
      executor.registerTool(tool);

      const request: ToolExecutionRequest = {
        toolCallId: 'call-1',
        toolName: 'slow-tool',
        input: { value: 'test' },
      };

      const result = await executor.execute(request);

      expect(result.durationMs).toBeGreaterThan(0);
    });
  });

  describe('executeMany', () => {
    it('应该并行执行多个工具调用', async () => {
      const mockExecute1 = vi.fn().mockResolvedValue({ result: 'result1' });
      const mockExecute2 = vi.fn().mockResolvedValue({ result: 'result2' });

      const executor = new ToolExecutor(
        [createMockTool('tool1', mockExecute1), createMockTool('tool2', mockExecute2)],
        { enableParallel: true },
      );

      const requests: ToolExecutionRequest[] = [
        { toolCallId: 'call-1', toolName: 'tool1', input: { value: 'test1' } },
        { toolCallId: 'call-2', toolName: 'tool2', input: { value: 'test2' } },
      ];

      const result = await executor.executeMany(requests);

      expect(result.results).toHaveLength(2);
      expect(result.successCount).toBe(2);
      expect(result.failureCount).toBe(0);
      expect(mockExecute1).toHaveBeenCalled();
      expect(mockExecute2).toHaveBeenCalled();
    });

    it('应该串行执行多个工具调用', async () => {
      const executionOrder: number[] = [];
      const mockExecute1 = vi.fn().mockImplementation(async () => {
        executionOrder.push(1);
        return { result: 'result1' };
      });
      const mockExecute2 = vi.fn().mockImplementation(async () => {
        executionOrder.push(2);
        return { result: 'result2' };
      });

      const executor = new ToolExecutor(
        [createMockTool('tool1', mockExecute1), createMockTool('tool2', mockExecute2)],
        { enableParallel: false },
      );

      const requests: ToolExecutionRequest[] = [
        { toolCallId: 'call-1', toolName: 'tool1', input: { value: 'test1' } },
        { toolCallId: 'call-2', toolName: 'tool2', input: { value: 'test2' } },
      ];

      const result = await executor.executeMany(requests);

      expect(result.results).toHaveLength(2);
      expect(executionOrder).toEqual([1, 2]);
    });

    it('应该控制最大并行数', async () => {
      let currentlyExecuting = 0;
      let maxConcurrent = 0;

      const createTrackedExecutor = () =>
        vi.fn().mockImplementation(async () => {
          currentlyExecuting++;
          maxConcurrent = Math.max(maxConcurrent, currentlyExecuting);
          await new Promise((resolve) => setTimeout(resolve, 50));
          currentlyExecuting--;
          return { result: 'success' };
        });

      const tools = Array.from({ length: 10 }, (_, i) =>
        createMockTool(`tool${i}`, createTrackedExecutor()),
      );

      const executor = new ToolExecutor(tools, {
        enableParallel: true,
        maxParallel: 3,
      });

      const requests = Array.from({ length: 10 }, (_, i) => ({
        toolCallId: `call-${i}`,
        toolName: `tool${i}`,
        input: { value: 'test' },
      }));

      await executor.executeMany(requests);

      expect(maxConcurrent).toBeLessThanOrEqual(3);
    });

    it('应该处理部分失败的情况', async () => {
      const mockExecute1 = vi.fn().mockResolvedValue({ result: 'success' });
      const mockExecute2 = vi.fn().mockRejectedValue(new Error('Failed'));

      const executor = new ToolExecutor([
        createMockTool('success-tool', mockExecute1),
        createMockTool('failing-tool', mockExecute2),
      ]);

      const requests: ToolExecutionRequest[] = [
        { toolCallId: 'call-1', toolName: 'success-tool', input: { value: 'test1' } },
        { toolCallId: 'call-2', toolName: 'failing-tool', input: { value: 'test2' } },
      ];

      const result = await executor.executeMany(requests);

      expect(result.results).toHaveLength(2);
      expect(result.successCount).toBe(1);
      expect(result.failureCount).toBe(1);
    });
  });

  describe('executeFromToolCall', () => {
    it('应该从 ToolCallPart 执行工具', async () => {
      const mockExecute = vi.fn().mockResolvedValue({ result: 'success' });
      const tool = createMockTool('test-tool', mockExecute);
      const executor = new ToolExecutor([tool]);

      const toolCall = {
        id: 'call-1',
        name: 'test-tool',
        input: { value: 'test' },
      };

      const result = await executor.executeFromToolCall(toolCall);

      expect(result.success).toBe(true);
      expect(result.toolCallId).toBe('call-1');
    });
  });

  describe('registerTool / unregisterTool', () => {
    it('应该能注册新工具', () => {
      const executor = new ToolExecutor([]);
      const tool = createMockTool('new-tool');

      executor.registerTool(tool);

      expect(executor.getTool('new-tool')).toBeDefined();
      expect(executor.listTools()).toHaveLength(1);
    });

    it('应该能注销工具', () => {
      const tool = createMockTool('temp-tool');
      const executor = new ToolExecutor([tool]);

      expect(executor.getTool('temp-tool')).toBeDefined();

      executor.unregisterTool('temp-tool');

      expect(executor.getTool('temp-tool')).toBeUndefined();
      expect(executor.listTools()).toHaveLength(0);
    });

    it('应该能覆盖已存在的工具', () => {
      const tool1 = createMockTool('tool', async () => ({ result: 'v1' }));
      const tool2 = createMockTool('tool', async () => ({ result: 'v2' }));

      const executor = new ToolExecutor([tool1]);
      executor.registerTool(tool2);

      expect(executor.listTools()).toHaveLength(1);
    });
  });

  describe('logger integration', () => {
    it('应该记录成功的工具调用', async () => {
      const mockExecute = vi.fn().mockResolvedValue({ result: 'success' });
      const tool = createMockTool('logged-tool', mockExecute);

      const executor = new ToolExecutor([tool], {
        loggerConfig: { enabled: true },
      });

      const request: ToolExecutionRequest = {
        toolCallId: 'call-1',
        toolName: 'logged-tool',
        input: { value: 'test' },
      };

      await executor.execute(request);

      const logger = executor.getLogger();
      const entries = logger.getEntriesForCall('call-1');

      expect(entries.length).toBeGreaterThan(0);
      expect(entries.some((e) => e.phase === 'completed')).toBe(true);
    });

    it('应该记录失败的工具调用', async () => {
      const mockExecute = vi.fn().mockRejectedValue(new Error('Test error'));
      const tool = createMockTool('failing-tool', mockExecute);

      const executor = new ToolExecutor([tool], {
        loggerConfig: { enabled: true },
        retryConfig: { maxRetries: 0 }, // 禁用重试以便快速测试
      });

      const request: ToolExecutionRequest = {
        toolCallId: 'call-1',
        toolName: 'failing-tool',
        input: { value: 'test' },
      };

      await executor.execute(request);

      const logger = executor.getLogger();
      const entries = logger.getEntriesForCall('call-1');

      expect(entries.some((e) => e.phase === 'failed')).toBe(true);
    });

    it('应该提供工具统计信息', async () => {
      const mockExecute = vi.fn().mockResolvedValue({ result: 'success' });
      const tool = createMockTool('stat-tool', mockExecute);

      const executor = new ToolExecutor([tool], {
        loggerConfig: { enabled: true, enableStats: true },
      });

      // 执行多次调用
      for (let i = 0; i < 3; i++) {
        await executor.execute({
          toolCallId: `call-${i}`,
          toolName: 'stat-tool',
          input: { value: 'test' },
        });
      }

      const stats = executor.getStats();
      const toolStats = stats.find((s) => s.toolName === 'stat-tool');

      expect(toolStats).toBeDefined();
      expect(toolStats?.totalCalls).toBe(3);
      expect(toolStats?.successCount).toBe(3);
    });
  });

  describe('createToolExecutor', () => {
    it('应该创建默认配置的执行器', () => {
      const tools = [createMockTool('tool1')];
      const executor = createToolExecutor(tools);

      expect(executor).toBeInstanceOf(ToolExecutor);
      expect(executor.listTools()).toHaveLength(1);
    });

    it('应该接受自定义配置', () => {
      const tools = [createMockTool('tool1')];
      const executor = createToolExecutor(tools, {
        defaultTimeoutMs: 10000,
        enableParallel: false,
      });

      expect(executor).toBeInstanceOf(ToolExecutor);
    });
  });
});
