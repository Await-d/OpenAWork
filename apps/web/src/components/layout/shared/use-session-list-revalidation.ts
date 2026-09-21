/**
 * 会话侧栏后台重新验证（revalidation）控制器。
 *
 * 背景：左侧会话列表只在挂载时取一次数，之后仅响应用户动作派发的
 * `openAwork:sessions-refresh` 事件；其它端 / 消息渠道 / 定时任务 / 团队工厂
 * 产生的会话变更不会反映到列表上。这里用一个全局控制器做「兜底新鲜度」：
 *
 *  - 仅在浏览器标签页可见时运行；
 *  - 以「上一拍完成后」再排下一拍（不是固定 setInterval）→ 单飞，
 *    慢响应不会把请求叠起来；
 *  - 切回可见 / 窗口聚焦 / 网络恢复时立刻补一次（这些时刻数据必然已过期）；
 *  - 只是「提醒」：真正的取数由 useSessions / useTeamSidebarSessions 承担，
 *    它们通过 session-list-events 总线订阅。
 */
import { useEffect } from 'react';
import { refreshSessionListsNow } from '../../../utils/session/session-list-events.js';

/** 后台重新验证周期（仅标签页可见时运行）。 */
export const SESSION_LIST_REVALIDATE_INTERVAL_MS = 30_000;

function isDocumentVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

export function useSessionListRevalidation(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const clearTimer = (): void => {
      if (timer !== null) {
        clearTimeout(timer);
      }
      timer = null;
    };

    const scheduleNext = (): void => {
      clearTimer();
      if (disposed || !isDocumentVisible()) {
        return;
      }
      timer = setTimeout(() => {
        void refreshSessionListsNow().then(scheduleNext, scheduleNext);
      }, SESSION_LIST_REVALIDATE_INTERVAL_MS);
    };

    const refreshNow = (): void => {
      clearTimer();
      if (disposed || !isDocumentVisible()) {
        return;
      }
      void refreshSessionListsNow().then(scheduleNext, scheduleNext);
    };

    const onVisibilityChange = (): void => {
      if (!isDocumentVisible()) {
        // 不可见即停：清掉待触发的下一拍（在途刷新照常收尾）。
        clearTimer();
        return;
      }
      refreshNow();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', refreshNow);
    window.addEventListener('online', refreshNow);
    scheduleNext();

    return () => {
      disposed = true;
      clearTimer();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', refreshNow);
      window.removeEventListener('online', refreshNow);
    };
  }, [enabled]);
}
