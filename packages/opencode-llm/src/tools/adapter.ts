/**
 * 工具适配器模块
 *
 * 负责将 OpenAWork 工具定义转换为 OpenCode LLM 兼容的格式
 */

import { Schema } from 'effect';
import type { ZodTypeAny } from 'zod';
import { ToolDefinition as OpenCodeToolDefinition } from '../schema/index.js';
import type { JsonSchema } from '../schema/ids.js';

/**
 * OpenAWork 工具定义（来自 agent-core）
 *
 * 兼容 agent-core 的 ToolDefinition 接口
 */
export interface OpenAWorkToolDefinition {
  name: string;
  description: string;
  inputSchema: ZodTypeAny;
  outputSchema?: ZodTypeAny;
  execute?: (input: unknown, signal: AbortSignal) => Promise<unknown>;
  timeout?: number;
}

/**
 * Zod Schema 到 JSON Schema 的转换选项
 */
export interface ZodToJsonSchemaOptions {
  /** 是否生成严格模式的 JSON Schema */
  strict?: boolean;
  /** 是否包含 additionalProperties: false */
  additionalProperties?: boolean;
}

/**
 * 工具适配器配置
 */
export interface ToolAdapterConfig {
  /** 是否启用严格模式（OpenAI strict tools） */
  strictMode?: boolean;
  /** 工具名称前缀 */
  namePrefix?: string;
  /** 是否记录转换日志 */
  enableLogging?: boolean;
}

/**
 * 工具适配器类
 *
 * 转换 OpenAWork 工具定义到 OpenCode LLM 格式
 */
export class ToolAdapter {
  private readonly config: Required<ToolAdapterConfig>;

  constructor(config: ToolAdapterConfig = {}) {
    this.config = {
      strictMode: config.strictMode ?? false,
      namePrefix: config.namePrefix ?? '',
      enableLogging: config.enableLogging ?? false,
    };
  }

  /**
   * 转换单个工具定义
   */
  adapt(tool: OpenAWorkToolDefinition): OpenCodeToolDefinition {
    const name = this.config.namePrefix + tool.name;

    // 从 Zod schema 提取 JSON Schema
    const inputSchema = this.extractJsonSchema(tool.inputSchema);
    const outputSchema = tool.outputSchema ? this.extractJsonSchema(tool.outputSchema) : undefined;

    if (this.config.enableLogging) {
      this.log('adapt', { name, hasExecute: !!tool.execute });
    }

    return new OpenCodeToolDefinition({
      name,
      description: tool.description,
      inputSchema,
      outputSchema,
    });
  }

  /**
   * 批量转换工具定义
   */
  adaptMany(tools: OpenAWorkToolDefinition[]): OpenCodeToolDefinition[] {
    return tools.map((tool) => this.adapt(tool));
  }

  /**
   * 转换工具定义为 Record 格式（用于 OpenCode LLM 的 tools 参数）
   */
  adaptToRecord(tools: OpenAWorkToolDefinition[]): Record<string, OpenCodeToolDefinition> {
    const result: Record<string, OpenCodeToolDefinition> = {};

    for (const tool of tools) {
      const adapted = this.adapt(tool);
      result[adapted.name] = adapted;
    }

    return result;
  }

  /**
   * 从 Zod schema 中提取 JSON Schema
   */
  private extractJsonSchema(zodSchema: ZodTypeAny): JsonSchema {
    // 尝试用空对象测试 schema
    const emptyTest = zodSchema.safeParse({});

    // 如果空对象通过，说明是可选参数或无参数
    if (emptyTest.success) {
      return {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: this.config.strictMode ? false : true,
      };
    }

    // 尝试推断 schema 结构
    // 这里使用反射技术获取 Zod schema 的内部结构
    const schema = this.inferSchemaFromZod(zodSchema);

    return this.config.strictMode && schema.type === 'object'
      ? { ...schema, additionalProperties: false }
      : schema;
  }

