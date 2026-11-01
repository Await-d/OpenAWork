import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { SubagentNotice } from '@openAwork/shared';
import { createSessionsClient } from '@openAwork/web-client';
import type { ChatMessage } from '../../../../components/conversation-runtime/messages/support.js';
import { collectSubagentNotices } from '../../../../components/conversation-runtime/messages/subagent-notices.js';
import {
  createSessionHistoryPager,
  prependHistoricalMessages,
  type HistoryPageResult,
} from './session-history-pager.js';

interface SessionHistoryLoaderOptions {
  gatewayUrl: string;
  token: string | null;
  currentSessionId: string | null;
  reloadKey?: number;
  currentSessionViewRef: MutableRefObject<{ epoch: number; sessionId: string | null }>;
  messagesRef: MutableRefObject<ChatMessage[]>;
  isCurrentSessionView: (sessionId: string, epoch: number) => boolean;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setSubagentNotices: Dispatch<SetStateAction<SubagentNotice[]>>;
  setServerTotalTurnCount: (value: number | null) => void;
}

export function useSessionHistoryLoader(options: SessionHistoryLoaderOptions) {
  const {
    gatewayUrl,
    token,
    currentSessionId,
    reloadKey,
    currentSessionViewRef,
    messagesRef,
    isCurrentSessionView,
    setMessages,
    setSubagentNotices,
    setServerTotalTurnCount,
  } = options;
  const pagerRef = useRef<{
    sessionId: string;
    epoch: number;
    gatewayUrl: string;
    token: string;
    pager: ReturnType<typeof createSessionHistoryPager>;
  } | null>(null);
  const [historyState, setHistoryState] = useState<{
    sessionId: string;
    epoch: number;
    more: boolean;
  } | null>(null);

  useEffect(() => {
    pagerRef.current = null;
    setHistoryState(null);
    return () => {
      pagerRef.current = null;
    };
  }, [currentSessionId, gatewayUrl, reloadKey, token]);

  const loadEarlierHistory = useCallback(
    async (targetMessageId?: string): Promise<HistoryPageResult | null> => {
      if (currentSessionId === null || token === null) return null;
      const epoch = currentSessionViewRef.current.epoch;
      if (!isCurrentSessionView(currentSessionId, epoch)) return null;
      let scope = pagerRef.current;
      if (
        scope === null ||
        scope.sessionId !== currentSessionId ||
        scope.epoch !== epoch ||
        scope.gatewayUrl !== gatewayUrl ||
        scope.token !== token
      ) {
        const sessionId = currentSessionId;
        const client = createSessionsClient(gatewayUrl);
        const isCurrent = () =>
          pagerRef.current?.pager === pager && isCurrentSessionView(sessionId, epoch);
        const pager = createSessionHistoryPager({
          readPage: (before) => client.listMessages(token, sessionId, { before, limit: 50 }),
          readMessages: () => messagesRef.current,
          isCurrent,
          publish: (historical, rawMessages, more) => {
            setMessages((previous) =>
              isCurrent() ? prependHistoricalMessages(previous, historical) : previous,
            );
            const notices = collectSubagentNotices(rawMessages);
            if (notices.length > 0) {
              setSubagentNotices((previous) => {
                if (!isCurrent()) return previous;
                const ids = new Set(previous.map((notice) => notice.id));
                const older = notices.filter((notice) => !ids.has(notice.id));
                return older.length > 0 ? [...older, ...previous] : previous;
              });
            }
            setHistoryState({ sessionId, epoch, more });
            if (!more) setServerTotalTurnCount(null);
          },
        });
        scope = { sessionId, epoch, gatewayUrl, token, pager };
        pagerRef.current = scope;
      }
      const result = await scope.pager.load(targetMessageId);
      return isCurrentSessionView(currentSessionId, epoch) && pagerRef.current === scope
        ? result
        : null;
    },
    [
      currentSessionId,
      currentSessionViewRef,
      gatewayUrl,
      isCurrentSessionView,
      messagesRef,
      setMessages,
      setServerTotalTurnCount,
      setSubagentNotices,
      token,
    ],
  );

  const hasMoreHistory = historyState?.sessionId === currentSessionId ? historyState.more : null;
  return { loadEarlierHistory, hasMoreHistory };
}
