/**
 * 并发门控（信号量 + 排队）——用于大文件预览。
 *
 * ## 为什么不用 `workspace-request-throttle`
 *
 * 那是一个**速率**限制（滑动窗口内 N 次/分钟），适合压制 `files/search` 那种
 * 「一次请求 = 一次全工作区 walk」的放大。但大文件预看的流量形态完全不同：
 * 用户在文件树里快速点过 10 个 2MB 的文件是**正常**行为，用速率限制会误伤；
 * 真正要防的是这些请求**同时在飞**——10 × 10MB 同时解码进浏览器，峰值内存可以
 * 到百 MB 级。所以这里要限制的是并发数，不是请求频率。
 *
 * ## 行为
 *
 * - 未达上限：立即拿到许可，零额外延迟（绝大多数小文件走这条路）。
 * - 达上限：**排队等待**而不是报错。正常浏览体验下只是稍慢，优于 429。
 * - 队列已满 / 等待超时：返回不可用，由调用方转 429 + `Retry-After`。队列本身
 *   必须有界，否则一次恶意洪泛会把排队本身变成新的内存问题。
 *
 * ## 内存
 *
 * 进程内实现，依赖与现有限流器一致的前提：网关单进程。key 数量以
 * `maxKeys` 硬上限兜底（淘汰最久未活跃的 key），且某个 key 的并发归零、队列
 * 清空时立即删除，因此空闲状态不残留条目。
 */

export interface PreviewConcurrencyGateOptions {
  /** 单个 key 允许的同时在飞数量。 */
  limit: number;
  /** 单个 key 允许的排队等待数，超出直接判定不可用。 */
  maxQueue: number;
  /** 排队等待的最长时间，超时后调用方应拒绝该请求。 */
  acquireTimeoutMs: number;
  /** 注入时钟，便于确定性测试。默认 `Date.now`。 */
  now?: () => number;
  /** 跟踪 key 的硬上限（抗 key 洪泛）。默认 1_000。 */
  maxKeys?: number;
}

export interface PreviewConcurrencyGateResult {
  /** 拿到许可时为 true，并附带必须在 `finally` 中调用的释放函数。 */
  ok: boolean;
  /** 许可的释放函数；未获许可时为 undefined。 */
  release?: () => void;
  /** 不可用时给出的建议重试等待时间（ms）。 */
  retryAfterMs?: number;
}

interface Waiter {
  resolve: (gateResult: PreviewConcurrencyGateResult) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

interface KeyState {
  inFlight: number;
  lastActiveAt: number;
  queue: Waiter[];
}

const DEFAULT_MAX_KEYS = 1_000;

export function createPreviewConcurrencyGate(options: PreviewConcurrencyGateOptions): {
  acquire(key: string): Promise<PreviewConcurrencyGateResult>;
  reset(): void;
  inFlight(key: string): number;
  queued(key: string): number;
  size(): number;
} {
  const { limit, maxQueue, acquireTimeoutMs } = options;
  const now = options.now ?? (() => Date.now());
  const maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
  const states = new Map<string, KeyState>();

  /**
   * 为新 key 腾出空间：**只**淘汰空闲条目。
   *
   * 早期实现按「最久未活跃」无条件淘汰，会把仍在服务的 key 连同它队列里的
   * 等待者一起丢掉——那些 Promise 永远不会 settle，请求就挂到 HTTP 超时为止。
   * 因此这里只动 `inFlight === 0 && queue.length === 0` 的条目；若一个空闲名额
   * 都腾不出来，就让**新** key 直接被拒，而不是牺牲已在途的请求。
   *
   * @returns 是否已腾出至少一个名额
   */
  function evictIdle(): boolean {
    if (states.size < maxKeys) return true;
    for (const [key, state] of states) {
      if (state.inFlight === 0 && state.queue.length === 0) {
        states.delete(key);
      }
      if (states.size < maxKeys) return true;
    }
    return false;
  }

  function settleWaiter(key: string, state: KeyState, waiter: Waiter): void {
    if (waiter.timer !== null) {
      clearTimeout(waiter.timer);
    }
    state.inFlight += 1;
    state.lastActiveAt = now();
    waiter.resolve({ ok: true, release: () => release(key) });
  }

  function release(key: string): void {
    const state = states.get(key);
    if (!state) return;
    state.inFlight = Math.max(0, state.inFlight - 1);
    state.lastActiveAt = now();

    const next = state.queue.shift();
    if (next) {
      settleWaiter(key, state, next);
      return;
    }
    // 空闲即删除：key 不在 map 里停留，避免长期运行后残留大量空条目。
    if (state.inFlight === 0) {
      states.delete(key);
    }
  }

  async function acquire(key: string): Promise<PreviewConcurrencyGateResult> {
    const nowMs = now();
    const existing = states.get(key);

    if (!existing) {
      if (!evictIdle()) {
        // 跟踪表已满且全是在途请求：拒绝新 key，不驱逐在途请求。
        return { ok: false, retryAfterMs: acquireTimeoutMs };
      }
      states.set(key, { inFlight: 1, lastActiveAt: nowMs, queue: [] });
      return { ok: true, release: () => release(key) };
    }

    existing.lastActiveAt = nowMs;

    if (existing.inFlight < limit) {
      existing.inFlight += 1;
      return { ok: true, release: () => release(key) };
    }

    if (existing.queue.length >= maxQueue) {
      return { ok: false, retryAfterMs: acquireTimeoutMs };
    }

    return new Promise<PreviewConcurrencyGateResult>((resolve) => {
      const waiter: Waiter = { resolve, timer: null };
      waiter.timer = setTimeout(() => {
        // 超时后把自己摘出队列，否则会占着一个槽位却永不消费。
        const index = existing.queue.indexOf(waiter);
        if (index >= 0) {
          existing.queue.splice(index, 1);
        }
        resolve({ ok: false, retryAfterMs: 1 });
      }, acquireTimeoutMs);
      existing.queue.push(waiter);
    });
  }

  return {
    acquire,
    reset(): void {
      for (const state of states.values()) {
        for (const waiter of state.queue) {
          if (waiter.timer !== null) {
            clearTimeout(waiter.timer);
          }
        }
      }
      states.clear();
    },
    inFlight(key: string): number {
      return states.get(key)?.inFlight ?? 0;
    },
    queued(key: string): number {
      return states.get(key)?.queue.length ?? 0;
    },
    size(): number {
      return states.size;
    },
  };
}
