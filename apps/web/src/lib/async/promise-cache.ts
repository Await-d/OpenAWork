/**
 * promise-cache —— 让 `use(promise)` + `<Suspense>` 可用的最小 promise 缓存层。
 *
 * ## 为什么需要它
 *
 * React 的 `use()` 要求传入的 promise **在重渲染之间保持同一个实例**。如果在渲染期
 * 直接创建 promise（例如 `use(fetch(url))`），每次重渲染都会产生新 promise，
 * 于是「挂起 → 重渲染 → 新 promise → 再挂起」形成无限 Suspense 循环。
 *
 * 本模块把「同步写入缓存」作为核心不变量：`get()` 在**调用 load 之前**就先把
 * promise 放进缓存，所以后续任何重渲染拿到的都是同一个实例。
 *
 * ## 什么时候用它
 *
 * - 一次性的取数（模块级资源、目录清单、静态配置等），配合父级 `<Suspense>`；
 * - 需要跨组件**复用同一个请求结果**，避免各自发一次。
 *
 * ## 什么时候不要用它
 *
 * - 需要轮询 / 实时刷新的数据（用流式状态或专门的实时层）；
 * - 提交表单、写操作（走 `useActionState`，不要塞进缓存）；
 * - 需要细粒度失效 / 乐观更新 / 分页的场景——本模块刻意保持最小。
 *
 * ## 职责边界
 *
 * 本模块**不发起任何网络请求**，只负责「同一 key 只取一次」。真正的取数函数由调用方
 * 传入，且必须走 `@openAwork/web-client` 的客户端（见 AGENTS.md 禁止事项）。
 */

export interface PromiseCacheOptions {
  /**
   * 缓存值与在途 promise 的存活时间（毫秒）。
   *
   * 省略或设为 `Infinity` 表示永不过期——适合静态资源；动态数据请显式给出一个
   * 合理值，否则会长期读到陈旧数据。
   */
  readonly ttlMs?: number;
}

interface CacheEntry<V> {
  readonly promise: Promise<V>;
  /** 结算时间戳（成功或失败），用于 TTL 判定。未结算为 null。 */
  settledAt: number | null;
}

export interface PromiseCache<V> {
  /**
   * 取缓存；未命中（或已过期）时调用 `load` 取数并缓存。
   *
   * 实现保证：**同一个 key 返回同一个 promise 实例**，直到该条目被结算后过期、
   * 被 `invalidate` / `clear`，或 `load` 失败被自动移除。
   */
  get(key: string, load: () => Promise<V>): Promise<V>;
  /** 只读查询，未命中或已过期返回 `undefined`；**不会**触发取数。 */
  peek(key: string): Promise<V> | undefined;
  /** 预先写入一个已知值（同步可用），常用于把已有数据预热进缓存。 */
  prime(key: string, value: V): void;
  /** 移除单个条目。在途 promise 不会被取消，只是不再被本缓存复用。 */
  invalidate(key: string): void;
  clear(): void;
  /** 当前缓存的条目数（含在途）。 */
  readonly size: number;
}

/**
 * 创建一个 promise 缓存。
 *
 * 失败语义：`load` 抛错 / reject 时条目会被**立即移除**，这样重试（例如错误边界
 * 重置后再次渲染）能重新取数，而不是把 rejection 永久缓存住。
 */
export function createPromiseCache<V>(options: PromiseCacheOptions = {}): PromiseCache<V> {
  const { ttlMs = Number.POSITIVE_INFINITY } = options;
  const entries = new Map<string, CacheEntry<V>>();

  const isExpired = (entry: CacheEntry<V>, now: number): boolean => {
    if (entry.settledAt === null) return false;
    if (ttlMs === Number.POSITIVE_INFINITY) return false;
    return now - entry.settledAt >= ttlMs;
  };

  const read = (key: string): CacheEntry<V> | undefined => {
    const entry = entries.get(key);
    if (entry === undefined) return undefined;
    if (isExpired(entry, Date.now())) {
      entries.delete(key);
      return undefined;
    }
    return entry;
  };

  const track = (key: string, promise: Promise<V>): CacheEntry<V> => {
    const entry: CacheEntry<V> = { promise, settledAt: null };
    entries.set(key, entry);
    promise.then(
      () => {
        // 只有仍是当前条目时才写入结算时间，避免被 invalidate 后「复活」。
        if (entries.get(key) === entry) entry.settledAt = Date.now();
      },
      () => {
        if (entries.get(key) === entry) entries.delete(key);
      },
    );
    return entry;
  };

  return {
    get(key, load) {
      const cached = read(key);
      if (cached !== undefined) return cached.promise;

      // 关键：先同步写入缓存，再启动取数。用 `then` 构造而不是 async 函数，
      // 是为了保证 `get` 返回时缓存里已有该 promise 实例——这是 `use()` 不循环的前提。
      const promise = Promise.resolve().then(load);
      return track(key, promise).promise;
    },

    peek(key) {
      return read(key)?.promise;
    },

    prime(key, value) {
      track(key, Promise.resolve(value));
    },

    invalidate(key) {
      entries.delete(key);
    },

    clear() {
      entries.clear();
    },

    get size() {
      return entries.size;
    },
  };
}
