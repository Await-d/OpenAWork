import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import type { ChatMessage } from '../../../components/conversation-runtime/messages/support.js';

type LoadSessionSnapshot = (
  sessionId: string,
  options?: {
    messageLimit?: number;
    replaceMessages?: boolean;
    expectedSessionViewEpoch?: number;
  },
) => Promise<unknown>;

type UseEnsureMessageVisibleDeps = {
  readonly currentSessionId: string | null;
  readonly loadCurrentSessionSnapshot: LoadSessionSnapshot;
  readonly messages: ChatMessage[];
  readonly requestMessageScroll: (messageId: string) => void;
  readonly setServerTotalTurnCount: (value: number | null) => void;
  readonly setVisibleMessageCount: Dispatch<SetStateAction<number>>;
  readonly visibleMessageCount: number | undefined;
};

/**
 * 历史跳转 / 搜索 / 收藏三个入口共用：点目标消息时，若它不在当前渲染窗口里
 * （分页只渲染最近 N 条，或服务端还没拉到本地），先把它「弄出来」再让调用方滚动。
 *
 * 必须在 `useSessionSnapshotLoader` 之后调用，否则依赖数组会在初始化时读取尚未
 * 声明的 `loadCurrentSessionSnapshot` 触发 TDZ。
 */
export function useEnsureMessageVisible(deps: UseEnsureMessageVisibleDeps) {
  const {
    currentSessionId,
    loadCurrentSessionSnapshot,
    messages,
    requestMessageScroll,
    setServerTotalTurnCount,
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
      // 本地数组里也没有 → 服务端可能还没拉过来，触发一次 snapshot
      // 重载并把窗口扩到全部新消息可见。
      if (currentSessionId) {
        requestMessageScroll(messageId);
        try {
          await loadCurrentSessionSnapshot(currentSessionId, { replaceMessages: true });
          setServerTotalTurnCount(null);
          // 拉一个足够大的值，使 `slice(-visibleMessageCount)` 等同于全部。
          // useChatRenderData 会在 visibleMessageCount >= 总长时返回完整列表，
          // 不会真的展示 9999 条空 slot。
          setVisibleMessageCount(9_999);
        } catch {
          /* swallow — caller will fall through to its own missing-target branch */
        }
      }
    },
    [
      currentSessionId,
      loadCurrentSessionSnapshot,
      messages,
      requestMessageScroll,
      setServerTotalTurnCount,
      setVisibleMessageCount,
      visibleMessageCount,
    ],
  );
}
