/**
 * Tool adapter — translate OpenAWork's `ToolDefinition[]` (the
 * canonical tool registry every agent ships with) into OpenCode LLM's
 * tool shape so the LLM client can drive execution directly.
 *
 * Why this layer exists:
 *   - opencode hands its tool registry straight to OpenCode LLM and lets
 *     the client orchestrate the call/result loop. This adapter
 *     keeps the OpenAWork-side `ToolDefinition` contract intact while
 *     exposing it through OpenCode LLM's tool surface.
 *   - The adapter is intentionally minimal — Phase C.2 scope ends at
 *     the basic call/execute mapping. Permission gating, durable
 *     closures, file diff capture, child-session task tools, and
 *     other ToolSandbox machinery remain wired through the legacy
 *     stream-model-round path until Phase B unifies them.
 *
 * Limitations (deferred to Phase B / follow-up Phase C):
 *   - No permission/UI prompt integration. Tools that require user
 *     approval must either reject inside `execute()` or stay routed
 *     through `tool-sandbox.ts`.
 *   - No tool-result middleware (e.g. file-diff capture) — OpenCode LLM's
 *     `execute()` returns a single value; OpenAWork's richer
 *     `ToolCallResult` (durationMs, pendingPermissionRequestId, etc.)
 *     is dropped here.
 *   - Validation: the adapter trusts `ToolDefinition.inputSchema` to
 *     validate. OpenCode LLM uses the same schema, so duplicate
 *     validation is avoided.
 */

import type { ToolDefinition } from '@openAwork/agent-core';
import * as OpenCodeLLM from '@openAwork/opencode-llm';

type NativeTool = OpenCodeLLM.ToolDefinition;
type NativeToolSet = Record<string, NativeTool>;

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const zodTypeName = (value: unknown): string | undefined => {
  if (!isRecord(value) || !isRecord(value['_def'])) return undefined;
  const name = value['_def']['typeName'];
  return typeof name === 'string' ? name : undefined;
};

const zodToJsonSchema = (value: unknown): OpenCodeLLM.JsonSchema => {
  const definition = isRecord(value) && isRecord(value['_def']) ? value['_def'] : undefined;
  switch (zodTypeName(value)) {
    // zod v3 下 `.refine()/.superRefine()/.transform()` 会把 schema 包成
    // ZodEffects。缺这个分支时，`read_tool_output`、`background_output`、
    // `background_cancel` 等所有带跨字段校验的 schema 都会落到 default 分支
    // 变成 `{"type":"string"}`，模型因此完全看不到参数名——只能靠描述猜，
    // 于是频繁出现「只传分页参数不传 toolCallId」「把 sessionID 当 task_id」
    // 这类调用。effects 只做校验/变换，不改变 JSON Schema 的结构描述，
    // 因此直接解包到内层 schema。
    case 'ZodEffects':
      return zodToJsonSchema(definition?.['schema']);
    // 同理：`.default()` / `.optional()` / `.nullable()` 只包裹内层类型，
    // JSON Schema 层面描述的是内层类型本身。
    case 'ZodDefault':
    case 'ZodOptional':
    case 'ZodNullable':
      return zodToJsonSchema(definition?.['innerType']);
    case 'ZodObject': {
      const shapeValue = definition?.['shape'];
      const shape = typeof shapeValue === 'function' ? shapeValue() : shapeValue;
      const properties: Record<string, OpenCodeLLM.JsonSchema> = {};
      const required: string[] = [];
      if (isRecord(shape)) {
        for (const [key, field] of Object.entries(shape)) {
          properties[key] = zodToJsonSchema(field);
          // `.default()` / `.optional()` 包裹的字段同样不算必填。
          const fieldType = zodTypeName(field);
          if (fieldType !== 'ZodOptional' && fieldType !== 'ZodDefault') required.push(key);
        }
      }
      return {
        type: 'object',
        properties,
        ...(required.length === 0 ? {} : { required }),
      };
    }
    case 'ZodArray':
      return {
        type: 'array',
        items: zodToJsonSchema(definition?.['type']),
      };
    case 'ZodBoolean':
      return { type: 'boolean' };
    case 'ZodNumber':
      return { type: 'number' };
    case 'ZodEnum': {
      const values = definition?.['values'];
      return { type: 'string', ...(Array.isArray(values) ? { enum: values } : {}) };
    }
    case 'ZodLiteral': {
      const literal = definition?.['value'];
      return {
        type:
          typeof literal === 'string'
            ? 'string'
            : typeof literal === 'boolean'
              ? 'boolean'
              : 'number',
        const: literal,
      };
    }
    case 'ZodUnion': {
      const options = definition?.['options'];
      return {
        anyOf: Array.isArray(options) ? options.map((option) => zodToJsonSchema(option)) : [],
      };
    }
    // ZodDiscriminatedUnion.options 在本 zod 版本（^3.25）是 schema 数组；
    // 个别旧实现是 { [discriminator值]: schema } map。两种都映射为 anyOf。
    case 'ZodDiscriminatedUnion': {
      const options = definition?.['options'];
      const schemas = Array.isArray(options)
        ? options.map((option) => zodToJsonSchema(option))
        : isRecord(options)
          ? Object.values(options).map((option) => zodToJsonSchema(option))
          : [];
      return { anyOf: schemas };
    }
    // ZodIntersection 的 JSON Schema 近似：任一分支成立即可。
    case 'ZodIntersection':
      return {
        anyOf: [zodToJsonSchema(definition?.['left']), zodToJsonSchema(definition?.['right'])],
      };
    case 'ZodRecord':
      return {
        type: 'object',
        additionalProperties: zodToJsonSchema(definition?.['valueType']),
      };
    case 'ZodTuple': {
      const items = definition?.['items'];
      return {
        type: 'array',
        prefixItems: Array.isArray(items) ? items.map((item) => zodToJsonSchema(item)) : [],
      };
    }
    // ZodBranded / ZodReadonly / ZodCatch 只做类型装饰，不改变结构描述。
    case 'ZodBranded':
    case 'ZodReadonly':
    case 'ZodCatch':
      return zodToJsonSchema(definition?.['innerType'] ?? definition?.['type']);
    // ZodAny / ZodUnknown：JSON Schema 里不加约束即等价。
    case 'ZodAny':
    case 'ZodUnknown':
      return {};
    // 其余未覆盖类型保持历史的 string 兜底，避免把未知结构「猜」成错误形状。
    default:
      return { type: 'string' };
  }
};

