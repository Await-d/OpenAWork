// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../../stores/auth/auth.js';
import { useSessionContentSearch } from './use-session-content-search.js';

const searchMock = vi.hoisted(() => vi.fn());

vi.mock('@openAwork/web-client', () => ({
  createSessionsClient: () => ({ search: searchMock }),
  withTokenRefresh: async (
    _gatewayUrl: string,
    _tokenStore: unknown,
    run: (token: string) => Promise<unknown>,
  ) => run('token'),
  HttpError: class HttpError extends Error {
    status: number;

    constructor(status: number) {
      super('http error');
      this.status = status;
    }
  },
}));

function Harness({ query, enabled = true }: { query: string; enabled?: boolean }) {
  const state = useSessionContentSearch(query, enabled);

  return (
    <div>
      <span data-testid="ids">{[...state.matchedSessionIds].sort().join(',')}</span>
      <span data-testid="snippet">{state.snippetBySessionId.get('session-a') ?? ''}</span>
    </div>
  );
}

function makeSearchResult(sessionId: string, snippet: string) {
  return {
    createdAtMs: 1,
    messageId: `message-${sessionId}`,
    role: 'user',
    sessionId,
    snippet,
    title: null,
    updatedAt: '2026-07-07T08:00:00.000Z',
  };
}

beforeEach(() => {
  searchMock.mockReset();
  useAuthStore.setState({
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    gatewayUrl: 'http://localhost:3000',
  });
});

afterEach(() => {
  cleanup();
  useAuthStore.setState({ accessToken: null, refreshToken: null });
});

describe('useSessionContentSearch', () => {
  it('查询长度不足或禁用时不发起请求', () => {
    render(<Harness query="a" />);
    expect(searchMock).not.toHaveBeenCalled();

    render(<Harness query="hello" enabled={false} />);
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('防抖后暴露命中的会话集合与片段', async () => {
    searchMock.mockResolvedValue([
      makeSearchResult('session-a', 'hello world'),
      makeSearchResult('session-b', 'hello again'),
    ]);

    render(<Harness query="hello" />);

    await waitFor(() => {
      expect(screen.getByTestId('ids').textContent).toBe('session-a,session-b');
    });
    expect(screen.getByTestId('snippet').textContent).toBe('hello world');
    expect(searchMock).toHaveBeenCalledTimes(1);
  });

  it('请求失败时降级为空结果且不抛错', async () => {
    searchMock.mockRejectedValue(new Error('network down'));

    render(<Harness query="hello" />);

    await waitFor(() => {
      expect(searchMock).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId('ids').textContent).toBe('');
  });
});
