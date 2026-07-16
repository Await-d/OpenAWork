import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  useComposerInputHistoryStore,
  appendComposerInputHistoryEntry,
} from '../../../stores/chat/composer-input-history.js';

const EMPTY_HISTORY: readonly string[] = [];

interface UseComposerInputHistoryOptions {
  readonly input: string;
  readonly setInput: React.Dispatch<React.SetStateAction<string>>;
  readonly historyScope: string | null;
  readonly textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

interface UseComposerInputHistoryReturn {
  readonly isBrowsingInputHistory: boolean;
  readonly navigateInputHistory: (direction: 'older' | 'newer') => boolean;
  readonly exitInputHistoryBrowsing: () => void;
  readonly restoreInputFromHistory: () => boolean;
  readonly recordSubmittedInputHistory: (text: string) => void;
}

export function useComposerInputHistory(
  options: UseComposerInputHistoryOptions,
): UseComposerInputHistoryReturn {
  const { input, setInput, historyScope, textareaRef } = options;
  const persistedHistoryEntries = useComposerInputHistoryStore(
    useCallback(
      (state) =>
        historyScope ? (state.historyByScope[historyScope] ?? EMPTY_HISTORY) : EMPTY_HISTORY,
      [historyScope],
    ),
  );
  const recordPersistedEntry = useComposerInputHistoryStore((state) => state.recordEntry);
  const [volatileHistoryEntries, setVolatileHistoryEntries] =
    useState<readonly string[]>(EMPTY_HISTORY);
  const [historyCursor, setHistoryCursor] = useState<number | null>(null);
  const [draftBeforeHistory, setDraftBeforeHistory] = useState<string | null>(null);

  const historyEntries = useMemo(
    () => (historyScope ? persistedHistoryEntries : volatileHistoryEntries),
    [historyScope, persistedHistoryEntries, volatileHistoryEntries],
  );
  const isBrowsingInputHistory = historyCursor !== null;

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
        return;
      }

      setVolatileHistoryEntries((previous) => appendComposerInputHistoryEntry(previous, text));
    },
    [exitInputHistoryBrowsing, historyScope, recordPersistedEntry],
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
  };
}
