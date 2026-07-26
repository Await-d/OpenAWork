import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { PersistedQueuedComposerMessage } from '../../pages/chat-page/conversation/composer/queued-composer-state.js';

interface ChatQueueStore {
  queuesByScope: Record<string, PersistedQueuedComposerMessage[]>;
  replaceQueue: (scope: string, items: PersistedQueuedComposerMessage[]) => void;
}

export const useChatQueueStore = create<ChatQueueStore>()(
  persist(
    (set) => ({
      queuesByScope: {},
      replaceQueue: (scope, items) =>
        set((state) => {
          if (scope.trim().length === 0) {
            return state;
          }

          if (items.length === 0) {
            const nextQueuesByScope = { ...state.queuesByScope };
            delete nextQueuesByScope[scope];
            return { queuesByScope: nextQueuesByScope };
          }

          return {
            queuesByScope: {
              ...state.queuesByScope,
              [scope]: items,
            },
          };
        }),
    }),
    {
      name: 'openAwork-chat-queue',
      partialize: (state) => ({ queuesByScope: state.queuesByScope }),
      storage: createJSONStorage(() => localStorage),
      version: 2,
      migrate: (persistedState, version) => {
        // v1 使用 sessionStorage，v2 迁移到 localStorage。
        // 如果 localStorage 中没有数据但 sessionStorage 中有，则从 sessionStorage 读取。
        if (version < 2) {
          try {
            const raw = window.sessionStorage.getItem('openAwork-chat-queue');
            if (raw) {
              const parsed = JSON.parse(raw) as { state?: { queuesByScope?: unknown } };
              const migratedQueues = parsed.state?.queuesByScope;
              if (migratedQueues && typeof migratedQueues === 'object') {
                // 清理旧 sessionStorage 数据，避免后续混淆
                window.sessionStorage.removeItem('openAwork-chat-queue');
                return { queuesByScope: migratedQueues } as {
                  queuesByScope: Record<string, PersistedQueuedComposerMessage[]>;
                };
              }
            }
          } catch {
            // 忽略解析失败，使用空状态
          }
        }
        return persistedState as ChatQueueStore;
      },
    },
  ),
);
