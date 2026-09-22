import type { ZodTypeAny } from 'zod';
import { ZodFirstPartyTypeKind } from 'zod';

/**
 * Schema 驱动的工具输入修复层。
 *
 * 目标：在 `ToolRegistry.execute()` 调用 `inputSchema.safeParse()` 之前，
 * 按该工具的 Zod schema 修复模型常见的输入错误（字符串化 JSON、数字/布尔字符串等），
 * 思路对齐 opencode v2.0.12 的 `ToolInputRepairPlugin`。
 *
 * 关键约束：
 * - **无副作用、不抛异常**：任何解析/转换失败都回退原值，绝不改变原有校验语义；
 * - **只在 schema 明确支持时才修复**：无法确定目标类型时原样返回（`repairValue` 返回入参本身）。
 */

/** 递归修复的最大深度，防止 `z.lazy()` 自引用 schema 造成无限递归。 */
const MAX_REPAIR_DEPTH = 6;

/**
 * 读取 Zod v3 schema 的类别（`ZodFirstPartyTypeKind` 的取值）。
 *
 * `_def` 属于 zod 内部结构，这里集中封装：仓库内可能因依赖树里出现多份 zod 副本，
 * 使用公开类做 `instanceof` 判定跨副本时不可靠，故统一走 `_def.typeName`
 * （其取值与 zod 公开枚举 `ZodFirstPartyTypeKind` 一一对应）。zod 升级时只需改这一处。
 */
function zodKind(schema: ZodTypeAny): ZodFirstPartyTypeKind | undefined {
  const def = (schema as unknown as { readonly _def?: { readonly typeName?: unknown } })._def;
  const typeName = def?.typeName;
  if (typeof typeName !== 'string') return undefined;
  // zod 运行时写入的 typeName 即 ZodFirstPartyTypeKind 枚举值；断言仅为恢复字面量类型。
  return typeName as ZodFirstPartyTypeKind;
}

/**
 * 入口：按 schema 修复原始输入，返回修复后的值（不需要修复时返回入参本身）。
 * 纯函数，不修改入参对象。
 */
export function repairToolInput(schema: ZodTypeAny, rawInput: unknown): unknown {
  return repairValue(rawInput, schema, 0);
}

/** 递归修复单个值。 */
function repairValue(value: unknown, schema: ZodTypeAny, depth: number): unknown {
  if (depth > MAX_REPAIR_DEPTH) return value;

  // 先拆 optional / nullable / default / branded / readonly / lazy / pipeline 包装再递归。
  const wrapped = readWrapperInner(schema);
  if (wrapped) {
    if (value === null || value === undefined) return value;
    return repairValue(value, wrapped, depth + 1);
  }

  switch (zodKind(schema)) {
    case ZodFirstPartyTypeKind.ZodObject:
      return repairObject(value, schema, depth);
    case ZodFirstPartyTypeKind.ZodArray:
      return repairArray(value, schema, depth);
    case ZodFirstPartyTypeKind.ZodTuple:
      return repairTuple(value, schema, depth);
    case ZodFirstPartyTypeKind.ZodRecord:
      return repairRecord(value, schema, depth);
    case ZodFirstPartyTypeKind.ZodUnion:
    case ZodFirstPartyTypeKind.ZodDiscriminatedUnion:
      return repairUnion(value, schema, depth);
    case ZodFirstPartyTypeKind.ZodNumber:
      return repairNumber(value, schema);
    case ZodFirstPartyTypeKind.ZodBoolean:
      return repairBoolean(value);
    default:
      // 其余类型（enum / literal / date / map / set / effects 等）不做任何推断。
      return value;
  }
}

