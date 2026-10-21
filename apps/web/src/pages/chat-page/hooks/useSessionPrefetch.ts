/**
 * useSessionPrefetch — 会话预取缓存 hook（W4-04）
 *
 * 策略（借鉴 OpenCode layout.tsx:630-792）：
 *   - 当前会话前后各 4 条会话预取消息数据
 *   - 并发控制：最多 2 路并发
 *   - LRU 淘汰：每工作区最多缓存 10 条会话
 *   - 切换会话时可从缓存直接渲染，无闪烁
 *
 * 预取数据来源：
 *   通过 createSessionsClient(gatewayUrl).getRecovery(token, sessionId, { messageLimit: 200 })
 *   获取会话快照（与 ChatPage 主加载路径复用同一接口，不改后端）。
 *
 * 使用：
 *   const { getCached, prefetching } = useSessionPrefetch({
 *     sessions, currentSessionId, workspacePath, gatewayUrl, token
 *   });
 *   // 切换会话时检查缓存
 *   const cached = getCached(sessionId);
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createSessionsClient } from '@openAwork/web-client';
import type { SessionRecoveryReadModel } from '@openAwork/web-client';

// ─── 常量 ─────────────────────────────────────────────────────────────────────

/** 前后各预取几条会话 */
const PREFETCH_SPAN = 4;
/** 每工作区最多缓存几条会话 */
const PREFETCH_MAX_PER_WORKSPACE = 10;
/** 并发限制 */
const PREFETCH_CONCURRENCY = 2;
/** 每次预取的消息数上限 */
const PREFETCH_MESSAGE_LIMIT = 200;

// ─── 类型 ─────────────────────────────────────────────────────────────────────

export interface PrefetchSession {
  readonly id: string;
  readonly workspacePath?: string | null;
}

export interface UseSessionPrefetchOptions {
  /** 当前工作区下的会话列表（用于计算前后 N 条） */
  sessions: readonly PrefetchSession[];
  /** 当前活跃会话 ID */
  currentSessionId: string | null;
  /** 当前工作区路径（用于 LRU 桶隔离） */
  workspacePath: string | null;
  /** Gateway URL */
  gatewayUrl: string;
  /** 认证 token */
  token: string | null;
}

export interface UseSessionPrefetchResult {
  /**
   * 从缓存获取会话数据。
   * 返回 null 表示缓存未命中，需正常加载。
   */
  getCached: (sessionId: string) => SessionRecoveryReadModel | null;
  /** 当前正在预取中的会话 ID 集合 */
  prefetching: ReadonlySet<string>;
}

// ─── LRU Map 工具 ─────────────────────────────────────────────────────────────

/**
 * LRU 缓存：Map 按插入顺序迭代，最旧的在最前，淘汰时删除第一个。
 * 访问（get）时将 key 移到末尾（先删后插）。
 */
class LRUCache<V> {
  private readonly map = new Map<string, V>();
  constructor(private readonly maxSize: number) {}

