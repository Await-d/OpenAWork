import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface MessageBookmark {
  messageId: string;
  sessionId: string;
  content: string;
  role: 'user' | 'assistant';
  note?: string;
  createdAt: number;
}

interface BookmarkStore {
  bookmarks: MessageBookmark[];
  addBookmark: (bookmark: Omit<MessageBookmark, 'createdAt'>) => void;
  removeBookmark: (messageId: string) => void;
  updateBookmarkNote: (messageId: string, note: string) => void;
  isBookmarked: (messageId: string) => boolean;
  getSessionBookmarks: (sessionId: string) => MessageBookmark[];
  clearSessionBookmarks: (sessionId: string) => void;
}

export const useBookmarkStore = create<BookmarkStore>()(
  persist(
    (set, get) => ({
      bookmarks: [],

      addBookmark: (bookmark) =>
        set((state) => {
          if (state.bookmarks.some((b) => b.messageId === bookmark.messageId)) {
            return state;
          }
          return {
            bookmarks: [...state.bookmarks, { ...bookmark, createdAt: Date.now() }],
          };
        }),

      removeBookmark: (messageId) =>
        set((state) => ({
          bookmarks: state.bookmarks.filter((b) => b.messageId !== messageId),
        })),

      updateBookmarkNote: (messageId, note) =>
        set((state) => ({
          bookmarks: state.bookmarks.map((b) => (b.messageId === messageId ? { ...b, note } : b)),
        })),

      isBookmarked: (messageId) => get().bookmarks.some((b) => b.messageId === messageId),

      getSessionBookmarks: (sessionId) => get().bookmarks.filter((b) => b.sessionId === sessionId),

      clearSessionBookmarks: (sessionId) =>
        set((state) => ({
          bookmarks: state.bookmarks.filter((b) => b.sessionId !== sessionId),
        })),
    }),
    {
      name: 'openAwork-bookmarks',
      storage: createJSONStorage(() => localStorage),
      version: 1,
    },
  ),
);