/** 目标为 object：值是字符串时尝试解析为 JSON 对象，并对已声明字段递归修复。 */
function repairObject(value: unknown, schema: ZodTypeAny, depth: number): unknown {
  const source = parseJsonString(value, 'object');
  if (!isPlainObject(source)) return value;

  const shape = readObjectShape(schema);
  if (!shape) return source === value ? value : source;

  const strict = isStrictObject(schema);
  // 未声明键：上游在有 `additionalProperties` schema 时按其修复；Zod 对应
  // `catchall(schema)`（`ZodNever` 表示没有）。
  const catchall = readCatchall(schema);
  let changed = source !== value;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    const child = shape[key];
    if (!child) {
      // 严格对象（`.strict()` / `z.strictObject()`）拒绝未声明键：对齐上游在
      // `additionalProperties:false` 时删除多余键的修复。其余按 catchall 递归
      // 修复后原样保留，由下游 schema 决定去留。
      if (strict) {
        changed = true;
        continue;
      }
      if (catchall) {
        const repairedUnknown = repairValue(source[key], catchall, depth + 1);
        if (repairedUnknown !== source[key]) changed = true;
        result[key] = repairedUnknown;
        continue;
      }
      result[key] = source[key];
      continue;
    }
    const current = source[key];
    if (shouldDropPlaceholder(child, current)) {
      changed = true;
      continue;
    }
    const repaired = repairValue(current, child, depth + 1);
    if (repaired !== current) changed = true;
    result[key] = repaired;
  }
  return changed ? result : source;
}

/** 未声明键是否被拒绝（strict 且没有 catchall 承接）。 */
function isStrictObject(schema: ZodTypeAny): boolean {
  const def = (
    schema as unknown as {
      readonly _def?: {
        readonly unknownKeys?: unknown;
        readonly catchall?: { readonly _def?: { readonly typeName?: unknown } };
      };
    }
  )._def;
  if (def?.unknownKeys !== 'strict') return false;
  return def.catchall?._def?.typeName === 'ZodNever';
}

/** 读取 `catchall` schema；未声明或为 `ZodNever` 时返回 undefined。 */
function readCatchall(schema: ZodTypeAny): ZodTypeAny | undefined {
  const catchall = (schema as unknown as { readonly _def?: { readonly catchall?: unknown } })._def
    ?.catchall;
  if (!isZodSchema(catchall) || zodKind(catchall) === ZodFirstPartyTypeKind.ZodNever) {
    return undefined;
  }
  return catchall;
}

/** 字段是否可缺省（optional / default）。 */
function isOptionalSchema(schema: ZodTypeAny): boolean {
  const isOptional = (schema as unknown as { readonly isOptional?: unknown }).isOptional;
  return typeof isOptional === 'function' && (isOptional as () => boolean).call(schema);
}

/** 仅拆 optional / readonly / default 包装，保留 nullable 等以判断 null 是否合法。 */
function unwrapOptionalWrapper(schema: ZodTypeAny): ZodTypeAny | undefined {
  switch (zodKind(schema)) {
    case ZodFirstPartyTypeKind.ZodOptional:
    case ZodFirstPartyTypeKind.ZodReadonly:
      return callMethod<ZodTypeAny>(schema, 'unwrap');
    case ZodFirstPartyTypeKind.ZodDefault:
      return callMethod<ZodTypeAny>(schema, 'removeDefault');
    default:
      return undefined;
  }
}

const SINGLE_TYPE_KINDS = new Set<ZodFirstPartyTypeKind>([
  ZodFirstPartyTypeKind.ZodString,
  ZodFirstPartyTypeKind.ZodNumber,
  ZodFirstPartyTypeKind.ZodBoolean,
  ZodFirstPartyTypeKind.ZodArray,
  ZodFirstPartyTypeKind.ZodObject,
  ZodFirstPartyTypeKind.ZodRecord,
]);

/**
 * 非必填、单一非空类型的字段：模型常用 `null` 或 `{}` 占位。
 * 对齐上游规则——nullable / union / literal / enum 等可能合法接受占位值的类型不动。
 */
function shouldDropPlaceholder(field: ZodTypeAny, current: unknown): boolean {
  if (!isOptionalSchema(field)) return false;
  let inner = field;
  for (let depth = 0; depth <= MAX_REPAIR_DEPTH; depth += 1) {
    const unwrapped = unwrapOptionalWrapper(inner);
    if (!unwrapped) break;
    inner = unwrapped;
  }
  const kind = zodKind(inner);
  if (!kind || !SINGLE_TYPE_KINDS.has(kind)) return false;
  if (current === null) return true;
  // `{}` 只有对非 object/record 目标才是占位；object/record 合法接受空对象。
  if (kind === ZodFirstPartyTypeKind.ZodObject || kind === ZodFirstPartyTypeKind.ZodRecord)
    return false;
  return isPlainObject(current) && Object.keys(current).length === 0;
}

