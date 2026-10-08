/**
 * 服务端结构化日志出口。
 *
 * 存在的理由：Fastify 的 `request.log` 只在请求上下文内可用，而大量关键错误发生在
 * 请求上下文之外——流式执行的深层 `catch`、后台定时器、模型轮次回调、团队运行时等。
 * 这些位置此前只能退回 `console.*`，导致两个直接后果：
 *
 * 1. `console.log` 承载致命错误（如 `STREAM_ERROR`）——不进结构化日志，无法按级别
 *    过滤，低日志级别的部署会把真正的故障静默掉；
 * 2. `String(err)` 形式的记录只有 message，堆栈丢失后几乎无法定位。
 *
 * 这里由 `index.ts` 在创建 Fastify 实例后注入 `app.log`，其余模块通过
 * `logGatewayError(` / `logGatewayWarn(` / `logGatewayInfo` 写入。未注入时（单元测试、
 * CLI 子命令）回退到 console，保证日志不被静默丢弃。
 */
import type { FastifyBaseLogger } from 'fastify';
import { redactLogFields } from '@openAwork/logger';

type GatewayLogMethods = Pick<FastifyBaseLogger, 'trace' | 'debug' | 'info' | 'warn' | 'error'>;
type GatewayLogger = GatewayLogMethods;

/**
 * 日志入口签名：**message 在前，结构化字段在后**。
 *
 * 刻意与 `console.*` / `pino` 的直觉一致，而不是把 fields 放在前面。原因是迁移
 * 成本：现存数百处 `console.error(msg, ctx)` 若改成 fields-first，每个调用点都得
 * 人工翻转参数顺序——而这类机械改写恰恰是引入静默错误（消息与上下文对调）的高发区。
 * 保持 message-first 后，从 `console.*` 迁移过来只是换函数名，语义不变。
 *
 * 第二参数兼容两种形态：普通上下文对象，或一个裸 `Error`（自动展开为堆栈字段）。
 */
type GatewayLogFn = (message: string, fields?: unknown) => void;

const MAX_STACK_CHARS = 8_000;

let boundLogger: GatewayLogger | null = null;

/**
 * 未绑定 logger 时的回退（单元测试、CLI 子命令）。
 *
 * 输出刻意与对应的 `console.*` **完全等价**——不加 `[gateway:level]` 之类的前缀。
 * 原因：大量既有测试断言的是「某条告警确实产生了」；一旦在回退路径上加装饰，
 * 这些断言就会因为纯装饰性差异而失败，从而把真实回归淹没在噪音里。而生产路径
 * （`bindGatewayLogger` 之后）根本不经过这里，前缀也不会出现在容器日志中——
 * 即这个装饰没有任何收益，只有成本。
 */
function consoleFallback(level: keyof GatewayLogMethods): GatewayLogFn {
  const emit = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  return (message, fields) => {
    if (fields === undefined) {
      emit(message);
      return;
    }
    emit(message, fields);
  };
}

/** 注入 Fastify 实例的 logger（`index.ts` 启动时调用一次）。 */
export function bindGatewayLogger(logger: GatewayLogger): void {
  boundLogger = logger;
}

function resolveMethod(level: keyof GatewayLogMethods): GatewayLogFn {
  const logger = boundLogger;
  if (!logger) return consoleFallback(level);
  return (message, fields) => {
    const normalized = normalizeFields(toFieldBag(fields));
    // 日志字段统一脱敏，避免 token / 密钥被写进日志后随容器日志外泄。
    logger[level](redactLogFields(normalized) ?? {}, message);
  };
}

/**
 * 把第二参数收敛成字段包。
 *
 * `console.error('msg', err)` 这种「直接甩一个 Error」的写法在存量代码里很常见，
 * 若原样传给 pino 会得到一个空的序列化结果——错误本身反而丢了。这里显式识别并展开为
 * `{ errorName, errorMessage, errorStack }`，保证迁移后信息只增不减。
 */
function toFieldBag(fields: unknown): Record<string, unknown> {
  if (fields === undefined || fields === null) return {};
  if (fields instanceof Error) {
    return { errorName: fields.name, errorMessage: fields.message, errorStack: fields.stack ?? null };
  }
  if (typeof fields === 'object') return fields as Record<string, unknown>;
  return { detail: fields };
}

/**
 * 把任意值收敛为脱敏函数可接受的基本类型。
 * `Error` 实例展开为堆栈（保留排障所需的调用链），其余对象序列化为 JSON。
 */
function normalizeFields(fields: Record<string, unknown>): Record<string, string | number | boolean> {
  const normalized: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      normalized[key] = value;
    } else if (value instanceof Error) {
      normalized[key] = value.stack ?? value.message;
    } else {
      try {
        normalized[key] = JSON.stringify(value) ?? '[unserializable]';
      } catch {
        normalized[key] = '[unserializable]';
      }
    }
  }
  return normalized;
}

export function logGatewayTrace(message: string, fields?: unknown): void {
  resolveMethod('trace')(message, fields);
}

export function logGatewayDebug(message: string, fields?: unknown): void {
  resolveMethod('debug')(message, fields);
}

export function logGatewayInfo(message: string, fields?: unknown): void {
  resolveMethod('info')(message, fields);
}

export function logGatewayWarn(message: string, fields?: unknown): void {
  resolveMethod('warn')(message, fields);
}

export function logGatewayError(message: string, fields?: unknown): void {
  resolveMethod('error')(message, fields);
}

/**
 * 把任意 catch 到的值转成可写日志的字段，**保留堆栈**。
 *
 * `String(err)` 只产出 `[object Object]` 或 message，是「错误记录了但没法排查」的
 * 常见根因——所有记录错误的分支都应改用本函数。
 */
export function describeError(error: unknown): {
  errorName: string;
  errorMessage: string;
  errorStack: string | null;
} {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack ? error.stack.slice(0, MAX_STACK_CHARS) : null,
    };
  }
  if (typeof error === 'string') {
    return { errorName: 'NonError', errorMessage: error.slice(0, 1_000), errorStack: null };
  }
  // 非 Error 值：JSON 序列化可能因循环引用抛错，而 Symbol 的 `String()` 更是直接抛
  // TypeError——两者若在 catch 分支里再次抛出，就会用新的异常覆盖真正的故障现场。
  try {
    const serialized = JSON.stringify(error);
    return {
      errorName: 'NonError',
      errorMessage: serialized === undefined ? typeof error : serialized.slice(0, 1_000),
      errorStack: null,
    };
  } catch {
    return { errorName: 'NonError', errorMessage: typeof error, errorStack: null };
  }
}