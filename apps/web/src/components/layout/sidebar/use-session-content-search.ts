/**
 * useSessionContentSearch — 侧栏搜索的「消息内容」补充检索。
 *
 * 标题过滤是本地同步的；本 hook 通过网关搜索接口补充内容命中，
 * 让侧栏搜索与首页搜索保持一致（标题 ∪ 消息内容）。
 *
 * 约定：
 * - 仅在 `enabled` 且查询长度 ≥ 2 时发请求，180ms 防抖并支持中途取消；
 * - 401 交给全局登出流程，其他错误降级为“仅标题匹配”，不打断输入。
 */

import { useEffect, useMemo, useState } from 'react';
import { createSessionsClient, HttpError, withTokenRefresh } from '@openAwork/web-client';
import type { SessionSearchResult, TokenStore } from '@openAwork/web-client';
import { useAuthStore } from '../../../stores/auth/auth.js';
import { logger } from '../../../utils/log/logger.js';

const SEARCH_DEBOUNCE_MS = 180;
const MIN_QUERY_LENGTH = 2;
const SEARCH_RESULT_LIMIT = 50;

export interface SessionContentSearchState {
  /** 命中消息内容的会话 ID 集合 */
  matchedSessionIds: ReadonlySet<string>;
  /** 每个会话的首条命中片段（用于展示） */
  snippetBySessionId: ReadonlyMap<string, string>;
}

const EMPTY_STATE: SessionContentSearchState = {
  matchedSessionIds: new Set<string>(),
  snippetBySessionId: new Map<string, string>(),
};

export function useSessionContentSearch(query: string, enabled = true): SessionContentSearchState {
  const accessToken = useAuthStore((s) => s.accessToken);
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const email = useAuthStore((s) => s.email);
  const setAuth = useAuthStore((s) => s.setAuth);
  const clearAuth = useAuthStore((s) => s.clearAuth);

  const [results, setResults] = useState<readonly SessionSearchResult[]>([]);

  const tokenStore = useMemo<TokenStore>(
    () => ({
      clearAuth,
      getAccessToken: () => useAuthStore.getState().accessToken,
      getRefreshToken: () => useAuthStore.getState().refreshToken,
      setTokens: (nextAccessToken, nextRefreshToken, expiresIn) =>
        setAuth(nextAccessToken, email ?? '', nextRefreshToken, expiresIn),
    }),
    [clearAuth, email, setAuth],
  );

  const normalizedQuery = query.trim();

  useEffect(() => {
    if (!enabled || !accessToken || normalizedQuery.length < MIN_QUERY_LENGTH) {
      setResults([]);
      return;
    }

    const abortController = new AbortController();
    const timeoutId = window.setTimeout(() => {
      void withTokenRefresh(gatewayUrl, tokenStore, (token) =>
        createSessionsClient(gatewayUrl).search(token, normalizedQuery, {
          limit: SEARCH_RESULT_LIMIT,
          signal: abortController.signal,
        }),
      )
        .then(setResults)
        .catch((error: unknown) => {
          if (abortController.signal.aborted) {
            return;
          }
          if (error instanceof HttpError && error.status === 401) {
            clearAuth();
            return;
          }
          logger.error('Failed to search session content:', error);
          setResults([]);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
      abortController.abort();
    };
  }, [accessToken, clearAuth, enabled, gatewayUrl, normalizedQuery, tokenStore]);

  return useMemo(() => {
    if (results.length === 0) {
      return EMPTY_STATE;
    }

    const matchedSessionIds = new Set<string>();
    const snippetBySessionId = new Map<string, string>();
    for (const result of results) {
      matchedSessionIds.add(result.sessionId);
      if (!snippetBySessionId.has(result.sessionId)) {
        snippetBySessionId.set(result.sessionId, result.snippet);
      }
    }

    return { matchedSessionIds, snippetBySessionId };
  }, [results]);
}
