/**
 * 端口页数据源（T-13，TASK 2；P0 增补手动刷新 / 暂停）：挂载取数 + **仅在可见且未暂停时**轮询。
 *
 * 状态机（周期 = `PORTS_POLL_INTERVAL_MS`）：
 *  - `loading` —— 首次取数（含用户「重试」）进行中。轮询 / 手动刷新**不会**回到这里：
 *    列表每 5s 闪一次 spinner 比数据不新鲜更糟（静默刷新，只换数据）。
 *  - `ready` —— 成功。**请求完成后**才排下一次（不是固定 `setInterval`）：单飞，
 *    慢响应不会堆叠请求，周期自然成为「间隔 + 延迟」。
 *  - `error` —— 失败即**停止轮询**（失败闩锁）：对端已经坏了，5s 一次地打失败接口
 *    既拿不到数据又会持续放大网关压力；恢复权交给用户点「重试」，重试成功后
 *    自动恢复轮询。
 *
 * P0 状态机增量（两个手动入口的边界必须保持清晰）：
 *  - `retry()` —— **唯一**能解除失败闩锁的入口：重跑 effect、状态回到 `loading`，
 *    适合「上一轮就是坏的，重来一次」；成功后才恢复轮询。
 *  - `refresh()` —— 成功态的手动刷新：与轮询共用同一条**静默**路径（不闪回 `loading`），
 *    完成后重新计时下一拍。在途请求未归时被单飞守卫吞掉（不排队：连点刷新不应该
 *    放大成多个请求）；失败闩锁置位时是 no-op —— 错误态展示的是「重试」，
 *    闩锁的解除权只归 `retry()`。
 *  - `paused` / `togglePaused()` —— 用户暂停自动刷新（读列表时不被 5s 一次的重新排序
 *    打断）：暂停只清掉「待触发的下一拍」，**在途请求照常收尾**并按结果更新状态；
 *    暂停期间 `refresh()` 仍然可用（用户主动取数不受自动轮询的暂停约束）。
 *    `togglePaused()` 恢复时只从当下重新计时（不立刻拉一次）：用户点「继续」要的是
 *    恢复自动刷新，想立刻取数可以点「刷新」。
 *    边界：暂停只拦「排下一拍」，不改「恢复可见立刻拉一次」的既有语义 —— 标签页从
 *    隐藏回到可见是一次性补数（数据必然已过期），不是周期性打扰；也不拦 `refresh()`。
 *
 * 暂停条件（互相独立，任一成立即不排下一拍）：
 *  - `document.visibilityState === 'hidden'`（浏览器标签页不可见）—— 监听
 *    `visibilitychange`，恢复可见时立刻拉一次；在途请求照常收尾，不产生孤儿状态。
 *  - 用户暂停（`togglePaused`）。
 *  - 「切到终端页签」由调用方卸载本面板达成（`QuickTerminalPanel` 的页签是真切换
 *    内容而不是 CSS 隐藏），卸载即清定时器与监听。
 *
 * 「暂停」是面板本地视图状态：页签切走会卸载面板、暂停随之失效 —— 有意不把临时
 * 视图偏好写进 store（端口页只在页签激活时挂载）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createListeningPortsClient, type ListeningPortsSnapshotView } from '@openAwork/web-client';

/** 端口页轮询周期（仅「端口」页签可见 + 浏览器标签页可见 + 未暂停时运行）。 */
export const PORTS_POLL_INTERVAL_MS = 5_000;

/** 「更新于 N 秒前」文案的刷新粒度：只更新文案，不重新请求。 */
export const PORTS_AGE_TICK_MS = 1_000;

export type TerminalPortsFeedState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; snapshot: ListeningPortsSnapshotView };

export interface TerminalPortsFeed {
  state: TerminalPortsFeedState;
  /** 用户点「重试」：清掉失败闩锁 → 立刻重新取数，成功后自动恢复轮询。 */
  retry(): void;
  /** 用户点「刷新」：静默取数（不闪回 loading），完成后重新计时下一拍。 */
  refresh(): void;
  /** 自动轮询是否被用户暂停（暂停不影响 `refresh()`）。 */
  paused: boolean;
  togglePaused(): void;
}

