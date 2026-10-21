/**
 * 工具 JSON Schema 契约单元测试（对齐上游 packages/ai@v2.0.28）
 *
 * 覆盖 T-09：Effect 对「无参数 struct」会产出 `{ not: { type: "null" } }`，
 * 但上游要求工具的 `parameters` 必须描述一个对象，因此输入 schema 需要
 * 归一化为空对象；带参数 / 带其他关键字 / 原始 JSON Schema 一律不改写。
 */

import { describe, it, expect } from 'vitest';
import { Effect, Schema } from 'effect';
import { Tool, toDefinitions } from '../tool.js';

const EMPTY_OBJECT_SCHEMA = { type: 'object', properties: {}, additionalProperties: false };
/** Effect 对空的已编码 struct 产出的原始形状。 */
const RAW_EMPTY_SCHEMA = { not: { type: 'null' } };

const noArgs = Tool.make({
  description: '无参数工具',
  parameters: Schema.Struct({}),
  success: Schema.Struct({}),
  execute: () => Effect.succeed({}),
});

const withArgs = Tool.make({
  description: '带参数工具',
  parameters: Schema.Struct({ path: Schema.String }),
  success: Schema.Struct({ ok: Schema.Boolean }),
  execute: () => Effect.succeed({ ok: true }),
});

const annotatedEmpty = Tool.make({
  description: '带注解的无参数工具',
  parameters: Schema.Struct({}).annotate({ description: '没有输入' }),
  success: Schema.Struct({}),
  execute: () => Effect.succeed({}),
});

const checkedEmpty = Tool.make({
  description: '带 check 的无参数工具',
  parameters: Schema.Struct({}).check(Schema.isMinProperties(1)),
  success: Schema.Struct({}),
  execute: () => Effect.succeed({}),
});

const raw = Tool.make({
  description: '原始 JSON Schema 工具',
  jsonSchema: RAW_EMPTY_SCHEMA,
  execute: () => Effect.succeed({}),
});

describe('emptyInputJsonSchema（经 Tool.make 暴露）', () => {
  it('无参数 typed 工具的输入描述为空对象', () => {
    const [definition] = toDefinitions({ noArgs });
    expect(definition?.inputSchema).toEqual(EMPTY_OBJECT_SCHEMA);
  });

  it('保留无参数 struct 上的注解', () => {
    const [definition] = toDefinitions({ annotatedEmpty });
    expect(definition?.inputSchema).toEqual({ description: '没有输入', ...EMPTY_OBJECT_SCHEMA });
  });

  it('带参数的工具不做改写', () => {
    const [definition] = toDefinitions({ withArgs });
    const inputSchema = definition?.inputSchema as Record<string, unknown>;
    expect(inputSchema.not).toBeUndefined();
    expect(inputSchema.type).toBe('object');
    expect(Object.keys((inputSchema.properties ?? {}) as Record<string, unknown>)).toContain(
      'path',
    );
  });

  it('出现非注解关键字（check）时保持 Effect 原样产出', () => {
    const [definition] = toDefinitions({ checkedEmpty });
    expect((definition?.inputSchema as Record<string, unknown>).not).toEqual({ type: 'null' });
  });

  it('原始 JSON Schema 工具原样保留', () => {
    const [definition] = toDefinitions({ raw });
    expect(definition?.inputSchema).toEqual(RAW_EMPTY_SCHEMA);
  });

  it('输出 schema 不受输入归一化影响', () => {
    const [definition] = toDefinitions({ noArgs });
    expect(definition?.outputSchema).toEqual(RAW_EMPTY_SCHEMA);
  });

  it('toDefinitions 使用记录键作为工具名', () => {
    const definitions = toDefinitions({ noArgs, withArgs });
    expect(definitions.map((item) => item.name)).toEqual(['noArgs', 'withArgs']);
  });
});
