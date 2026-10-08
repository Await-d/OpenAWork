/**
 * 客户端错误捕获。
 *
 * 解决「客户端错误没有被记录住、无法排查」的两个根因：
 *
 * 1. **只依赖遥测通道上报**。原实现把全局 `error` 监听挂在遥测授权门禁下
 *    （未同意遥测 / 未登录 → 直接 return），于是绝大多数用户的错误**从未离开过
 *    浏览器控制台**，刷新即丢。这里把错误记录下沉到本地记录器：无论是否授权、
 *    是否登录，错误都会进入环形缓冲并可导出。
 * 2. **漏掉未处理的 Promise 拒绝**。`unhandledrejection` 承载着大量真实故障
 *    （fire-and-forget 的请求、事件回调），此前完全没有采集。
 *
 * 设计约束：
 * - **跨端**：本包同时被浏览器与 React Native 引用，因此不使用 `node:` 模块，
 *   也不直接引用 `window`（RN 无 window），全部通过 `globalThis` + 结构化判断。
 * - **永不抛错**：捕获器自身抛异常会让故障现场二次丢失，因此所有对外调用都吞掉
 *   自身异常（降级为静默），但会保留一条降级记录。
 */

import { redactLogText } from './redaction.js';

const MAX_STACK_CHARS = 8_000;
const MAX_MESSAGE_CHARS = 2_000;
const DEFAULT_CAPACITY = 200;
const DEFAULT_DEDUPE_WINDOW_MS = 3_000;

/** 错误来源。用于区分「谁捕获到的」，排障时决定下一步去哪查。 */
export type ClientErrorSource = 'uncaught' | 'unhandled-rejection' | 'react-boundary' | 'manual';

export interface ClientErrorRecord {
  id: string;
  source: ClientErrorSource;
  name: string;
  message: string;
  stack: string | null;
  occurredAt: number;
  /** 附加定位信息：路由、组件栈、平台等。 */
  context?: Record<string, string>;
}

export type ClientErrorSink = (record: ClientErrorRecord) => void;

export interface DescribeClientErrorResult {
  name: string;
  message: string;
  stack: string | null;
}

/**
 * 把任意 catch 到的值归一化为可记录的结构。
 *
 * `String(err)` 对 `null` / `undefined` / 对象 rejection 都产出无信息量的文本，
 * 是「记录了但看不懂」的常见来源，因此这里逐类型处理。
 */
