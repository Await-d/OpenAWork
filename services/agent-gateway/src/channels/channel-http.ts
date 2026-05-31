/**
 * 消息渠道共享 HTTP 工具。
 *
 * 各渠道（Telegram / Discord / Feishu / DingTalk / WeCom / QQ / WhatsApp
 * / Slack）此前都直接用裸 `fetch` 调上游开放平台，没有超时控制：一旦
 * 上游连接挂起（TCP 黑洞、对端不回包），发送会永久 pending，后台轮询循
 * 环也会被卡死且无法靠 `stop()` 回收。本模块提供统一的：
 *
 *   1. `channelFetch` —— 带超时的 fetch，超时即 abort 并抛出可识别错误；
 *      支持透传调用方的 `AbortSignal`（与超时信号合并），便于 `stop()`
 *      主动取消在途请求。
 *   2. `computeChannelRetryDelayMs` —— 轮询失败后的指数退避（带上限），
 *      替代「出错后固定 1s 紧重试」会在持续故障时打爆上游的行为。
 *
 * 仅依赖标准 `fetch` / `AbortController`，保持纯 ESM、无三方依赖。
 */

/** 默认请求超时：覆盖发送 / token 刷新等短交互。 */
export const CHANNEL_FETCH_TIMEOUT_MS = 15_000;

/** 轮询退避初始值。 */
export const CHANNEL_POLL_BACKOFF_INITIAL_MS = 1_000;
/** 轮询退避上限，避免持续故障时无限拉长。 */
export const CHANNEL_POLL_BACKOFF_MAX_MS = 30_000;
/** 退避指数因子。 */
export const CHANNEL_POLL_BACKOFF_FACTOR = 2;

/**
 * 渠道请求超时错误。`channelFetch` 在自身超时触发 abort 时抛出此类，
 * 以便调用方把「我们主动超时」与「调用方 signal 取消」「上游真实网络
 * 错误」区分开来。
 */
export class ChannelFetchTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`channel request timed out after ${timeoutMs}ms`);
    this.name = 'ChannelFetchTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export interface ChannelFetchOptions extends RequestInit {
  /** 覆盖默认超时；<= 0 表示不加超时（极少用，谨慎）。 */
  timeoutMs?: number;
}

/**
 * 带超时的 `fetch`。
 *
 * - 到达 `timeoutMs` 仍未返回时 abort 底层请求并抛 `ChannelFetchTimeoutError`。
 * - 若调用方通过 `init.signal` 传入了自己的 signal，会与超时信号合并：
 *   任一触发都会取消请求；调用方主动取消时按原始 `AbortError` 抛出。
 * - 始终清理定时器与监听器，避免句柄泄漏。
 */
export async function channelFetch(
  url: string,
  options: ChannelFetchOptions = {},
): Promise<Response> {
  const { timeoutMs = CHANNEL_FETCH_TIMEOUT_MS, signal: callerSignal, ...init } = options;

  if (timeoutMs <= 0) {
    return fetch(url, { ...init, ...(callerSignal ? { signal: callerSignal } : {}) });
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onCallerAbort = (): void => {
    controller.abort();
  };
  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort();
    } else {
      callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    }
  }

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    // 我们自己的超时优先于底层 AbortError 暴露给调用方。
    if (timedOut && !(callerSignal?.aborted ?? false)) {
      throw new ChannelFetchTimeoutError(timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (callerSignal) {
      callerSignal.removeEventListener('abort', onCallerAbort);
    }
  }
}

/**
 * 计算轮询失败后的退避时长（1-indexed 的 `attempt`）。指数增长并封顶，
 * 让持续故障时的重试间隔逐步拉开而不是恒定紧逼上游。
 */
export function computeChannelRetryDelayMs(attempt: number): number {
  const normalized = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 1;
  const raw =
    CHANNEL_POLL_BACKOFF_INITIAL_MS * Math.pow(CHANNEL_POLL_BACKOFF_FACTOR, normalized - 1);
  return Math.min(raw, CHANNEL_POLL_BACKOFF_MAX_MS);
}
