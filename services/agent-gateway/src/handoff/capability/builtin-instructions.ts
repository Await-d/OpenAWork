/**
 * 260518 · 内置指令注册表（每层专属 LLM-facing 函数工具）
 *
 * 与"通用工具"（read/write/shell/lsp 等）不同，本模块定义"系统指令"——
 * 每个指令归属唯一一个层（ownerLayer），LLM 在错误的层调用时直接被拒绝。
 *
 * 关联：
 *   - layer-capabilities.ts：每层 allowedBuiltinInstructions 白名单
 *   - 构思 §2B.7 "不在一个 agent 里塞所有工具"
 *   - L1.4 §1.4.3 audit log 强制
 *
 * 使用模式：
 *   1. stream.ts 在为某层 LLM 构建 enabledTools 时调 getInstructionsForLayer(role)
 *   2. 把返回的指令转成 OpenAI tool definition 注入 model
 *   3. LLM 调用时进入 dispatcher.invokeInstruction(callerLayer, name, args)
 *   4. dispatcher 校验 ownerLayer 后执行 handler；不匹配则返回错误给 LLM
 *
 * 设计哲学（对应 Q1 的回答）：
 *   - 指令是 LLM-facing 函数工具（像 read 一样注册）
 *   - 每个指令独属于一个层
 *   - LLM 看不到不属于自己层的指令（前置过滤）
 *   - 即便看到也调不通（dispatcher 后置校验）— 双层保护
 */

import type { z } from 'zod';
import type { HandoffRoleLayer } from '../store/handoff-store.js';
import {
  LAYER_CAPABILITIES,
  assertInstructionOwnedByLayer,
  LayerCapabilityViolationError,
} from './layer-capabilities.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface InstructionContext {
  /** 调用者所在层（必须 = ownerLayer，否则被拒绝） */
  callerLayer: HandoffRoleLayer;
  /** 调用者的 session id */
  sessionId: string;
  /** 调用者的 user id */
  userId: string;
  /** 当前 handoff id（如果有） */
  handoffId?: string;
}

export interface InstructionResult {
  ok: boolean;
  /** 给 LLM 看的可读结果（成功或失败描述） */
  message: string;
  /** 结构化数据（成功时） */
  data?: Record<string, unknown>;
  /** 错误码（失败时） */
  errorCode?: string;
}

export interface BuiltinInstruction<TArgs = unknown> {
  /** 指令名（snake_case）；与 layer-capabilities 中 allowedBuiltinInstructions 对应 */
  name: string;
  /** 唯一拥有者层 */
  ownerLayer: HandoffRoleLayer;
  /** 给 LLM 看的描述 */
  description: string;
  /** 参数 schema（zod） */
  schema: z.ZodType<TArgs>;
  /** 实际处理函数 */
  handler: (ctx: InstructionContext, args: TArgs) => Promise<InstructionResult>;
}

// ─── Registry ───────────────────────────────────────────────────────────────

/** 复合 key：name + ownerLayer。同名指令可在不同层各自注册一份。 */
type InstructionKey = `${string}::${HandoffRoleLayer}`;
function makeKey(name: string, ownerLayer: HandoffRoleLayer): InstructionKey {
  return `${name}::${ownerLayer}`;
}

const REGISTRY = new Map<InstructionKey, BuiltinInstruction>();

/**
 * 注册一个内置指令。同 (name, ownerLayer) 重复注册会覆盖（用于测试 mock）。
 * 不同 ownerLayer 但同 name 的指令各自独立存在（如 mark_completed 在 pm1/pm2/e/g 各有一份）。
 */
export function registerInstruction<TArgs>(instruction: BuiltinInstruction<TArgs>): void {
  // 与 layer-capabilities 矩阵一致性检查：在 owner 层的 allowedBuiltinInstructions 中
  const caps = LAYER_CAPABILITIES[instruction.ownerLayer];
  if (!caps.allowedBuiltinInstructions.includes(instruction.name)) {
    throw new Error(
      `[builtin-instructions] 注册失败：指令 "${instruction.name}" 不在 ${instruction.ownerLayer} 的 allowedBuiltinInstructions 中`,
    );
  }
  REGISTRY.set(makeKey(instruction.name, instruction.ownerLayer), instruction as BuiltinInstruction);
}

export function unregisterInstruction(name: string, ownerLayer: HandoffRoleLayer): void {
  REGISTRY.delete(makeKey(name, ownerLayer));
}

export function __clearRegistryForTesting(): void {
  REGISTRY.clear();
}

/**
 * 按 (name, ownerLayer) 查指令。dispatcher 必须传 ownerLayer，避免歧义。
 */
export function getInstruction(name: string, ownerLayer: HandoffRoleLayer): BuiltinInstruction | undefined {
  return REGISTRY.get(makeKey(name, ownerLayer));
}

/**
 * 列出某层可见的全部指令（LLM-facing 工具集构建用）。
 *
 * 这是"前置过滤"：在 stream.ts 给某层 LLM 注入工具时只拿这一层的指令，
 * LLM 根本看不到其他层的工具。
 */
export function getInstructionsForLayer(layer: HandoffRoleLayer): BuiltinInstruction[] {
  const caps = LAYER_CAPABILITIES[layer];
  const result: BuiltinInstruction[] = [];
  for (const name of caps.allowedBuiltinInstructions) {
    const inst = REGISTRY.get(makeKey(name, layer));
    if (inst) {
      result.push(inst);
    }
  }
  return result;
}

