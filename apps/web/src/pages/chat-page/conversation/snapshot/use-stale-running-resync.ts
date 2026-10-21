/**
 * 「running 但持续无活跃流」的检测与恢复入口（"批准后卡住"的客户端兜底）。
 *
 * 背景：权限 reply 路由把会话置为 running 后以 fire-and-forget 触发 resume；若 resume
 * 早期失败未能把状态收敛回 idle（网关侧已由 `stream-runtime.ts` 的
 * `convergeSessionStateAfterFailedResume` 覆盖已知抛点），会话会永远停在 running
 * 却没有活跃流——客户端 attach 重试全部落空、恢复轮询无限循环、发送键长期禁用。
 *
 * 这里是纵深防御：状态持续异常超过阈值时给用户一个可操作的「重新同步」——调网关
 * `POST /sessions/:id/stream/stop-active` 权威收敛（stopAnyInFlight + cancelPending
 * + reconcileSessionRuntime）后刷新本地快照。该端点在没有活跃流时是纯状态修复，
 * 语义安全；阈值（60s）覆盖 attach 重试（8 次指数退避）的正常上限，正常续跑不会
 * 误触发。
 *
 * 实现要点：计时与复位必须住在**同一个** effect 里。拆成两个 effect 时，后声明的
 * 「会话切换复位」effect 会在同一提交里把计时 effect 刚写入的起点清成 null，interval
 * 回调从此永远读不到起点——stale 永远不会置 true（回归测试覆盖）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/** running 且持续无活跃流的判定阈值。 */
export const STALE_RUNNING_THRESHOLD_MS = 60_000;

const STALE_RUNNING_TICK_MS = 1_000;

interface StaleRunningEntry {
  sessionId: string | null;
  since: number;
}

export interface UseStaleRunningResyncOptions {
  /** 当前会话是否存在活跃流（`recoveryActiveStream !== null`）。 */
  hasActiveStream: boolean;
  /** 页面是否可见；不可见时不累计计时（回到前台重新起算）。 */
  isPageActive: boolean;
  /** 「重新同步」动作：收敛服务端状态并刷新本地快照。 */
  onResync: () => Promise<void> | void;
  sessionId: string | null;
  /** 远端会话忙状态；仅 running 参与判定（paused 是等待用户交互的正常态）。 */
  status: 'running' | 'paused' | null | undefined;
}

export interface StaleRunningResync {
  /** 是否应展示「重新同步」入口。 */
  stale: boolean;
  /** 点击「重新同步」；内部串行化并重置计时。 */
  resync: () => void;
}

/**
 * 「重新同步」动作的统一包装：try → finally 收尾（**无 catch**：异常沿 promise 链上抛，
 * 与原语义一致）。
 *
 * 必须留在模块级：React Compiler 1.0.0 不支持「无 catch 的 try」与 finally 子句，本 hook
 * 这处 try 会让整个 hook 脱靶（实测）。语义逐字照搬。
 */
async function runResyncOnce(ctx: {
  onFinally: () => void;
  run: () => Promise<void>;
}): Promise<void> {
  try {
    await ctx.run();
  } finally {
    ctx.onFinally();
  }
}

export function useStaleRunningResync(options: UseStaleRunningResyncOptions): StaleRunningResync {
  const { hasActiveStream, isPageActive, onResync, sessionId, status } = options;
  const [stale, setStale] = useState(false);
  const staleSinceRef = useRef<StaleRunningEntry | null>(null);
  const resyncingRef = useRef(false);

  const isCandidate = isPageActive && status === 'running' && !hasActiveStream;

  // 计时 + 全部复位路径合并且仅此一个 effect：
  //   - 候选态中断（活跃流出现 / 状态变化 / 页面切后台）→ 清空起点、stale 归位；
  //   - 会话切换 → 同样重新起算（即使新旧会话同为候选态）；
  //   - 依赖 [isCandidate, sessionId]：任一变化都会重跑，无需第二个 effect。
  useEffect(() => {
    if (!isCandidate) {
      staleSinceRef.current = null;
      setStale(false);
      return;
    }

    if (staleSinceRef.current !== null && staleSinceRef.current.sessionId !== sessionId) {
      // 会话切换：起点作废重新起算，已置位的 stale 也必须归位（否则旧会话的
      // 「重新同步」按钮会继续挂在新会话上）。
      staleSinceRef.current = null;
      setStale(false);
    }
    if (staleSinceRef.current === null) {
      staleSinceRef.current = { sessionId, since: Date.now() };
    }

    const timer = window.setInterval(() => {
      const entry = staleSinceRef.current;
      if (entry !== null && Date.now() - entry.since >= STALE_RUNNING_THRESHOLD_MS) {
        setStale(true);
      }
    }, STALE_RUNNING_TICK_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [isCandidate, sessionId]);

  const resync = useCallback(() => {
    if (resyncingRef.current) {
      return;
    }
    resyncingRef.current = true;
    void (async () => {
      // try/finally 下沉到模块级 `runResyncOnce`（见其注释）。
      await runResyncOnce({
        onFinally: () => {
          resyncingRef.current = false;
          // 重新计时：给服务端收敛与随后几轮刷新留出窗口，避免按钮秒级重现。
          staleSinceRef.current = { sessionId, since: Date.now() };
          setStale(false);
        },
        run: async () => {
          await onResync();
        },
      });
    })();
  }, [onResync, sessionId]);

  return { resync, stale };
}
