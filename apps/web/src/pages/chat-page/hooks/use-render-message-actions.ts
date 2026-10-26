import { useCallback } from 'react';

import type { ChatMessage } from '../../../components/conversation-runtime/messages/support.js';
import type { BookmarkStore } from '../../../stores/chat/bookmarks.js';

import type { useChatMessageActions } from './use-chat-message-actions.js';

type BuildMessageActions = ReturnType<typeof useChatMessageActions>['buildMessageActions'];

type UseRenderMessageActionsDeps = {
  readonly bookmarkStore: BookmarkStore;
  readonly buildMessageActions: BuildMessageActions;
  readonly currentSessionId: string | null;
  readonly isMessageSelected: (messageId: string) => boolean;
  readonly messageMultiSelectEnabled: boolean;
  readonly toggleMessageSelection: (messageId: string) => void;
};

/**
 * 消息 hover actions 构建器：在基础动作上追加「收藏 / 多选」。
 *
 * 引用稳定性是硬约束：它进入 `useChatRenderData` 的 memo 依赖，流式帧里若每帧换新，
 * 历史 entry / 分组缓存会整帧失效，整个消息列表随之重渲染。
 */
export function useRenderMessageActions(deps: UseRenderMessageActionsDeps) {
  const {
    bookmarkStore,
    buildMessageActions,
    currentSessionId,
    isMessageSelected,
    messageMultiSelectEnabled,
    toggleMessageSelection,
  } = deps;

  return useCallback(
    (message: ChatMessage) => {
      const baseActions = buildMessageActions(message);
      const isBookmarked = bookmarkStore.isBookmarked(message.id);

      // 对于压缩消息，只返回基础操作（复制），不添加收藏和选择按钮
      const isCompaction = baseActions.length === 1 && baseActions[0]?.id === 'copy';
      if (isCompaction) {
        return baseActions;
      }

      return [
        ...baseActions,
        {
          id: 'bookmark',
          label: isBookmarked ? '⭐ 已收藏' : '☆ 收藏',
          onClick: () => {
            if (isBookmarked) {
              bookmarkStore.removeBookmark(message.id);
            } else {
              bookmarkStore.addBookmark({
                messageId: message.id,
                sessionId: currentSessionId ?? '',
                content: message.content.slice(0, 200),
                role: message.role,
              });
            }
          },
        },
        ...(messageMultiSelectEnabled
          ? [
              {
                id: 'select',
                label: isMessageSelected(message.id) ? '☑ 已选' : '☐ 选择',
                onClick: () => toggleMessageSelection(message.id),
              },
            ]
          : []),
      ];
    },
    [
      bookmarkStore,
      buildMessageActions,
      currentSessionId,
      isMessageSelected,
      messageMultiSelectEnabled,
      toggleMessageSelection,
    ],
  );
}