/** 目标为 array：值是字符串时尝试解析为 JSON 数组；非数组值在元素兼容时包装为单元素数组。 */
function repairArray(value: unknown, schema: ZodTypeAny, depth: number): unknown {
  const element = readArrayElement(schema);
  const parsed = parseJsonString(value, 'array');

  if (Array.isArray(parsed)) {
    if (!element) return parsed === value ? value : parsed;
    let changed = parsed !== value;
    const result = parsed.map((item) => {
      const repaired = repairValue(item, element, depth + 1);
      if (repaired !== item) changed = true;
      return repaired;
    });
    return changed ? result : value;
  }

  if (!element) return value;
  // 模型有时把单个元素当成裸值传入（如 "2" 之于 z.array(z.number())）：
  // 仅当修复后的值与元素 schema 的根类型明确兼容时才包装，否则保持原值。
  const repaired = repairValue(value, element, depth + 1);
  return isCompatibleWithSchema(repaired, element) ? [repaired] : value;
}

/** 目标为 tuple：按位置对成员递归修复；多出的元素在有 rest schema 时按 rest 修复。 */
function repairTuple(value: unknown, schema: ZodTypeAny, depth: number): unknown {
  const items = readTupleItems(schema);
  const rest = readTupleRest(schema);
  const parsed = parseJsonString(value, 'array');
  if (!Array.isArray(parsed)) return value;

  let changed = parsed !== value;
  const result = parsed.map((item, index) => {
    const member = items[index] ?? rest;
    if (!member) return item;
    const repaired = repairValue(item, member, depth + 1);
    if (repaired !== item) changed = true;
    return repaired;
  });
  return changed ? result : value;
}

/** 目标为 record / 字典：值是字符串时先解析，再对每个 value 递归修复。 */
function repairRecord(value: unknown, schema: ZodTypeAny, depth: number): unknown {
  const source = parseJsonString(value, 'object');
  if (!isPlainObject(source)) return value;

  const valueSchema = readRecordValue(schema);
  if (!valueSchema) return source === value ? value : source;

  let changed = source !== value;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    const repaired = repairValue(source[key], valueSchema, depth + 1);
    if (repaired !== source[key]) changed = true;
    result[key] = repaired;
  }
  return changed ? result : value;
}

/**
 * 目标为 union：仅当值的根类型不被任何分支接受、且过滤掉 null/undefined 分支后
 * 只剩唯一候选时，才对候选递归修复；其余情况保持原值。
 */
function repairUnion(value: unknown, schema: ZodTypeAny, depth: number): unknown {
  if (value === null || value === undefined) return value;

  const options = readUnionOptions(schema);
  if (options.length === 0) return value;

  // discriminated union：输入本身带判别键，先按判别值锁定唯一成员再递归修复。
  // 若走下面的「rootKind 命中即返回」，所有成员都是 object 时会直接跳过，
  // 导致成员内部的数字/布尔字符串永远修不到（desktop_control 等带判别键的工具即此形态）。
  const discriminator = readUnionDiscriminator(schema);
  if (discriminator && isPlainObject(value)) {
    const discriminant = value[discriminator];
    if (typeof discriminant === 'string' || typeof discriminant === 'number') {
      const matched = options.find(
        (option) => objectDiscriminant(option, discriminator) === discriminant,
      );
      if (matched) return repairValue(value, matched, depth + 1);
    }
  }

  const rootKind = valueRootKind(value);
  if (options.some((option) => schemaRootKind(option) === rootKind)) return value;

  const candidates = options.filter((option) => !isNullishSchema(option));
  const [candidate] = candidates;
  if (candidates.length !== 1 || !candidate) return value;
  return repairValue(value, candidate, depth + 1);
}

