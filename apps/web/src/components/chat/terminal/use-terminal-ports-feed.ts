/**
 * 端口页数据源（T-13，TASK 2）：挂载取数 + **仅在可见时**轮询。
 *
 * 状态机（周期 = `PORTS_POLL_INTERVAL_MS`）：
 *  - `loading` —— 首次取数（含用户「重试」）进行中。轮询刷新**不会**回到这里：
 *    列表每 5s 闪一次 spinner 比数据不新鲜更糟（静默刷新，只换数据）。
 *  - `ready` —— 成功。**请求完成后**才排下一次（不是固定 `setInterval`）：单飞，
 *    慢响应不会堆叠请求，周期自然成为「间隔 + 延迟」。
 *  - `error` —— 失败即**停止轮询**（失败闩锁）：对端已经坏了，5s 一次地打失败接口
 *    既拿不到数据又会持续放大网关压力；恢复权交给用户点「重试」，重试成功后
 *    自动恢复轮询。
 *
 * 暂停条件：
 *  - `document.visibilityState === 'hidden'`（浏览器标签页不可见）—— 监听
 *    `visibilitychange`，恢复可见时立刻拉一次；在途请求照常收尾，不产生孤儿状态。
 *  - 「切到终端页签」由调用方卸载本面板达成（`QuickTerminalPanel` 的页签是真切换
 *    内容而不是 CSS 隐藏），卸载即清定时器与监听。
 */

import { useCallback, useEffect, useState } from 'react';
import {
  createListeningPortsClient,
  type ListeningPortsSnapshotView,
} from '@openAwork/web-client';

/** 端口页轮询周期（仅「端口」页签可见 + 浏览器标签页可见时运行）。 */
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
}

function isDocumentVisible(): boolean {
  // 非浏览器环境（无 visibilityState）按可见处理：只跳过「因为不可见而不取数」这一种暂停。
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

export function useTerminalPortsFeed(gatewayUrl: string, token: string | null): TerminalPortsFeed {
  const [state, setState] = useState<TerminalPortsFeedState>({ status: 'loading' });
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (token === null) {
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

    const canPoll = (): boolean => !disposed && !halted && isDocumentVisible();

    const scheduleNext = (): void => {
      clearTimer();
      if (!canPoll()) return;
      timer = setTimeout(() => {
        void load('poll');
      }, PORTS_POLL_INTERVAL_MS);
    };

    const load = async (mode: 'initial' | 'poll'): Promise<void> => {
      // 单飞：在途请求未回来时不发新请求。可见性恢复等外部触发会被这里吞掉，
      // 由在途请求完成后的 scheduleNext 接手，因此不会漏掉下一拍。
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
      void load('poll');
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    void load('initial');

    return () => {
      disposed = true;
      clearTimer();
      controller?.abort();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [gatewayUrl, token, retryNonce]);

  const retry = useCallback(() => setRetryNonce((nonce) => nonce + 1), []);

  return { state, retry };
}
