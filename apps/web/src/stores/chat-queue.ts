import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { PersistedQueuedComposerMessage } from '../pages/chat-page/queued-composer-state.js';

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
      storage: createJSONStorage(() => sessionStorage),
      version: 1,
    },
  ),
);