/** 读取 discriminated union 的判别键名（普通 union 返回 undefined）。 */
function readUnionDiscriminator(schema: ZodTypeAny): string | undefined {
  if (zodKind(schema) !== ZodFirstPartyTypeKind.ZodDiscriminatedUnion) return undefined;
  const discriminator = (
    schema as unknown as { readonly _def?: { readonly discriminator?: unknown } }
  )._def?.discriminator;
  return typeof discriminator === 'string' ? discriminator : undefined;
}

/**
 * 读取成员对象在判别键上的字面量取值。
 * 成员通常是 `z.object({ action: z.literal('click') })`，对应取 `shape[discriminator].value`。
 */
function objectDiscriminant(
  option: ZodTypeAny,
  discriminator: string,
): string | number | undefined {
  const shape = readObjectShape(option);
  const fieldSchema = shape?.[discriminator];
  if (!fieldSchema) return undefined;
  const literal = (fieldSchema as unknown as { readonly value?: unknown }).value;
  return typeof literal === 'string' || typeof literal === 'number' ? literal : undefined;
}

/** 目标为 number：仅把非空、可有限解析的字符串转成数字；整数 schema 额外要求安全整数。 */
function repairNumber(value: unknown, schema: ZodTypeAny): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (trimmed === '') return value;

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return value;
  if (isIntegerSchema(schema) && !Number.isSafeInteger(parsed)) return value;
  return parsed;
}

/** 目标为 boolean：仅接受字面量 "true" / "false"。 */
function repairBoolean(value: unknown): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

/**
 * 当目标结构是 object/array 时，尝试把字符串解析为 JSON。
 * 只有当文本首字符与目标结构匹配时才解析，避免把普通字符串误判成 JSON；
 * 解析失败或结果类型不符时返回原值。
 */
function parseJsonString(value: unknown, expected: 'object' | 'array'): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (trimmed === '') return value;

  const first = trimmed[0];
  if (expected === 'object' && first !== '{') return value;
  if (expected === 'array' && first !== '[') return value;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // 不是合法 JSON 文本：原样返回，把报错留给原有 safeParse。
    return value;
  }
  if (expected === 'object' && isPlainObject(parsed)) return parsed;
  if (expected === 'array' && Array.isArray(parsed)) return parsed;
  return value;
}

/** `z.lazy()` 等包装器的内层 schema 读取；无包装时返回 undefined。 */
function readWrapperInner(schema: ZodTypeAny): ZodTypeAny | undefined {
  switch (zodKind(schema)) {
    case ZodFirstPartyTypeKind.ZodOptional:
    case ZodFirstPartyTypeKind.ZodNullable:
    case ZodFirstPartyTypeKind.ZodBranded:
    case ZodFirstPartyTypeKind.ZodReadonly:
      return callMethod<ZodTypeAny>(schema, 'unwrap');
    case ZodFirstPartyTypeKind.ZodDefault:
      return callMethod<ZodTypeAny>(schema, 'removeDefault');
    case ZodFirstPartyTypeKind.ZodLazy: {
      const lazy = (schema as unknown as { readonly schema?: unknown }).schema;
      return isZodSchema(lazy) ? lazy : undefined;
    }
    case ZodFirstPartyTypeKind.ZodEffects: {
      // refine / superRefine / transform 包装：输入侧校验由内部 `schema` 承担。
      // 若不拆这层，带 refine 的工具（如 desktop_control 的 superRefine）在修复层
      // 会被当作不可识别类型整体跳过，修复能力静默失效。
      // 注意 zod v3 的 `ZodEffects` 用 `schema` 承载内层，v4 改名 `innerType`，两者都读。
      const def = (
        schema as unknown as {
          readonly _def?: { readonly schema?: unknown; readonly innerType?: unknown };
        }
      )._def;
      const inner = def?.schema ?? def?.innerType;
      return isZodSchema(inner) ? inner : undefined;
    }
    case ZodFirstPartyTypeKind.ZodPipeline: {
      // pipeline 的 `in` 才是输入侧校验 schema；`_def` 在此集中读取并注释以避免散落。
      const pipelineIn = (schema as unknown as { readonly _def?: { readonly in?: unknown } })._def
        ?.in;
      return isZodSchema(pipelineIn) ? pipelineIn : undefined;
    }
    default:
      return undefined;
  }
}

