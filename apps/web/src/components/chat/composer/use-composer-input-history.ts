import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createComposerInputHistoryClient } from '@openAwork/web-client';
import {
  useComposerInputHistoryStore,
  appendComposerInputHistoryEntry,
} from '../../../stores/chat/composer-input-history.js';
import { logger } from '../../../utils/log/logger.js';

const EMPTY_HISTORY: readonly string[] = [];

/**
 * 可持久化的目标会话。
 *
 * 三者任一缺失（未配置网关 / 未登录 / 会话尚未创建）时退化为运行期内存历史：
 * 输入历史只服务上下键回填，不能因为网关不可用就阻断输入框。
 */
export interface ComposerInputHistoryPersistence {
  readonly gatewayUrl: string;
  readonly sessionId: string | null;
  readonly token: string | null;
}

interface UseComposerInputHistoryOptions {
  readonly input: string;
  readonly setInput: React.Dispatch<React.SetStateAction<string>>;
  readonly historyScope: string | null;
  readonly textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  readonly persistence?: ComposerInputHistoryPersistence | null;
}

interface UseComposerInputHistoryReturn {
  readonly isBrowsingInputHistory: boolean;
  readonly navigateInputHistory: (direction: 'older' | 'newer') => boolean;
  readonly exitInputHistoryBrowsing: () => void;
  readonly restoreInputFromHistory: () => boolean;
  readonly recordSubmittedInputHistory: (text: string) => void;
  /**
   * 把一批历史写入当前会话的网关记录（用于 pending → session 迁移）。
   *
   * 迁移只改内存 scope 是不够的：刷新后 pending 期间产生的历史仍会丢。
   */
  readonly persistHistoryEntries: (entries: readonly string[]) => void;
}

