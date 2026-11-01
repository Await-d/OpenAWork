import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import type { ChatMessage } from '../../../components/conversation-runtime/messages/support.js';

import type { LoadEarlierHistory } from '../conversation/snapshot/session-history-pager.js';

type UseEnsureMessageVisibleDeps = {
  readonly currentSessionId: string | null;
  readonly loadEarlierHistory: LoadEarlierHistory;
  readonly messages: ChatMessage[];
  readonly requestMessageScroll: (messageId: string) => void;
  readonly setVisibleMessageCount: Dispatch<SetStateAction<number>>;
  readonly visibleMessageCount: number | undefined;
};

/**
 * 历史跳转 / 搜索 / 收藏三个入口共用：点目标消息时，若它不在当前渲染窗口里
 * （分页只渲染最近 N 条，或服务端还没拉到本地），先把它「弄出来」再让调用方滚动。
 *
 * 远端历史与上翻入口共用游标，只加载到目标所在页。
 */
export function useEnsureMessageVisible(deps: UseEnsureMessageVisibleDeps) {
  const {
    currentSessionId,
    loadEarlierHistory,
    messages,
    requestMessageScroll,
    setVisibleMessageCount,
    visibleMessageCount,
  } = deps;

  return useCallback(
    async (messageId: string) => {
      if (!messageId) return;
      // 先在本地完整列表里找。如果在，但被分页裁掉了 → 把窗口拉到包含它。
      const localIndex = messages.findIndex((m) => m.id === messageId);
      if (localIndex >= 0) {
        // visibleMessageCount === undefined 表示「全部展开」，本就可见。
        if (visibleMessageCount !== undefined) {
          // 渲染的是 `slice(-visibleMessageCount)`，所以可见区间是
          // [messages.length - visibleMessageCount, messages.length)。
          // 把窗口扩到能覆盖目标的位置。多加 5 条作为上下文 buffer。
          const requiredCount = messages.length - localIndex + 5;
          if (requiredCount > visibleMessageCount) {
            // 扩窗会把旧消息插到渲染列表头部：目标节点此前没挂载，调用方的
            // scrollIntoView 会静默失效。这里请求虚拟视口先按目标组偏移粗滚动
            // 一次，把目标挂载出来，再由调用方精确居中。
            requestMessageScroll(messageId);
            setVisibleMessageCount(requiredCount);
          }
        }
        return;
      }
      if (currentSessionId) {
        try {
          const result = await loadEarlierHistory(messageId);
          if (result === null) return;
          const targetIndex = result.messages.findIndex((message) => message.id === messageId);
          if (targetIndex < 0) return;
          requestMessageScroll(messageId);
          setVisibleMessageCount((previous) =>
            Math.max(previous, result.messages.length - targetIndex + 5),
          );
        } catch {
          /* caller handles a missing target; a failed page remains retryable */
        }
      }
    },
    [
      currentSessionId,
      loadEarlierHistory,
      messages,
      requestMessageScroll,
      setVisibleMessageCount,
      visibleMessageCount,
    ],
  );
}