function readObjectShape(schema: ZodTypeAny): Record<string, ZodTypeAny> | undefined {
  const shape = (schema as unknown as { readonly shape?: unknown }).shape;
  if (!isPlainObject(shape)) return undefined;
  return shape as Record<string, ZodTypeAny>;
}

function readArrayElement(schema: ZodTypeAny): ZodTypeAny | undefined {
  const element = (schema as unknown as { readonly element?: unknown }).element;
  return isZodSchema(element) ? element : undefined;
}

function readTupleItems(schema: ZodTypeAny): readonly ZodTypeAny[] {
  const items = (schema as unknown as { readonly items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items.filter(isZodSchema);
}

/** tuple 的可变尾部 schema 只暴露在 `_def.rest`，集中封装并注释。 */
function readTupleRest(schema: ZodTypeAny): ZodTypeAny | undefined {
  const rest = (schema as unknown as { readonly _def?: { readonly rest?: unknown } })._def?.rest;
  return isZodSchema(rest) ? rest : undefined;
}

function readRecordValue(schema: ZodTypeAny): ZodTypeAny | undefined {
  const valueSchema = (schema as unknown as { readonly valueSchema?: unknown }).valueSchema;
  return isZodSchema(valueSchema) ? valueSchema : undefined;
}

function readUnionOptions(schema: ZodTypeAny): readonly ZodTypeAny[] {
  const options = (schema as unknown as { readonly options?: unknown }).options;
  if (!Array.isArray(options)) return [];
  return options.filter(isZodSchema);
}

/** 判断 schema 根类型是否只接受 null / undefined（用于 union 候选过滤）。 */
function isNullishSchema(schema: ZodTypeAny, depth = 0): boolean {
  if (depth > MAX_REPAIR_DEPTH) return false;
  const wrapped = readWrapperInner(schema);
  if (wrapped) return isNullishSchema(wrapped, depth + 1);
  const kind = zodKind(schema);
  return kind === ZodFirstPartyTypeKind.ZodNull || kind === ZodFirstPartyTypeKind.ZodUndefined;
}

/** 值的根类型；仅用于 union 分支匹配。 */
function valueRootKind(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

/** schema 可接受的根类型；无法判断时返回 undefined。 */
function schemaRootKind(schema: ZodTypeAny, depth = 0): string | undefined {
  if (depth > MAX_REPAIR_DEPTH) return undefined;
  const wrapped = readWrapperInner(schema);
  if (wrapped) return schemaRootKind(wrapped, depth + 1);

  switch (zodKind(schema)) {
    case ZodFirstPartyTypeKind.ZodObject:
    case ZodFirstPartyTypeKind.ZodRecord:
      return 'object';
    case ZodFirstPartyTypeKind.ZodArray:
    case ZodFirstPartyTypeKind.ZodTuple:
      return 'array';
    case ZodFirstPartyTypeKind.ZodString:
    case ZodFirstPartyTypeKind.ZodEnum:
      return 'string';
    case ZodFirstPartyTypeKind.ZodNumber:
      return 'number';
    case ZodFirstPartyTypeKind.ZodBoolean:
      return 'boolean';
    default:
      return undefined;
  }
}

/** 判断修复后的值是否与元素 schema 的根类型明确兼容（用于单元素数组包装）。 */
function isCompatibleWithSchema(value: unknown, schema: ZodTypeAny): boolean {
  const rootKind = schemaRootKind(schema);
  if (rootKind === undefined) return false;
  if (rootKind === 'object') return isPlainObject(value);
  if (rootKind === 'array') return Array.isArray(value);
  if (rootKind === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === rootKind;
}

function isIntegerSchema(schema: ZodTypeAny): boolean {
  return (schema as unknown as { readonly isInt?: unknown }).isInt === true;
}

function isZodSchema(value: unknown): value is ZodTypeAny {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { parse?: unknown }).parse === 'function'
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 调用 schema 上的可选方法；方法缺失时返回 undefined，绝不抛异常。 */
function callMethod<T>(schema: ZodTypeAny, method: string): T | undefined {
  const fn = (schema as unknown as Record<string, unknown>)[method];
  return typeof fn === 'function' ? (fn as () => T).call(schema) : undefined;
}