export function describeClientError(error: unknown): DescribeClientErrorResult {
  if (error instanceof Error) {
    return {
      name: error.name || 'Error',
      message: error.message.slice(0, MAX_MESSAGE_CHARS),
      stack: error.stack ? error.stack.slice(0, MAX_STACK_CHARS) : null,
    };
  }

  if (typeof error === 'string') {
    return { name: 'NonError', message: error.slice(0, MAX_MESSAGE_CHARS), stack: null };
  }

  if (error === null) {
    // `Promise.reject(null)` 的 reason 就是 null——必须显式区分，否则记录出来是空的。
    return { name: 'NonError', message: 'null', stack: null };
  }

  if (error === undefined) {
    // `Promise.reject()` 无参时 reason 就是 undefined。
    return { name: 'NonError', message: 'undefined', stack: null };
  }

  if (typeof error === 'object') {
    const candidate = error as { name?: unknown; message?: unknown; stack?: unknown };
    const name = typeof candidate.name === 'string' ? candidate.name : 'NonError';
    const message =
      typeof candidate.message === 'string' ? candidate.message : safeStringify(error);
    const stack =
      typeof candidate.stack === 'string' ? candidate.stack.slice(0, MAX_STACK_CHARS) : null;
    return { name, message: message.slice(0, MAX_MESSAGE_CHARS), stack };
  }

  // 其余原始值（number / boolean / symbol 等）：走安全序列化而非 `String()`——
// 后者对 Symbol 会直接抛错，把「记录错误」本身变成新的错误源。
return { name: 'NonError', message: safeStringify(error).slice(0, MAX_MESSAGE_CHARS), stack: null };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export interface ClientErrorRecorderOptions {
  /** 环形缓冲容量，超出后丢弃最旧的记录。 */
  capacity?: number;
  /**
   * 去重窗口。React 的嵌套 ErrorBoundary 会为同一次渲染错误逐层调用
   * `componentDidCatch`，同一异常若不去重会在缓冲里出现 N 份，掩盖真实错误数。
   */
  dedupeWindowMs?: number;
  now?: () => number;
}

/**
 * 错误记录器：本地环形缓冲 + 订阅回调。
 *
 * 只做「记录」不做「上报」——上报策略（是否外发、发给谁）由各应用按用户授权
 * 决定，记录必须无条件发生。
 */
export class ClientErrorRecorder {
  private readonly capacity: number;
  private readonly dedupeWindowMs: number;
  private readonly now: () => number;
  private readonly sinks = new Set<ClientErrorSink>();
  private readonly recentKeys = new Map<string, number>();
  private records: ClientErrorRecord[] = [];
  private sequence = 0;

  constructor(options: ClientErrorRecorderOptions = {}) {
    this.capacity = Math.max(1, Math.floor(options.capacity ?? DEFAULT_CAPACITY));
    this.dedupeWindowMs = Math.max(0, Math.floor(options.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS));
    this.now = options.now ?? (() => Date.now());
  }

  /** 订阅记录。返回取消订阅函数。sink 抛异常会被吞掉，不影响记录本身。 */
  subscribe(sink: ClientErrorSink): () => void {
    this.sinks.add(sink);
    return () => {
      this.sinks.delete(sink);
    };
  }

  /**
   * 记录一条错误。返回落库的记录；命中去重窗口时返回 `null`（表示被丢弃）。
   */
  record(input: {
    source: ClientErrorSource;
    error: unknown;
    context?: Record<string, string>;
  }): ClientErrorRecord | null {
    const described = describeClientError(input.error);
    const occurredAt = this.now();

    if (this.isDuplicate(described, occurredAt)) {
      return null;
    }

    this.sequence += 1;
    const record: ClientErrorRecord = {
      id: `client-error-${occurredAt}-${this.sequence}`,
      source: input.source,
      name: described.name,
      message: redactLogText(described.message),
      stack: described.stack ? redactLogText(described.stack) : null,
      occurredAt,
      ...(input.context && Object.keys(input.context).length > 0
        ? { context: sanitizeContext(input.context) }
        : {}),
    };

    this.records.push(record);
    if (this.records.length > this.capacity) {
      this.records.shift();
    }

    for (const sink of this.sinks) {
      try {
        sink(record);
      } catch {
        // sink 失败不能影响记录落库——记录器是最后一道防线。
      }
    }

    return record;
  }

  list(): ClientErrorRecord[] {
    return [...this.records];
  }

  count(): number {
    return this.records.length;
  }

  clear(): void {
    this.records = [];
    this.recentKeys.clear();
  }

  /**
   * 导出为可粘贴文本。
   *
   * 这是「无法排查」的直接解药：用户反馈问题时附上这段文本，即可还原错误名、
   * 消息、堆栈与发生时间，不必依赖开发者能否连上对方的浏览器控制台。
   */
  toText(): string {
    if (this.records.length === 0) {
      return '（未捕获到客户端错误）';
    }
    const lines: string[] = [`客户端错误记录（${this.records.length} 条）`];
    for (const record of this.records) {
      lines.push('');
      lines.push(`[${new Date(record.occurredAt).toISOString()}] ${record.source} ${record.name}`);
      lines.push(`消息：${record.message}`);
      if (record.context) {
        for (const [key, value] of Object.entries(record.context)) {
          lines.push(`${key}：${value}`);
        }
      }
      if (record.stack) {
        lines.push('堆栈：');
        lines.push(record.stack);
      }
    }
    return lines.join('\n');
  }

  private isDuplicate(described: DescribeClientErrorResult, occurredAt: number): boolean {
    if (this.dedupeWindowMs === 0) {
      return false;
    }
    // 只取堆栈首帧参与去重：同一异常的不同实例首帧一致，而不同异常即使
    // message 相同、首帧也通常不同。
    const topFrame = described.stack?.split('\n')[1]?.trim() ?? '';
    const key = `${described.name}|${described.message}|${topFrame}`;

    for (const [seenKey, seenAt] of this.recentKeys) {
      if (occurredAt - seenAt > this.dedupeWindowMs) {
        this.recentKeys.delete(seenKey);
      }
    }

    if (this.recentKeys.has(key)) {
      return true;
    }
    this.recentKeys.set(key, occurredAt);
    return false;
  }
}

function sanitizeContext(context: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(context)) {
    result[key] = redactLogText(String(value).slice(0, MAX_MESSAGE_CHARS));
  }
  return result;
}

