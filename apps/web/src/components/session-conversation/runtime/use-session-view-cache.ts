import { useCallback, useMemo, useRef } from 'react';
import type { ChatMessage } from './support.js';
import type { ChatRightPanelState } from '../../../pages/chat-stream-state.js';
import type { RecoveredActiveAssistantStream } from './stream-recovery.js';

const MAX_CACHE_SIZE = 10;

export interface SessionViewStreamingSnapshot {
  recoveredStream: RecoveredActiveAssistantStream;
  rightPanelState: ChatRightPanelState;
}

export interface SessionViewCacheEntry {
  messages: ChatMessage[];
  scrollTop: number;
  scrollHeight: number;
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
      const entry: SessionViewCacheEntry = {
        messages,
        scrollTop,
        scrollHeight,
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