/**
 * 把指令转换成 OpenAI tool definition 格式（供 stream.ts 注入到 model）。
 * 输出与 services/agent-gateway/src/tool-definitions.ts 中的 GatewayToolDefinition 一致。
 */
export function toToolDefinition(instruction: BuiltinInstruction): {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required: string[];
      additionalProperties: boolean;
    };
    strict: boolean;
  };
} {
  const jsonSchema = zodToJsonSchemaLite(instruction.schema);
  const properties = (jsonSchema['properties'] as Record<string, unknown>) ?? {};
  const required = (jsonSchema['required'] as string[]) ?? [];
  return {
    type: 'function',
    function: {
      name: instruction.name,
      description: instruction.description,
      parameters: {
        type: 'object',
        properties,
        required,
        additionalProperties: false,
      },
      strict: false,
    },
  };
}

/**
 * 轻量 zod → JSON schema 转换（仅支持 z.object 顶层 + 简单字段类型）。
 * 完整能力需引入 zod-to-json-schema，但项目还没装；先做最小版。
 */
function zodToJsonSchemaLite(schema: z.ZodType): Record<string, unknown> {
  // 兜底：如果 schema 是 z.object，直接拿 shape
  const def = (schema as unknown as { _def?: { typeName?: string; shape?: () => unknown } })._def;
  if (def?.typeName === 'ZodObject' && typeof def.shape === 'function') {
    const shape = def.shape() as Record<string, z.ZodType>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, fieldSchema] of Object.entries(shape)) {
      const fieldDef = (fieldSchema as unknown as { _def?: { typeName?: string } })._def;
      const isOptional = fieldDef?.typeName === 'ZodOptional';
      properties[key] = inferFieldType(fieldSchema);
      if (!isOptional) required.push(key);
    }
    return {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
    };
  }
  // 默认空 object
  return { type: 'object', properties: {} };
}

function inferFieldType(field: z.ZodType): Record<string, unknown> {
  const def = (field as unknown as { _def?: { typeName?: string; innerType?: z.ZodType } })._def;
  const tn = def?.typeName;
  if (tn === 'ZodOptional' && def?.innerType) {
    return inferFieldType(def.innerType);
  }
  if (tn === 'ZodString') return { type: 'string' };
  if (tn === 'ZodNumber') return { type: 'number' };
  if (tn === 'ZodBoolean') return { type: 'boolean' };
  if (tn === 'ZodArray') return { type: 'array' };
  if (tn === 'ZodObject') return { type: 'object' };
  if (tn === 'ZodEnum') {
    const values = (def as unknown as { values?: readonly string[] }).values;
    return { type: 'string', enum: values ?? [] };
  }
  return {};
}

// ─── Dispatcher ─────────────────────────────────────────────────────────────

/**
 * LLM tool_call 进入入口：校验 ownerLayer + schema，然后执行 handler。
 *
 * 软拒绝（per Q2 决策）：错误层调用 → 返回 InstructionResult 给 LLM 自行纠正，
 * 不抛错也不杀任务。同时写 audit log（layer-capabilities 已处理）。
 */
export async function invokeInstruction(input: {
  ctx: InstructionContext;
  instructionName: string;
  rawArgs: unknown;
}): Promise<InstructionResult> {
  // 先按 callerLayer 找：如果 caller 自己有这条指令就用它
  let inst = REGISTRY.get(makeKey(input.instructionName, input.ctx.callerLayer));

  // 如果 caller 层没有，但其他层有（说明这是错误层调用） → 软拒绝 instruction-not-owned
  if (!inst) {
    let foundAnywhere = false;
    for (const key of REGISTRY.keys()) {
      if (key.startsWith(`${input.instructionName}::`)) {
        foundAnywhere = true;
        break;
      }
    }
    if (foundAnywhere) {
      // 通过 capability guard 走标准的 instruction-not-owned 拒绝（含 audit log）
      try {
        assertInstructionOwnedByLayer({
          callerLayer: input.ctx.callerLayer,
          instructionName: input.instructionName,
          userId: input.ctx.userId,
          sessionId: input.ctx.sessionId,
        });
      } catch (err) {
        if (err instanceof LayerCapabilityViolationError) {
          return {
            ok: false,
            errorCode: 'instruction-not-owned',
            message: err.message,
          };
        }
        throw err;
      }
    }
    // 真正不存在
    return {
      ok: false,
      errorCode: 'instruction-not-found',
      message: `指令 "${input.instructionName}" 不存在。`,
    };
  }

  // 找到了 caller 层的指令；再走一次 capability assert 兜底（防御性，registerInstruction
  // 已经过滤过；但万一 LAYER_CAPABILITIES 与 REGISTRY 不一致，这层 guard 拦下来）
  try {
    assertInstructionOwnedByLayer({
      callerLayer: input.ctx.callerLayer,
      instructionName: input.instructionName,
      userId: input.ctx.userId,
      sessionId: input.ctx.sessionId,
    });
  } catch (err) {
    if (err instanceof LayerCapabilityViolationError) {
      return {
        ok: false,
        errorCode: 'instruction-not-owned',
        message: err.message,
      };
    }
    throw err;
  }

  // 2. 校验 args schema
  const parsed = inst.schema.safeParse(input.rawArgs);
  if (!parsed.success) {
    return {
      ok: false,
      errorCode: 'invalid-args',
      message: `参数校验失败：${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    };
  }

  // 3. 执行 handler；handler 抛错 → 软拒绝
  try {
    return await inst.handler(input.ctx, parsed.data);
  } catch (err) {
    return {
      ok: false,
      errorCode: 'handler-error',
      message: `指令执行失败：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