  get(key: string): V | undefined {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key) as V;
    // 访问时刷新到末尾
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    }
    this.map.set(key, value);
    if (this.map.size > this.maxSize) {
      // 删除最旧的（第一个 key）
      const firstKey = this.map.keys().next().value;
      if (firstKey !== undefined) {
        this.map.delete(firstKey);
      }
    }
  }

  has(key: string): boolean {
    return this.map.has(key);
  }
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useSessionPrefetch({
  sessions,
  currentSessionId,
  workspacePath,
  gatewayUrl,
  token,
}: UseSessionPrefetchOptions): UseSessionPrefetchResult {
  // 按工作区隔离的 LRU 缓存，workspacePath → LRUCache<SessionRecoveryReadModel>
  const cacheByWorkspace = useRef(new Map<string, LRUCache<SessionRecoveryReadModel>>());

  // 正在飞行中的请求（防重）
  const inflightRef = useRef(new Set<string>());
  // 并发计数
  const runningCountRef = useRef(0);
  // 挂起队列
  const pendingQueueRef = useRef<string[]>([]);
  // 当前正在预取的 ID 集合（用于暴露给外部）。
  // 用 state 而非 ref：该值在返回语句里被渲染期读取（渲染期读 ref 会被编译器判为
  // "Cannot access refs during render" 而放弃优化整个 hook），且 state 让「预取中」
  // 变化能真正驱动消费方重渲染（ref 版本对消费方只是陈旧快照）。
  const [prefetching, setPrefetching] = useState<ReadonlySet<string>>(() => new Set<string>());

  const getWorkspaceCache = useCallback(
    (wsPath: string | null): LRUCache<SessionRecoveryReadModel> => {
      const key = wsPath ?? '__default__';
      let cache = cacheByWorkspace.current.get(key);
      if (!cache) {
        cache = new LRUCache<SessionRecoveryReadModel>(PREFETCH_MAX_PER_WORKSPACE);
        cacheByWorkspace.current.set(key, cache);
      }
      return cache;
    },
    [],
  );

  const getCached = useCallback(
    (sessionId: string): SessionRecoveryReadModel | null => {
      return getWorkspaceCache(workspacePath).get(sessionId) ?? null;
    },
    [getWorkspaceCache, workspacePath],
  );

  /**
   * `processQueue` 的自我调度桥（trampoline）。
   *
   * `finally` 里要再排一次队列，直接写 `processQueue()` 属于「`const` 回调在自身
   * 初始化器内自引用」，React Compiler 判为 "Cannot access variable before it is
   * declared"（TDZ）并放弃优化整个 hook。改为 ref 持有 + effect 同步
   * （与 scroll/use-scroll-intent.ts 同一惯用法）：只在异步回调里取值，
   * 渲染期不读 ref。
   */
  const processQueueRef = useRef<() => void>(() => {});

  const processQueue = useCallback((): void => {
    const queue = pendingQueueRef.current;
    while (queue.length > 0 && runningCountRef.current < PREFETCH_CONCURRENCY) {
      const nextId = queue.shift();
      if (!nextId) continue;

      if (inflightRef.current.has(nextId)) continue;

      const cache = getWorkspaceCache(workspacePath);
      if (cache.has(nextId)) continue;

      if (!token) continue;

      runningCountRef.current += 1;
      inflightRef.current.add(nextId);
      setPrefetching((prev) => {
        const next = new Set(prev);
        next.add(nextId);
        return next;
      });

      const client = createSessionsClient(gatewayUrl);

      void client
        .getRecovery(token, nextId, { messageLimit: PREFETCH_MESSAGE_LIMIT })
        .then((data) => {
          getWorkspaceCache(workspacePath).set(nextId, data);
        })
        .catch(() => {
          // 预取失败不影响主流程，静默忽略
        })
        .finally(() => {
          runningCountRef.current -= 1;
          inflightRef.current.delete(nextId);
          setPrefetching((prev) => {
            const next = new Set(prev);
            next.delete(nextId);
            return next;
          });
          processQueueRef.current();
        });
    }
  }, [gatewayUrl, getWorkspaceCache, token, workspacePath]);

  // 与 processQueueRef 配对：首个 commit 内同步；请求必然晚于挂载，取值总为最新实例。
  useEffect(() => {
    processQueueRef.current = processQueue;
  }, [processQueue]);

  useEffect(() => {
    if (!currentSessionId || !token) return;

    const currentIndex = sessions.findIndex((s) => s.id === currentSessionId);
    if (currentIndex === -1) return;

    // 计算前后各 PREFETCH_SPAN 条 session 的 ID
    const targets: string[] = [];
    for (let delta = -PREFETCH_SPAN; delta <= PREFETCH_SPAN; delta++) {
      if (delta === 0) continue;
      const idx = currentIndex + delta;
      if (idx < 0 || idx >= sessions.length) continue;
      const session = sessions[idx];
      if (!session) continue;
      if (session.id === currentSessionId) continue;

      const cache = getWorkspaceCache(workspacePath);
      if (cache.has(session.id)) continue;
      if (inflightRef.current.has(session.id)) continue;

      targets.push(session.id);
    }

    if (targets.length === 0) return;

    // 将新目标加入队列（去重）
    const queue = pendingQueueRef.current;
    for (const id of targets) {
      if (!queue.includes(id)) {
        queue.push(id);
      }
    }

    processQueue();
  }, [currentSessionId, sessions, token, workspacePath, getWorkspaceCache, processQueue]);

  return {
    getCached,
    prefetching,
  };
}
