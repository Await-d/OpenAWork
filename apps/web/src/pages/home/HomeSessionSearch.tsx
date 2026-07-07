import { useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { createSessionsClient, HttpError, withTokenRefresh } from '@openAwork/web-client';
import type { SessionSearchResult, TokenStore } from '@openAwork/web-client';
import { useAuthStore } from '../../stores/auth/auth.js';
import { logger } from '../../utils/log/logger.js';
import {
  formatRelativeTime,
  getSessionTitle,
  getWorkspaceName,
  getWorkingDirectory,
  searchHomeSessions,
} from './utils/session-grouping.js';
import type { HomeSessionLike } from './utils/session-grouping.js';

type SearchResultSource = 'local' | 'message';

interface HomeSessionSearchResult {
  readonly id: string;
  readonly meta: string;
  readonly sessionId: string;
  readonly snippet: string;
  readonly source: SearchResultSource;
  readonly title: string;
}

interface HomeSessionSearchProps<TSession extends HomeSessionLike> {
  readonly sessions: readonly TSession[];
  readonly onSelectSession: (sessionId: string, title: string | null | undefined) => void;
}

export function HomeSessionSearch<TSession extends HomeSessionLike>({
  sessions,
  onSelectSession,
}: HomeSessionSearchProps<TSession>) {
  const accessToken = useAuthStore((state) => state.accessToken);
  const refreshToken = useAuthStore((state) => state.refreshToken);
  const gatewayUrl = useAuthStore((state) => state.gatewayUrl);
  const setAuth = useAuthStore((state) => state.setAuth);
  const clearAuth = useAuthStore((state) => state.clearAuth);
  const email = useAuthStore((state) => state.email);
  const [query, setQuery] = useState('');
  const [remoteResults, setRemoteResults] = useState<readonly SessionSearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const normalizedQuery = query.trim();

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

  const localResults = useMemo(
    () => searchHomeSessions(sessions, normalizedQuery).slice(0, 8),
    [normalizedQuery, sessions],
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [normalizedQuery]);

  useEffect(() => {
    if (!accessToken || !refreshToken || normalizedQuery.length < 2) {
      setRemoteResults([]);
      return;
    }

    const abortController = new AbortController();
    const timeoutId = window.setTimeout(() => {
      void withTokenRefresh(gatewayUrl, tokenStore, (token) =>
        createSessionsClient(gatewayUrl).search(token, normalizedQuery, {
          limit: 8,
          signal: abortController.signal,
        }),
      )
        .then(setRemoteResults)
        .catch((error: unknown) => {
          if (abortController.signal.aborted) {
            return;
          }
          if (error instanceof HttpError && error.status === 401) {
            clearAuth();
            return;
          }
          logger.error('Failed to search sessions:', error);
          setRemoteResults([]);
        });
    }, 180);

    return () => {
      window.clearTimeout(timeoutId);
      abortController.abort();
    };
  }, [accessToken, clearAuth, gatewayUrl, normalizedQuery, refreshToken, tokenStore]);

  const results = useMemo(
    () => mergeSearchResults(localResults, remoteResults),
    [localResults, remoteResults],
  );

  const selectResult = (result: HomeSessionSearchResult) => {
    onSelectSession(result.sessionId, result.title);
    setQuery('');
    setRemoteResults([]);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (results.length === 0) {
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % results.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + results.length) % results.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const activeResult = results[activeIndex];
      if (activeResult) {
        selectResult(activeResult);
      }
    }
  };

  return (
    <div className="home-search" role="search">
      <label className="home-search-label" htmlFor="home-session-search">
        搜索会话
      </label>
      <div className="home-search-input-shell">
        <input
          id="home-session-search"
          type="search"
          value={query}
          placeholder="搜索标题、消息内容、工作区或模型"
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          aria-expanded={normalizedQuery.length > 0 && results.length > 0}
          aria-controls="home-session-search-results"
        />
      </div>

      {normalizedQuery.length > 0 ? (
        <div id="home-session-search-results" className="home-search-results" role="listbox">
          {results.length === 0 ? (
            <div className="home-search-empty">没有匹配的会话</div>
          ) : (
            results.map((result, index) => (
              <button
                key={result.id}
                type="button"
                className="home-search-result"
                data-active={index === activeIndex ? 'true' : 'false'}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectResult(result)}
                role="option"
                aria-selected={index === activeIndex}
              >
                <span className="home-search-result-title">{result.title}</span>
                <span className="home-search-result-snippet">{result.snippet}</span>
                <span className="home-search-result-meta">{result.meta}</span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function mergeSearchResults<TSession extends HomeSessionLike>(
  localResults: readonly TSession[],
  remoteResults: readonly SessionSearchResult[],
): HomeSessionSearchResult[] {
  const resultsBySessionId = new Map<string, HomeSessionSearchResult>();

  for (const session of localResults) {
    const workspacePath = getWorkingDirectory(session.metadata_json);
    resultsBySessionId.set(session.id, {
      id: `local-${session.id}`,
      meta: `${getWorkspaceName(workspacePath)} · ${formatRelativeTime(session.updated_at)}`,
      sessionId: session.id,
      snippet: workspacePath ?? session.state_status ?? '本地会话字段匹配',
      source: 'local',
      title: getSessionTitle(session),
    });
  }

  for (const result of remoteResults) {
    const existing = resultsBySessionId.get(result.sessionId);
    resultsBySessionId.set(result.sessionId, {
      id: `message-${result.messageId}`,
      meta: `消息内容 · ${formatRelativeTime(result.updatedAt)}`,
      sessionId: result.sessionId,
      snippet: result.snippet,
      source: 'message',
      title: result.title ?? existing?.title ?? `会话 ${result.sessionId.slice(0, 8)}`,
    });
  }

  return Array.from(resultsBySessionId.values()).sort((left, right) => {
    if (left.source === right.source) {
      return 0;
    }
    return left.source === 'local' ? -1 : 1;
  });
}
