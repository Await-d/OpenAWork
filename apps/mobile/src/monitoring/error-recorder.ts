/**
 * 移动端错误记录中枢。
 *
 * 现状问题（本次接入的起因）：移动端有 60+ 处 `catch`，但**没有任何一处把错误上报出去**——
 * `captureError` 定义了却零调用，没有全局错误处理器，也没有渲染错误边界。用户在手机上
 * 看到白屏或「操作没反应」，开发者只能靠猜测。
 *
 * 为什么不用 `@openAwork/logger`：该包的入口同时导出 pino / fastify 相关的服务端模块，
 * 在 React Native 里 import 会把 Node 侧依赖拖进 bundle。它提供的浏览器版
 * `installGlobalErrorCapture` 依赖 `window.addEventListener`，在 RN 里也不成立——
 * RN 的全局错误入口是 `ErrorUtils`。两者都需要独立实现，故本模块自带最小实现。
 *
 * 记录分两路（与 Web 端保持同一策略）：
 * - 本地：**无条件**记录到内存环形缓冲 + `console`，不受 Sentry DSN 是否配置影响；
 * - 远程：仅当 Sentry 初始化且 DSN 非空时经 sink 上报（用户未配置 DSN 即等价于未同意）。
 */

/** 单条记录。字段刻意保持扁平，便于直接映射到 Sentry extras。 */
export interface MobileErrorRecord {
  /** 错误来源，便于快速判断是哪一层出的问题。 */
  source: MobileErrorSource;
  name: string;
  message: string;
  stack: string | null;
  /** 附加上下文（路由、动作名等），已脱敏。 */
  context: Record<string, string>;
  timestamp: string;
}

export type MobileErrorSource = 'global' | 'unhandled-rejection' | 'react-boundary' | 'manual';

export interface MobileErrorInput {
  source: MobileErrorSource;
  error: unknown;
  context?: Record<string, string | number | boolean | undefined>;
}

export type ErrorSink = (record: MobileErrorRecord) => void;

const MAX_RECORDS = 100;
const MAX_MESSAGE_CHARS = 1_000;
const MAX_STACK_CHARS = 8_000;

/**
 * 敏感信息脱敏。
 *
 * 与 Sentry 的 `beforeSend` 形成两层防护：这里保证**进入内存缓冲之前**就干净，
 * 避免明文 token 因「导出诊断文本」「调试日志」等旁路泄漏。
 */