export function useComposerInputHistory(
  options: UseComposerInputHistoryOptions,
): UseComposerInputHistoryReturn {
  const { input, setInput, historyScope, textareaRef, persistence } = options;
  const gatewayUrl = persistence?.gatewayUrl ?? '';
  const sessionId = persistence?.sessionId ?? null;
  const token = persistence?.token ?? null;
  const historyClient = useMemo(
    () => (gatewayUrl.length > 0 ? createComposerInputHistoryClient(gatewayUrl) : null),
    [gatewayUrl],
  );

  const persistedHistoryEntries = useComposerInputHistoryStore(
    useCallback(
      (state) =>
        historyScope ? (state.historyByScope[historyScope] ?? EMPTY_HISTORY) : EMPTY_HISTORY,
      [historyScope],
    ),
  );
  const recordPersistedEntry = useComposerInputHistoryStore((state) => state.recordEntry);
  const replacePersistedEntries = useComposerInputHistoryStore((state) => state.replaceEntries);
  const [volatileHistoryEntries, setVolatileHistoryEntries] =
    useState<readonly string[]>(EMPTY_HISTORY);
  const [historyCursor, setHistoryCursor] = useState<number | null>(null);
  const [draftBeforeHistory, setDraftBeforeHistory] = useState<string | null>(null);

  /**
   * 请求代号：水合与写入可能并发（进入会话后立刻发送），晚到的水合响应不得覆盖
   * 更晚发生的写入结果。只让「最新一次请求」的结果落到 store。
   */
  const persistRevisionRef = useRef(0);
  /**
   * 写入串行链：连续快速发送时两个 POST 若并发，服务端处理顺序可能与用户发送
   * 顺序相反，历史顺序就会反过来。按链排队保证先发的先落库。
   */
  const persistTailRef = useRef<Promise<void>>(Promise.resolve());

  const historyEntries = useMemo(
    () => (historyScope ? persistedHistoryEntries : volatileHistoryEntries),
    [historyScope, persistedHistoryEntries, volatileHistoryEntries],
  );
  const isBrowsingInputHistory = historyCursor !== null;

  const persistHistoryEntries = useCallback(
    (entries: readonly string[]) => {
      if (!historyClient || !historyScope || !sessionId || !token || entries.length === 0) {
        return;
      }
      const scope = historyScope;
      const revision = persistRevisionRef.current + 1;
      persistRevisionRef.current = revision;
      const runAppend = (): Promise<void> =>
        historyClient.append(token, sessionId, entries).then(
          (mergedEntries) => {
            if (persistRevisionRef.current !== revision) return;
            replacePersistedEntries(scope, mergedEntries);
          },
          (error: unknown) => {
            // 历史只影响上下键回填，写失败不能让发送路径失败；本地乐观记录保留，
            // 下一次进入会话水合时以服务端为准。
            logger.warn('输入历史写入失败，保留本地记录', error);
          },
        );
      // 前一条失败也要继续执行后一条，故两个分支都接同一个任务。
      persistTailRef.current = persistTailRef.current.then(runAppend, runAppend);
    },
    [historyClient, historyScope, replacePersistedEntries, sessionId, token],
  );

  // 进入会话时以网关为准水合：刷新 / 换端后仍能上下键调出历史。
  useEffect(() => {
    if (!historyClient || !historyScope || !sessionId || !token) {
      return;
    }
    const revision = persistRevisionRef.current + 1;
    persistRevisionRef.current = revision;
    let cancelled = false;
    void historyClient
      .list(token, sessionId)
      .then((entries) => {
        if (cancelled || persistRevisionRef.current !== revision) return;
        replacePersistedEntries(historyScope, entries);
      })
      .catch((error: unknown) => {
        // 水合失败保留当前运行期历史，不阻塞输入框。
        logger.warn('输入历史水合失败，保留本地记录', error);
      });
    return () => {
      cancelled = true;
    };
  }, [historyClient, historyScope, replacePersistedEntries, sessionId, token]);

  const focusTextareaAtEnd = useCallback(() => {
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const caret = textarea.value.length;
      textarea.focus();
      textarea.setSelectionRange(caret, caret);
    });
  }, [textareaRef]);

  const exitInputHistoryBrowsing = useCallback(() => {
    setHistoryCursor(null);
    setDraftBeforeHistory(null);
  }, []);

  const restoreInputFromHistory = useCallback(() => {
    if (historyCursor === null) {
      return false;
    }

    setInput(draftBeforeHistory ?? '');
    setHistoryCursor(null);
    setDraftBeforeHistory(null);
    focusTextareaAtEnd();
    return true;
  }, [draftBeforeHistory, focusTextareaAtEnd, historyCursor, setInput]);

  const recordSubmittedInputHistory = useCallback(
    (text: string) => {
      if (text.trim().length === 0) {
        return;
      }

      exitInputHistoryBrowsing();
      if (historyScope) {
        recordPersistedEntry(historyScope, text);
        persistHistoryEntries([text]);
        return;
      }

      setVolatileHistoryEntries((previous) => appendComposerInputHistoryEntry(previous, text));
    },
    [exitInputHistoryBrowsing, historyScope, persistHistoryEntries, recordPersistedEntry],
  );

  const navigateInputHistory = useCallback(
    (direction: 'older' | 'newer') => {
      if (historyEntries.length === 0) {
        return false;
      }

      if (direction === 'older') {
        if (historyCursor === null) {
          setDraftBeforeHistory(input);
          setHistoryCursor(historyEntries.length - 1);
          setInput(historyEntries[historyEntries.length - 1] ?? '');
          focusTextareaAtEnd();
          return true;
        }

        if (historyCursor === 0) {
          return true;
        }

        const nextCursor = historyCursor - 1;
        setHistoryCursor(nextCursor);
        setInput(historyEntries[nextCursor] ?? '');
        focusTextareaAtEnd();
        return true;
      }

      if (historyCursor === null) {
        return false;
      }

      const nextCursor = historyCursor + 1;
      if (nextCursor >= historyEntries.length) {
        setInput(draftBeforeHistory ?? '');
        setHistoryCursor(null);
        setDraftBeforeHistory(null);
        focusTextareaAtEnd();
        return true;
      }

      setHistoryCursor(nextCursor);
      setInput(historyEntries[nextCursor] ?? '');
      focusTextareaAtEnd();
      return true;
    },
    [draftBeforeHistory, focusTextareaAtEnd, historyCursor, historyEntries, input, setInput],
  );

  useEffect(() => {
    setHistoryCursor(null);
    setDraftBeforeHistory(null);
  }, [historyScope]);

  useEffect(() => {
    if (historyCursor === null) {
      return;
    }

    const currentEntry = historyEntries[historyCursor];
    if (currentEntry === undefined || input !== currentEntry) {
      setHistoryCursor(null);
      setDraftBeforeHistory(null);
    }
  }, [historyCursor, historyEntries, input]);

  return {
    isBrowsingInputHistory,
    navigateInputHistory,
    exitInputHistoryBrowsing,
    restoreInputFromHistory,
    recordSubmittedInputHistory,
    persistHistoryEntries,
  };
}