/**
 * Wrap a single OpenAWork `ToolDefinition` as an OpenCode LLM tool.
 *
 * The wrapper forwards `execute(input, signal)` directly. OpenCode LLM
 * may not always pass an abort signal (e.g. when a tool is called as
 * `onInputAvailable` outside a request scope), so we synthesise an
 * already-completed AbortController as a no-op fallback to satisfy
 * the underlying contract.
 */
export function wrapToolForNative(toolDef: ToolDefinition): NativeTool {
  return new OpenCodeLLM.ToolDefinition({
    name: toolDef.name,
    description: toolDef.description,
    inputSchema: zodToJsonSchema(toolDef.inputSchema),
  });
}

/**
 * Wrap a list of `ToolDefinition`s as an OpenCode LLM tool set keyed by
 * tool name. Duplicate names overwrite earlier registrations to
 * mirror `ToolRegistry.register`'s last-write-wins semantics.
 */
export function wrapToolsForNative(tools: ToolDefinition[]): NativeToolSet {
  const set: NativeToolSet = {};
  for (const definition of tools) {
    set[definition.name] = wrapToolForNative(definition);
  }
  return set;
}

/**
 * Wrap tool definitions as OpenCode LLM declarations *without* an `execute`
 * function. OpenCode LLM then surfaces tool-call deltas through the
 * stream and stops the model step on completion with reason
 * `tool-calls`, leaving the actual tool invocation to the caller.
 *
 * This variant is what Phase B.1 plugs into `runUpstreamStream` so the
 * existing OpenAWork agent loop (`routes/stream.ts`) keeps owning
 * permissions, sandboxing, file-diff capture, and child sessions while
 * the model side moves to OpenCode LLM.
 */
export function wrapToolsForNativeDeclarationsOnly(tools: ToolDefinition[]): NativeToolSet {
  const set: NativeToolSet = {};
  for (const definition of tools) {
    set[definition.name] = new OpenCodeLLM.ToolDefinition({
      name: definition.name,
      description: definition.description,
      inputSchema: zodToJsonSchema(definition.inputSchema),
    });
  }
  return set;
}

/**
 * Structural shape of `GatewayToolDefinition` that this adapter
 * relies on. Importing the real type from `tool-definitions.ts`
 * pulls in the entire gateway tool graph (sqlite, lsp, mcp), which
 * we deliberately avoid in the v2 runtime barrel — the structural
 * type below is intentionally narrower than the upstream interface.
 */
export interface GatewayToolFunctionShape {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: OpenCodeLLM.JsonSchema;
    strict?: boolean;
    deferLoading?: boolean;
  };
}

/**
 * Wrap a list of gateway tool definitions (the OpenAI-style
 * `function`-typed declarations the v1 path already builds) as an OpenCode
 * LLM tool set without `execute`. OpenCode LLM validates inputs against the
 * supplied JSON Schema and surfaces tool-call deltas through the
 * stream; the actual tool invocation stays in the existing
 * agent loop driven by `routes/stream.ts`.
 *
 * Why this complements `wrapToolsForNativeDeclarationsOnly`:
 *   - The reference variant takes `ToolDefinition[]` (zod-validated)
 *     and is the right call site for static, hand-written tools.
 *   - This variant takes the gateway's already-rendered JSON Schema,
 *     which covers static + dynamic + MCP + LSP + deferred tools
 *     uniformly. The Phase B.1 / B.2 v2 path consumes whatever the v1
 *     path consumes, so this is the practical bridge.
 */
export function wrapGatewayToolsForNativeDeclarationsOnly(
  tools: GatewayToolFunctionShape[],
): NativeToolSet {
  const set: NativeToolSet = {};
  for (const def of tools) {
    set[def.function.name] = new OpenCodeLLM.ToolDefinition({
      name: def.function.name,
      description: def.function.description,
      inputSchema: def.function.parameters,
    });
  }
  return set;
}
