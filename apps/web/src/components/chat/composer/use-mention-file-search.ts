import { useEffect, useRef, useState } from 'react';
import type { MentionSearchResult } from '../../conversation-runtime/messages/support.js';
import { logger } from '../../../utils/log/logger.js';

export type MentionFileSearchFn = (
  query: string,
  signal: AbortSignal,
) => Promise<MentionSearchResult>;

export interface UseMentionFileSearchInput {
  enabled: boolean;
  query: string | null;
  search?: MentionFileSearchFn;
  debounceMs?: number;
}

export interface MentionFileSearchState {
  result: MentionSearchResult | null;
  loading: boolean;
  hasAnyEntries: boolean;
  error: string | null;
}

const DEFAULT_DEBOUNCE_MS = 120;
const MENTION_SEARCH_ERROR_FALLBACK = '检索工作区文件失败，请稍后重试。';

export function useMentionFileSearch(input: UseMentionFileSearchInput): MentionFileSearchState {
  const { enabled, query, search, debounceMs = DEFAULT_DEBOUNCE_MS } = input;

  const [result, setResult] = useState<MentionSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasAnyEntries, setHasAnyEntries] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSeqRef = useRef(0);

  const active = enabled && query !== null && search !== undefined;

  // `search` 身份变化意味着工作区切换：旧工作区「曾有条目」以及旧错误都不再适用，
  // 否则切到空工作区后空状态会错误地沿用「未找到匹配」。
  useEffect(() => {
    setHasAnyEntries(false);
    setError(null);
  }, [search]);

  useEffect(() => {
    if (!active) {
      return;
    }

    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;
    const controller = new AbortController();
    const isStale = (): boolean =>
      controller.signal.aborted || requestSeqRef.current !== requestSeq;

    const runSearch = () => {
      if (isStale()) return;
      setLoading(true);
      setError(null);
      search(query, controller.signal)
        .then((nextResult) => {
          if (isStale()) return;
          setResult(nextResult);
          setError(null);
          if (nextResult.files.length + nextResult.directories.length > 0) {
            setHasAnyEntries(true);
          }
        })
        .catch((caught: unknown) => {
          // 中止 / 过期（query 已切换）的失败属于正常查询流转，不当成错误展示。
          if (isStale()) return;
          const message = caught instanceof Error ? caught.message.trim() : '';
          const errorMessage = message.length > 0 ? message : MENTION_SEARCH_ERROR_FALLBACK;
          logger.warn('检索工作区文件失败', { query, error: caught });
          setError(errorMessage);
        })
        .finally(() => {
          if (isStale()) return;
          setLoading(false);
        });
    };

    let timer: ReturnType<typeof setTimeout> | null = null;
    if (debounceMs > 0) {
      timer = setTimeout(runSearch, debounceMs);
    } else {
      runSearch();
    }

    return () => {
      if (timer !== null) clearTimeout(timer);
      controller.abort();
    };
  }, [active, debounceMs, query, search]);

  if (!active) {
    return { result: null, loading: false, hasAnyEntries, error };
  }

  return { result, loading, hasAnyEntries, error };
}