const SENSITIVE_PATTERNS: RegExp[] = [
  /Bearer\s+[\w.-]+/gi,
  /authorization["']?\s*:\s*["'][^"']+["']/gi,
  /api[_-]?key["']?\s*:\s*["'][^"']+["']/gi,
  /password["']?\s*:\s*["'][^"']+["']/gi,
  /token["']?\s*:\s*["'][^"']+["']/gi,
  /secret["']?\s*:\s*["'][^"']+["']/gi,
];

export function redactSensitive(value: string): string {
  let result = value;
  for (const pattern of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? typeof value;
  } catch {
    // 循环引用等无法序列化的值：退化为类型名，绝不因「记录错误」而抛错。
    return typeof value;
  }
}

/**
 * 把任意 catch 到的值转成可记录的信息。
 *
 * 单独导出便于测试，且刻意不复用 `String(value)`：对 Symbol 会直接抛 TypeError，
 * 对象会得到毫无信息量的 `[object Object]`。
 */
export function describeMobileError(error: unknown): {
  name: string;
  message: string;
  stack: string | null;
} {
  if (error instanceof Error) {
    return {
      name: error.name || 'Error',
      message: redactSensitive(error.message).slice(0, MAX_MESSAGE_CHARS),
      stack: error.stack ? error.stack.slice(0, MAX_STACK_CHARS) : null,
    };
  }
  if (typeof error === 'string') {
    return {
      name: 'NonError',
      message: redactSensitive(error).slice(0, MAX_MESSAGE_CHARS),
      stack: null,
    };
  }
  return {
    name: 'NonError',
    message: redactSensitive(safeStringify(error)).slice(0, MAX_MESSAGE_CHARS),
    stack: null,
  };
}

class MobileErrorRecorder {
  private records: MobileErrorRecord[] = [];
  private sinks = new Set<ErrorSink>();

  record(input: MobileErrorInput): MobileErrorRecord {
    const described = describeMobileError(input.error);
    const context: Record<string, string> = {};
    for (const [key, value] of Object.entries(input.context ?? {})) {
      if (value === undefined) continue;
      const text = typeof value === 'string' ? value : String(value);
      context[key] = redactSensitive(text).slice(0, 200);
    }

    const record: MobileErrorRecord = {
      source: input.source,
      name: described.name,
      message: described.message,
      stack: described.stack,
      context,
      timestamp: new Date().toISOString(),
    };

    // 环形缓冲：保证最近故障一定留痕，同时不让内存无限增长。
    this.records.push(record);
    if (this.records.length > MAX_RECORDS) {
      this.records.shift();
    }

    // 本地输出让开发期无需 Sentry 也能看到问题。
    const line = `[mobile:${record.source}] ${record.name}: ${record.message}`;
    if (record.source === 'manual' || record.source === 'react-boundary') {
      console.error(line, record.stack ?? '');
    } else {
      console.warn(line, record.stack ?? '');
    }

    for (const sink of this.sinks) {
      try {
        sink(record);
      } catch {
        // sink 失败不得影响记录落库，也不得递归触发自身。
      }
    }
    return record;
  }

  subscribe(sink: ErrorSink): () => void {
    this.sinks.add(sink);
    return () => {
      this.sinks.delete(sink);
    };
  }

  list(): MobileErrorRecord[] {
    return [...this.records];
  }

  count(): number {
    return this.records.length;
  }

  /** 导出诊断文本：用户反馈问题时可直接粘贴，无需连接开发者工具。 */
  toText(): string {
    if (this.records.length === 0) return '未捕获到客户端错误。';
    return this.records
      .map((record) => {
        const ctx = Object.keys(record.context).length
          ? `\n上下文：${safeStringify(record.context)}`
          : '';
        const stack = record.stack ? `\n堆栈：${record.stack}` : '';
        return `[${record.timestamp}] [${record.source}] ${record.name}: ${record.message}${ctx}${stack}`;
      })
      .join('\n\n');
  }

  clear(): void {
    this.records = [];
  }
}

export const mobileErrorRecorder = new MobileErrorRecorder();

/** 手动记录（供已知但未冒泡的 catch 使用）。 */
export function recordMobileError(
  error: unknown,
  context?: Record<string, string | number | boolean | undefined>,
  source: MobileErrorSource = 'manual',
): MobileErrorRecord {
  return mobileErrorRecorder.record({
    source,
    error,
    ...(context ? { context } : {}),
  });
}

/**
 * 全局处理器是否已安装。
 *
 * 幂等是必需的：HMR 下模块会被重复求值，若处理器叠加安装，同一次崩溃会被记录多次，
 * 反而淹没真实故障。
 */
let globalHandlersInstalled = false;

/**
 * 安装 RN 全局错误处理器。
 *
 * RN 的全局错误入口是 `ErrorUtils.setGlobalHandler`，而不是浏览器的 `window.onerror`。
 * 未处理的 JS 异常（事件回调、定时器、Promise 回调里的抛错）只会经过这里——不装就等于
 * 完全不留痕。
 *
 * 同时兜住未处理的 Promise 拒绝：RN 没有浏览器的 `unhandledrejection`，但
 * `@react-native-community/netinfo` 等库以及我们自己的 fire-and-forget 调用会产出拒绝，
 * 它们默认只打印一行。
 *
 * 幂等：HMR 下重复执行不会叠加处理器，否则同一次崩溃会被记录多次，反而淹没真实问题。
 */
export function installGlobalErrorHandlers(): void {
  if (globalHandlersInstalled) return;
  globalHandlersInstalled = true;

  const errorUtils = (
    globalThis as {
      ErrorUtils?: {
        getGlobalHandler?: () => ((error: unknown, isFatal?: boolean) => void) | undefined;
        setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
      };
    }
  ).ErrorUtils;

  errorUtils?.setGlobalHandler?.((error: unknown, isFatal?: boolean) => {
    recordMobileError(error, { isFatal: isFatal === true }, 'global');
    // 转发给原处理器：崩溃对话框 / 原生崩溃日志仍需保留，不能因我们记录了就吞掉。
    // 先取出函数再调用，避免 `handler?.call(...)` 这类可选链 + call 的歧义写法。
    const previous = errorUtils.getGlobalHandler?.();
    previous?.(error, isFatal);
  });

  // 未处理拒绝：RN 没有对应事件，挂在全局 Promise  rejections 上只能靠
  // `unhandledrejection` 的 polyfill（部分 RN 版本/库会注入），因此仅在存在时接管。
  const target = globalThis as {
    addEventListener?: (type: string, listener: (event: unknown) => void) => void;
  };
  target.addEventListener?.('unhandledrejection', (event: unknown) => {
    const reason = (event as { reason?: unknown } | undefined)?.reason;
    recordMobileError(reason ?? '未处理的 Promise 拒绝（无 reason）', undefined, 'unhandled-rejection');
  });
}
