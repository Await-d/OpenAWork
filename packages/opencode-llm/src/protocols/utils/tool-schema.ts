import type { JsonSchema, LLMRequest } from '../../schema/index.js';
import { ToolDefinition } from '../../schema/index.js';
import { isRecord } from '../../utils/record.js';
import { GeminiToolSchema } from './gemini-tool-schema.js';

const removeNullSchemas = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(removeNullSchemas);
  if (!isRecord(value)) return value;
  const fields = Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'anyOf')
      .map(([key, field]) => [key, removeNullSchemas(field)]),
  );
  if (!Array.isArray(value.anyOf)) return fields;
  const variants = value.anyOf
    .filter((variant) => !isRecord(variant) || variant.type !== 'null')
    .map(removeNullSchemas);
  if (variants.length === 1 && isRecord(variants[0])) return { ...fields, ...variants[0] };
  return { ...fields, anyOf: variants };
};

const tupleItemsSchema = (items: ReadonlyArray<unknown>) => {
  const projected = items.map(moonshotNode);
  if (projected.length === 0) return {};
  if (projected.length === 1) return projected[0];
  return { anyOf: projected };
};

const moonshotNode = (schema: unknown): unknown => {
  if (Array.isArray(schema)) return schema.map(moonshotNode);
  if (!isRecord(schema)) return schema;
  if (typeof schema.$ref === 'string') return { $ref: schema.$ref };
  return Object.fromEntries(
    Object.entries(schema).flatMap(([key, value]) => {
      if (key === 'items' && Array.isArray(value)) return [[key, tupleItemsSchema(value)]];
      if (key === 'prefixItems') {
        if ('items' in schema) return [];
        return [['items', tupleItemsSchema(Array.isArray(value) ? value : [])]];
      }
      if (key === 'unevaluatedItems') return [];
      return [[key, moonshotNode(value)]];
    }),
  );
};

const moonshot = (schema: JsonSchema): JsonSchema => {
  const projected = moonshotNode(schema);
  return isRecord(projected) ? projected : {};
};

const openAI = (schema: JsonSchema): JsonSchema => {
  const variants = Array.isArray(schema.anyOf) ? schema.anyOf.filter(isRecord) : [];
  const flattened =
    variants.length === 0
      ? { ...schema, type: 'object' }
      : {
          ...Object.fromEntries(Object.entries(schema).filter(([key]) => key !== 'anyOf')),
          type: 'object',
          properties: variants.reduce(
            (properties, variant) => ({
              ...(isRecord(variant.properties) ? variant.properties : {}),
              ...properties,
            }),
            {},
          ),
          additionalProperties: false,
        };
  const normalized = removeNullSchemas(flattened);
  return isRecord(normalized) ? normalized : { type: 'object' };
};

const gemini = (schema: JsonSchema): JsonSchema => GeminiToolSchema.convert(schema) ?? {};

// 工具入参永远是 JSON object，多数上游会拒绝根节点未声明 `type: "object"` 的 schema
// （`{}`、裸 `properties`）。有了对象根之后，Effect 的空结构体标记
// `{ not: { type: "null" } }` 与旧版本留下的 `anyOf` 都成了冗余，一并丢弃，
// 让根节点是一个干净的 object schema。
const objectRoot = (schema: JsonSchema): JsonSchema => {
  if (
    (schema.type === undefined || schema.type === 'object') &&
    isRecord(schema.not) &&
    schema.not.type === 'null' &&
    Object.keys(schema.not).length === 1
  )
    return {
      type: 'object',
      ...Object.fromEntries(Object.entries(schema).filter(([key]) => key !== 'not')),
    };
  if (schema.type !== undefined) return schema;
  if (
    Array.isArray(schema.anyOf) &&
    schema.anyOf.some(
      (branch) => isRecord(branch) && branch.type === 'object' && Object.keys(branch).length === 1,
    )
  )
    return {
      type: 'object',
      ...Object.fromEntries(Object.entries(schema).filter(([key]) => key !== 'anyOf')),
    };
  return { type: 'object', ...schema };
};

// 模型名 → 工具 schema 规则族的启发式（对齐上游 `MODEL_NAMES`）。经网关或
// OpenAI 兼容端点访问的模型，与直连该家族时得到同样的处理。
const MODEL_NAMES = [
  [/gemini/i, 'gemini'],
  [/kimi/i, 'moonshot'],
] as const;

/**
 * 单个工具入参的投影：先落地对象根，再按规则族转换。
 *
 * 规则来源优先级（对齐上游）：显式 `compatibility.toolSchema` > 路由声明的
 * `sanitizer` > 模型名启发式。本地额外保留 `ModelToolSchemaCompatibility` 的
 * 两参调用形态给既有协议使用，故这里收窄为按模型解析。
 */
const modelCompatibility = (schema: JsonSchema, model: LLMRequest['model']): JsonSchema => {
  const root = objectRoot(schema);
  switch (
    model.compatibility?.toolSchema ??
    model.route.sanitizer ??
    MODEL_NAMES.find(([name]) => name.test(model.id))?.[1]
  ) {
    case 'gemini':
      return gemini(root);
    case 'moonshot':
      return moonshot(root);
    case undefined:
      return root;
  }
};

/**
 * 请求级工具投影（对齐上游 `ToolSchemaProjection.tools`）：在协议构造 body
 * **之前**统一应用一次，避免同一份 schema 被逐协议重复转换。
 */
export const tools = (
  entries: ReadonlyArray<ToolDefinition>,
  model: LLMRequest['model'],
): ReadonlyArray<ToolDefinition> =>
  entries.map((tool) =>
    ToolDefinition.make({ ...tool, inputSchema: modelCompatibility(tool.inputSchema, model) }),
  );

export const ToolSchemaProjection = {
  gemini,
  moonshot,
  openAI,
  modelCompatibility,
  tools,
} as const;