/** 最小可用的全局事件目标形态（浏览器 window / RN 全局都可能满足，也可能都没有）。 */
interface GlobalEventTargetLike {
  addEventListener?: (type: string, listener: (event: never) => void) => void;
  removeEventListener?: (type: string, listener: (event: never) => void) => void;
}

export interface InstallGlobalErrorCaptureOptions {
  recorder: ClientErrorRecorder;
  /** 目标对象；默认 `globalThis`。 */
  target?: GlobalEventTargetLike;
  /** 附加到每条记录的定位信息（例如当前路由）。 */
  buildContext?: () => Record<string, string> | undefined;
}

/**
 * 安装全局错误捕获：`error` + `unhandledrejection`。
 *
 * 返回卸载函数。在不支持 `addEventListener` 的环境（如 React Native）返回空函数
 * 而不是抛错——移动端有独立的 Sentry 通道。
 */
export function installGlobalErrorCapture(
  options: InstallGlobalErrorCaptureOptions,
): () => void {
  const target = options.target ?? (globalThis as unknown as GlobalEventTargetLike);
  if (!target || typeof target.addEventListener !== 'function') {
    return () => undefined;
  }

  const safeContext = (): Record<string, string> | undefined => {
    try {
      return options.buildContext?.();
    } catch {
      return undefined;
    }
  };

  const handleErrorEvent = (event: never): void => {
    const candidate = event as unknown as Record<string, unknown> | null | undefined;
    const error = candidate?.['error'];
    const rawMessage = candidate?.['message'];
    const filename = candidate?.['filename'];
    const lineno = candidate?.['lineno'];
    // 非 JS 抛出的错误（资源加载失败等）没有 `error` 字段，只能退化为事件自带的
    // message；仍取不到时给出明确文案，而不是产出无信息量的 "[object Object]"。
    const fallbackMessage =
      typeof rawMessage === 'string' && rawMessage.length > 0
        ? rawMessage
        : '未捕获的运行时错误';

    options.recorder.record({
      source: 'uncaught',
      error: error ?? fallbackMessage,
      context: {
        ...safeContext(),
        ...(typeof filename === 'string'
          ? { location: `${filename}:${typeof lineno === 'number' ? lineno : 0}` }
          : {}),
      },
    });
  };

  const handleRejection = (event: never): void => {
    const candidate = event as unknown as Record<string, unknown>;
    options.recorder.record({
      source: 'unhandled-rejection',
      error: candidate?.['reason'] ?? '未处理的 Promise 拒绝（无 reason）',
      context: safeContext(),
    });
  };

  target.addEventListener('error', handleErrorEvent);
  target.addEventListener('unhandledrejection', handleRejection);

  return () => {
    target.removeEventListener?.('error', handleErrorEvent);
    target.removeEventListener?.('unhandledrejection', handleRejection);
  };
}