import { useCallback, useMemo, useRef } from 'react';
import type { ChatMessage } from '../../../../components/conversation-runtime/messages/support.js';
import type { ChatRightPanelState } from '../../state/chat-stream-state.js';
import type { RecoveredActiveAssistantStream } from '../../../../components/conversation-runtime/stream/stream-recovery.js';

const MAX_CACHE_SIZE = 10;

export interface SessionViewStreamingSnapshot {
  recoveredStream: RecoveredActiveAssistantStream;
  rightPanelState: ChatRightPanelState;
}

export interface SessionViewCacheEntry {
  messages: ChatMessage[];
  scrollTop: number;
  scrollHeight: number;
  /**
   * 离开该会话时视口距**真正底部**的距离（px）。
   *
   * 恢复定位用它而不是绝对 `scrollTop`：列表是「尾部窗口」（恢复时
   * `visibleMessageCount` 被重置为默认值）+ 虚拟化估算高度，两次进入的总高度
   * 并不相等，绝对位置在不同布局下语义会漂移。距底距离是相对量，恢复时按
   * 当场测量的高度换算，天然免疫布局差异——上次停在最新的会话，恢复后仍落在
   * 最新处并继续跟随。
   *
   * 拿不到滚动区时按 0 处理（视作「在最新处」）：切回该会话应当停在最新消息
   * 处，而不是停在顶部。
   */
  distanceFromBottom: number;
  timestamp: number;
  streamingSnapshot?: SessionViewStreamingSnapshot;
}

export interface SessionViewCacheReturn {
  save: (
    sessionId: string,
    messages: ChatMessage[],
    scrollRegion: HTMLDivElement | null,
    streamingSnapshot?: SessionViewStreamingSnapshot,
  ) => void;
  restore: (sessionId: string) => SessionViewCacheEntry | null;
  invalidate: (sessionId: string) => void;
}

export function useSessionViewCache(): SessionViewCacheReturn {
  const cacheRef = useRef(new Map<string, SessionViewCacheEntry>());

  const save = useCallback(
    (
      sessionId: string,
      messages: ChatMessage[],
      scrollRegion: HTMLDivElement | null,
      streamingSnapshot?: SessionViewStreamingSnapshot,
    ) => {
      // Allow saving when there's at least messages OR an in-flight streaming snapshot.
      if (!sessionId || (messages.length === 0 && !streamingSnapshot)) return;

      const scrollTop = scrollRegion?.scrollTop ?? 0;
      const scrollHeight = scrollRegion?.scrollHeight ?? 0;
      const clientHeight = scrollRegion?.clientHeight ?? 0;
      const entry: SessionViewCacheEntry = {
        messages,
        scrollTop,
        scrollHeight,
        // 拿不到滚动区时按「在最新处」记录（0），恢复即贴底；按 0 距离而不是
        // 「不记录」是为了让恢复路径永远有一条明确裁决，不依赖缺省值语义。
        distanceFromBottom: scrollRegion ? Math.max(0, scrollHeight - clientHeight - scrollTop) : 0,
        timestamp: Date.now(),
        ...(streamingSnapshot ? { streamingSnapshot } : {}),
      };

      const cache = cacheRef.current;
      // Delete first to refresh insertion order
      cache.delete(sessionId);
      cache.set(sessionId, entry);

      // Evict oldest entries if over limit
      if (cache.size > MAX_CACHE_SIZE) {
        const firstKey = cache.keys().next().value;
        if (firstKey !== undefined) {
          cache.delete(firstKey);
        }
      }
    },
    [],
  );

  const restore = useCallback((sessionId: string): SessionViewCacheEntry | null => {
    return cacheRef.current.get(sessionId) ?? null;
  }, []);

  const invalidate = useCallback((sessionId: string) => {
    cacheRef.current.delete(sessionId);
  }, []);

  return useMemo(() => ({ save, restore, invalidate }), [save, restore, invalidate]);
}
