/**
 * 工具 schema 对象根与请求级投影契约测试（对齐上游 packages/ai@v2.0.28）
 *
 * 覆盖 T-13/T-19：`modelCompatibility` 改为按模型解析规则族（compatibility >
 * 路由 sanitizer > 模型名启发式），并新增请求级 `tools()` 单次投影入口。
 */

import { describe, it, expect } from 'vitest';
import * as AnthropicMessages from '../anthropic-messages.js';
import * as Gemini from '../gemini.js';
import { ToolSchemaProjection } from '../utils/tool-schema.js';
import { Model, type JsonSchema, type ModelCompatibility } from '../../schema/index.js';

const model = (
  id: string,
  route: AnthropicMessages.Route | Gemini.Route = AnthropicMessages.route,
  compatibility?: Partial<ModelCompatibility>,
) => Model.make({ id, provider: 'test', route, compatibility });

const project = (schema: JsonSchema, target = model('claude-opus-5-1')) =>
  ToolSchemaProjection.modelCompatibility(schema, target);

describe('modelCompatibility 的对象根', () => {
  it('丢弃 Effect 的空结构体标记', () => {
    expect(project({ not: { type: 'null' } })).toEqual({ type: 'object' });
  });

  it('裸 properties 补上 type: object', () => {
    expect(project({ properties: { a: { type: 'string' } } })).toEqual({
      type: 'object',
      properties: { a: { type: 'string' } },
    });
  });

  it('丢弃只含对象分支的冗余 anyOf', () => {
    expect(project({ anyOf: [{ type: 'object' }], properties: { a: { type: 'string' } } })).toEqual(
      {
        type: 'object',
        properties: { a: { type: 'string' } },
      },
    );
  });

  it('已声明 type 的 schema 原样返回', () => {
    const schema = { type: 'string' } as JsonSchema;

    expect(project(schema)).toBe(schema);
  });
});

describe('规则族解析优先级', () => {
  // Gemini 规则会丢弃 `additionalProperties`（Gemini 不支持该关键字），用它作为
  // 「Gemini 规则确实生效」的可观测标记；对象根则保证 `not` 标记一定消失。
  const fixture = {
    not: { type: 'null' as const },
    properties: { a: { type: 'string' as const } },
    additionalProperties: false as const,
  };

  it('无规则命中时只落地对象根', () => {
    const projected = project(fixture);

    expect(projected).not.toHaveProperty('not');
    expect(projected.type).toBe('object');
    expect(projected).toHaveProperty('additionalProperties', false);
  });

  it('模型名命中 gemini 时按 Gemini 规则转换', () => {
    const projected = project(fixture, model('gemini-2.5-pro'));

    expect(projected).not.toHaveProperty('not');
    expect(projected).not.toHaveProperty('additionalProperties');
    expect(projected.properties).toHaveProperty('a');
  });

  it('模型名命中 kimi 时按 Moonshot 规则转换', () => {
    const projected = project(fixture, model('kimi-k2'));

    // Moonshot 规则保留 type/properties，只做元数据清理。
    expect(projected).not.toHaveProperty('not');
    expect(projected.type).toBe('object');
    expect(projected.properties).toHaveProperty('a');
  });

  it('compatibility.toolSchema 优先于模型名启发式', () => {
    // kimi 命中 moonshot 启发式，但显式 compatibility 指定 gemini → 走 Gemini 规则。
    const projected = project(
      fixture,
      model('kimi-k2', AnthropicMessages.route, { toolSchema: 'gemini' }),
    );

    expect(projected).not.toHaveProperty('additionalProperties');
  });

  it('路由 sanitizer 优先于模型名启发式', () => {
    // Gemini 路由声明了 sanitizer: 'gemini'；用一个不含 gemini 的 id 验证路由生效。
    const projected = project(fixture, model('custom-deploy', Gemini.route));

    expect(projected).not.toHaveProperty('additionalProperties');
  });
});

describe('请求级 tools() 投影', () => {
  const tool = {
    name: 'read_file',
    description: '读取文件',
    inputSchema: { not: { type: 'null' } },
  };

  it('对每个工具的入参应用一次对象根', () => {
    const [projected, ...rest] = ToolSchemaProjection.tools([tool], model('claude-opus-5-1'));

    expect(rest).toHaveLength(0);
    expect(projected?.inputSchema).toEqual({ type: 'object' });
  });

  it('保留工具的身份与描述字段', () => {
    const [projected] = ToolSchemaProjection.tools([tool], model('claude-opus-5-1'));

    expect(projected?.name).toBe('read_file');
    expect(projected?.description).toBe('读取文件');
  });

  it('空工具列表原样返回', () => {
    expect(ToolSchemaProjection.tools([], model('claude-opus-5-1'))).toEqual([]);
  });
});