  /**
   * 从 Zod schema 推断 JSON Schema
   *
   * 注意：这是一个简化实现，实际生产环境应使用 zod-to-json-schema 库
   */
  private inferSchemaFromZod(zodSchema: unknown): JsonSchema {
    // 基本实现：返回一个通用的 object schema
    // 实际项目中应该使用 zod-to-json-schema 或类似库

    const schema: Record<string, unknown> = {
      type: 'object',
      properties: {},
      additionalProperties: !this.config.strictMode,
    };

    // 尝试从 Zod schema 中提取信息
    // 由于 Zod 的内部结构复杂，这里只做基本处理
    if (zodSchema && typeof zodSchema === 'object') {
      const zodObj = zodSchema as Record<string, unknown>;

      // 检查是否有 _def 属性（Zod 内部结构）
      if ('_def' in zodObj && zodObj._def && typeof zodObj._def === 'object') {
        const def = zodObj._def as Record<string, unknown>;

        // 处理 ZodObject 类型
        if (def.typeName === 'ZodObject' && 'shape' in def) {
          const shape = def.shape as Record<string, unknown>;
          const properties: Record<string, JsonSchema> = {};
          const required: string[] = [];

          for (const [key, value] of Object.entries(shape)) {
            properties[key] = this.zodTypeToJsonSchema(value);

            // 检查是否必需
            if (value && typeof value === 'object' && '_def' in value) {
              const fieldDef = (value as Record<string, unknown>)._def as Record<string, unknown>;
              if (fieldDef.typeName !== 'ZodOptional') {
                required.push(key);
              }
            }
          }

          schema.properties = properties;
          if (required.length > 0) {
            schema.required = required;
          }
        }
      }
    }

    return schema;
  }

  /**
   * 将 Zod 类型转换为 JSON Schema
   */
  private zodTypeToJsonSchema(zodType: unknown): JsonSchema {
    if (!zodType || typeof zodType !== 'object') {
      return { type: 'string' };
    }

    const zodObj = zodType as Record<string, unknown>;
    if (!('_def' in zodObj) || !zodObj._def || typeof zodObj._def !== 'object') {
      return { type: 'string' };
    }

    const def = zodObj._def as Record<string, unknown>;
    const typeName = def.typeName as string;

    switch (typeName) {
      case 'ZodString':
        return { type: 'string' };
      case 'ZodNumber':
        return { type: 'number' };
      case 'ZodBoolean':
        return { type: 'boolean' };
      case 'ZodArray': {
        const innerType =
          'type' in def && def.type ? this.zodTypeToJsonSchema(def.type) : { type: 'string' };
        return { type: 'array', items: innerType };
      }
      case 'ZodObject':
        return this.inferSchemaFromZod(zodType);
      case 'ZodOptional': {
        const innerType =
          'innerType' in def && def.innerType
            ? this.zodTypeToJsonSchema(def.innerType)
            : { type: 'string' };
        return innerType;
      }
      case 'ZodEnum': {
        const values = 'values' in def && Array.isArray(def.values) ? def.values : [];
        return { type: 'string', enum: values };
      }
      case 'ZodLiteral': {
        const value = 'value' in def ? def.value : undefined;
        return { type: typeof value === 'string' ? 'string' : 'number', const: value };
      }
      case 'ZodUnion': {
        const options =
          'options' in def && Array.isArray(def.options)
            ? def.options.map((opt) => this.zodTypeToJsonSchema(opt))
            : [];
        return { anyOf: options };
      }
      default:
        return { type: 'string' };
    }
  }

  /**
   * 记录日志
   */
  private log(action: string, data: unknown): void {
    if (this.config.enableLogging) {
      console.log(`[ToolAdapter:${action}]`, data);
    }
  }
}

/**
 * 创建默认的工具适配器实例
 */
export function createToolAdapter(config?: ToolAdapterConfig): ToolAdapter {
  return new ToolAdapter(config);
}
