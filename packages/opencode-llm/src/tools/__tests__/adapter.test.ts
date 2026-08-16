/**
 * 工具适配器单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { ToolAdapter } from '../adapter.js';
import type { OpenAWorkToolDefinition } from '../adapter.js';

describe('ToolAdapter', () => {
  let adapter: ToolAdapter;

  beforeEach(() => {
    adapter = new ToolAdapter();
  });

  describe('adapt', () => {
    it('应该转换基本工具定义', () => {
      const mockTool: OpenAWorkToolDefinition = {
        name: 'test_tool',
        description: 'Test tool description',
        inputSchema: z.object({
          message: z.string(),
        }),
        outputSchema: z.object({
          result: z.string(),
        }),
      };

      const result = adapter.adapt(mockTool);

      expect(result.name).toBe('test_tool');
      expect(result.description).toBe('Test tool description');
      expect(result.inputSchema).toBeDefined();
      expect(result.outputSchema).toBeDefined();
    });

    it('应该支持工具名称前缀', () => {
      const adapterWithPrefix = new ToolAdapter({ namePrefix: 'custom_' });

      const mockTool: OpenAWorkToolDefinition = {
        name: 'tool',
        description: 'Test',
        inputSchema: z.object({}),
        outputSchema: z.object({}),
      };

      const result = adapterWithPrefix.adapt(mockTool);

      expect(result.name).toBe('custom_tool');
    });

    it('应该处理空参数的工具', () => {
      const mockTool: OpenAWorkToolDefinition = {
        name: 'no_params',
        description: 'Tool without parameters',
        inputSchema: z.object({}),
        outputSchema: z.object({}),
      };

      const result = adapter.adapt(mockTool);

      expect(result.name).toBe('no_params');
      expect(result.inputSchema.type).toBe('object');
    });

    it('应该处理复杂的 Zod schema', () => {
      const mockTool: OpenAWorkToolDefinition = {
        name: 'complex_tool',
        description: 'Tool with complex schema',
        inputSchema: z.object({
          name: z.string(),
          age: z.number(),
          active: z.boolean(),
          tags: z.array(z.string()),
        }),
        outputSchema: z.object({
          success: z.boolean(),
        }),
      };

      const result = adapter.adapt(mockTool);

      expect(result.name).toBe('complex_tool');
      expect(result.inputSchema.type).toBe('object');
      expect(result.inputSchema.properties).toBeDefined();
    });

    it('应该处理可选字段', () => {
      const mockTool: OpenAWorkToolDefinition = {
        name: 'optional_tool',
        description: 'Tool with optional fields',
        inputSchema: z.object({
          required: z.string(),
          optional: z.string().optional(),
        }),
      };

      const result = adapter.adapt(mockTool);

      expect(result.inputSchema.type).toBe('object');
    });
  });

  describe('adaptMany', () => {
    it('应该批量转换工具定义', () => {
      const tools: OpenAWorkToolDefinition[] = [
        {
          name: 'tool1',
          description: 'First tool',
          inputSchema: z.object({ value: z.string() }),
          outputSchema: z.object({ result: z.string() }),
        },
        {
          name: 'tool2',
          description: 'Second tool',
          inputSchema: z.object({ count: z.number() }),
          outputSchema: z.object({ total: z.number() }),
        },
      ];

      const results = adapter.adaptMany(tools);

      expect(results).toHaveLength(2);
      expect(results[0]?.name).toBe('tool1');
      expect(results[1]?.name).toBe('tool2');
    });

    it('应该处理空数组', () => {
      const results = adapter.adaptMany([]);

      expect(results).toEqual([]);
    });
  });

  describe('adaptToRecord', () => {
    it('应该转换为 Record 格式', () => {
      const tools: OpenAWorkToolDefinition[] = [
        {
          name: 'tool1',
          description: 'First tool',
          inputSchema: z.object({ value: z.string() }),
          outputSchema: z.object({ result: z.string() }),
        },
        {
          name: 'tool2',
          description: 'Second tool',
          inputSchema: z.object({ count: z.number() }),
          outputSchema: z.object({ total: z.number() }),
        },
      ];

      const result = adapter.adaptToRecord(tools);

      expect(Object.keys(result)).toEqual(['tool1', 'tool2']);
      expect(result.tool1?.name).toBe('tool1');
      expect(result.tool2?.name).toBe('tool2');
    });
  });

  describe('strictMode', () => {
    it('应该在严格模式下添加 additionalProperties: false', () => {
      const strictAdapter = new ToolAdapter({ strictMode: true });

      const mockTool: OpenAWorkToolDefinition = {
        name: 'strict_tool',
        description: 'Strict mode tool',
        inputSchema: z.object({
          field: z.string(),
        }),
        outputSchema: z.object({
          result: z.string(),
        }),
      };

      const result = strictAdapter.adapt(mockTool);

      expect(result.inputSchema.additionalProperties).toBe(false);
    });
  });
});