function isDocumentVisible(): boolean {
  // 非浏览器环境（无 visibilityState）按可见处理：只跳过「因为不可见而不取数」这一种暂停。
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

interface TerminalPortsFeedCommands {
  refresh(): void;
  setPaused(value: boolean): void;
}

export function useTerminalPortsFeed(gatewayUrl: string, token: string | null): TerminalPortsFeed {
  const [state, setState] = useState<TerminalPortsFeedState>({ status: 'loading' });
  const [retryNonce, setRetryNonce] = useState(0);
  const [paused, setPaused] = useState(false);
  // 暂停标记以 ref 为准：effect 内部要读它，但开关暂停**不能**重跑 effect
  // （重跑会重新走一次 initial 取数并把状态打回 loading）。
  const pausedRef = useRef(false);
  // 命令通道：effect 持有定时器与单飞闩锁等局部状态，外部只能经这个 ref 触达。
  const commandsRef = useRef<TerminalPortsFeedCommands | null>(null);

  useEffect(() => {
    if (token === null) {
      commandsRef.current = null;
      setState({ status: 'error', message: '登录状态未就绪，无法读取监听端口。' });
      return;
    }

    let disposed = false;
    let inFlight = false;
    /** 失败闩锁：置位后不再排下一次轮询，直到用户「重试」（retryNonce 变化重跑本 effect）。 */
    let halted = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;

    const clearTimer = (): void => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };

    const canPoll = (): boolean =>
      !disposed && !halted && !pausedRef.current && isDocumentVisible();

    const scheduleNext = (): void => {
      clearTimer();
      if (!canPoll()) return;
      timer = setTimeout(() => {
        void load('silent');
      }, PORTS_POLL_INTERVAL_MS);
    };

    /** `initial` 会显示 loading；其余触发者（轮询 / 手动刷新 / 恢复可见）一律静默。 */
    const load = async (mode: 'initial' | 'silent'): Promise<void> => {
      // 单飞：在途请求未回来时不发新请求。可见性恢复 / 连点刷新的重复触发会被这里吞掉，
      // 由在途请求完成后的 scheduleNext 接手，因此不会漏掉下一拍。
      // 暂停不拦在这里：手动刷新必须在暂停期间也能取数。
      if (disposed || inFlight || halted) return;
      inFlight = true;
      controller = new AbortController();
      if (mode === 'initial') setState({ status: 'loading' });
      try {
        const snapshot = await createListeningPortsClient(gatewayUrl).list(token, {
          signal: controller.signal,
        });
        if (disposed) return;
        setState({ status: 'ready', snapshot });
        // 无论谁触发（轮询 / 手动刷新 / 恢复可见），下一拍都从**本次完成后**重新计时。
        scheduleNext();
      } catch (error) {
        // 卸载 / 参数变化触发的 abort 不是失败，不覆盖新请求的状态。
        if (disposed || controller.signal.aborted) return;
        halted = true;
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        inFlight = false;
      }
    };

    const onVisibilityChange = (): void => {
      if (!isDocumentVisible()) {
        // 不可见即停：清掉待触发的下一拍（在途请求照常收尾）。
        clearTimer();
        return;
      }
      // 恢复可见：立刻拉一次（单飞守卫负责挡掉与在途请求的重叠）。
      void load('silent');
    };

    commandsRef.current = {
      refresh: () => void load('silent'),
      setPaused: (value) => {
        pausedRef.current = value;
        clearTimer();
        // 恢复：从当下重新计时；不立刻拉一次（要立刻取数是「刷新」的语义）。
        if (!value) scheduleNext();
      },
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    void load('initial');

    return () => {
      disposed = true;
      commandsRef.current = null;
      clearTimer();
      controller?.abort();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [gatewayUrl, token, retryNonce]);

  const retry = useCallback(() => setRetryNonce((nonce) => nonce + 1), []);

  const refresh = useCallback(() => {
    commandsRef.current?.refresh();
  }, []);

  const togglePaused = useCallback(() => {
    // 以 ref 而不是 state 为准：连续点击时 state 可能尚未提交，避免开关翻转错位。
    const next = !pausedRef.current;
    pausedRef.current = next;
    setPaused(next);
    commandsRef.current?.setPaused(next);
  }, []);

  return { state, retry, refresh, paused, togglePaused };
}
