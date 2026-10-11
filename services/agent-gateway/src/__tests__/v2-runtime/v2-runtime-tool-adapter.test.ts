import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ToolDefinition } from '@openAwork/agent-core';
import { wrapToolForNative, wrapToolsForNative } from '../../v2-runtime/upstream/index.js';

const echoTool: ToolDefinition = {
  name: 'echo',
  description: 'Return the input string unchanged.',
  inputSchema: z.object({ value: z.string() }),
  outputSchema: z.object({ echoed: z.string() }),
  execute: async (input) => ({ echoed: (input as { value: string }).value }),
};

const addTool: ToolDefinition = {
  name: 'add',
  description: 'Sum two numbers.',
  inputSchema: z.object({ a: z.number(), b: z.number() }),
  outputSchema: z.object({ sum: z.number() }),
  execute: async (input) => {
    const { a, b } = input as { a: number; b: number };
    return { sum: a + b };
  },
};

describe('wrapToolForNative', () => {
  it('converts the tool declaration to a native JSON schema', () => {
    const wrapped = wrapToolForNative(echoTool);
    expect(wrapped.name).toBe('echo');
    expect(wrapped.description).toBe('Return the input string unchanged.');
    expect(wrapped.inputSchema).toMatchObject({
      type: 'object',
      required: ['value'],
    });
  });

  /**
   * 回归：zod v3 下 `.refine()/.superRefine()/.transform()` 会把 schema 包成
   * `ZodEffects`。转换器缺该分支时命中 `default: { type: 'string' }`，
   * 发给模型的工具 schema 退化成字符串——模型看不到任何参数名，
   * 于是出现「只传分页参数不传 toolCallId」「把 sessionID 当 task_id」。
   */
  it('解包 ZodEffects，保留被包裹对象的全部参数名', () => {
    const refinedTool: ToolDefinition = {
      name: 'refined',
      description: 'Cross-field validated tool.',
      inputSchema: z
        .object({ page: z.number().optional(), size: z.number().optional() })
        .strict()
        .superRefine((value, ctx) => {
          if (value.page === undefined && value.size === undefined) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: '至少传一个' });
          }
        }),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async () => ({ ok: true }),
    };

    const schema = wrapToolForNative(refinedTool).inputSchema as {
      type?: string;
      properties?: Record<string, unknown>;
    };

    expect(schema.type).toBe('object');
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual(['page', 'size']);
  });

  it('解包 ZodEffects 中的 ZodDefault，字段类型不被误判为 string', () => {
    const defaultedTool: ToolDefinition = {
      name: 'defaulted',
      description: 'Tool with defaulted numeric field.',
      inputSchema: z
        .object({
          name: z.string(),
          timeout: z.number().int().min(1).max(120).default(20),
        })
        .transform((value) => value),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async () => ({ ok: true }),
    };

    const schema = wrapToolForNative(defaultedTool).inputSchema as {
      required?: string[];
      properties?: Record<string, { type?: string }>;
    };

    // `.default()` 字段不应进 required，且类型应保持 number。
    expect(schema.required).toEqual(['name']);
    expect(schema.properties?.['timeout']?.type).toBe('number');
  });

  it('ZodRecord / ZodTuple / ZodAny / ZodDiscriminatedUnion 均有对应结构而非 string', () => {
    const richTool: ToolDefinition = {
      name: 'rich',
      description: 'Rich schema tool.',
      inputSchema: z.object({
        tags: z.record(z.string()),
        pair: z.tuple([z.string(), z.number()]),
        free: z.any(),
        mode: z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('a'), x: z.number() }),
          z.object({ kind: z.literal('b'), y: z.string() }),
        ]),
      }),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async () => ({ ok: true }),
    };

    const schema = wrapToolForNative(richTool).inputSchema as {
      properties?: Record<
        string,
        { type?: string; additionalProperties?: unknown; prefixItems?: unknown; anyOf?: unknown }
      >;
    };

    expect(schema.properties?.['tags']?.type).toBe('object');
    expect(schema.properties?.['tags']?.additionalProperties).toBeDefined();
    expect(schema.properties?.['pair']?.type).toBe('array');
    expect(Array.isArray(schema.properties?.['pair']?.prefixItems)).toBe(true);
    // z.any() → 无约束的空 schema（键全缺），不应误判成 string。
    expect(schema.properties?.['free']).toEqual({});
    const mode = schema.properties?.['mode'];
    expect(Array.isArray(mode?.anyOf)).toBe(true);
    expect((mode?.anyOf as unknown[] | undefined)?.length).toBe(2);
  });
});

describe('wrapToolsForNative', () => {
  it('builds a native tool set keyed by tool name', () => {
    const set = wrapToolsForNative([echoTool, addTool]);
    expect(Object.keys(set)).toEqual(['echo', 'add']);
    expect(set['echo']?.name).toBe('echo');
    expect(set['add']?.name).toBe('add');
  });

  it('uses last-write-wins on duplicate names', () => {
    const replacement: ToolDefinition = {
      ...echoTool,
      description: 'overridden',
      execute: async () => ({ echoed: 'replaced' }),
    };
    const set = wrapToolsForNative([echoTool, replacement]);
    expect(set['echo']?.description).toBe('overridden');
  });
});
