/**
 * useSessions.newSession —— 草稿会话语义回归测试
 *
 * 需求：点击「新建会话」不立即落库空会话，真正的会话在用户发出首条消息时
 * 由 ChatPage 惰性创建，因此连续点击不会堆积空对话。
 */
/**
 * useSessions —— 会话列表加载韧性回归测试
 *
 * 需求：桌面端每次页面加载都会由原生侧执行 start_gateway（可能短暂打断网关），
 * 因此本页首帧发出的 /sessions 可能收到一次「传输层失败」。这种瞬时抖动必须被
 * 重试自愈，而不是把侧边栏永久按在「会话列表加载失败」的错误态上。
 */
import type { ReactNode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '@openAwork/web-client';
import { useSessions } from './useSessions.js';
import { useAuthStore } from '../../stores/auth/auth.js';
import { useUIStateStore } from '../../stores/ui/uiState.js';

const sessionsClientMocks = vi.hoisted(() => ({
  create: vi.fn(async () => ({ id: 'created-session' })),
  // 显式标注返回值类型，否则 vi.fn(async () => []) 会被推断成 never[]，
  // 后续 mockResolvedValueOnce([...]) 无法传入真实会话对象。
  list: vi.fn(async (): Promise<unknown[]> => []),
}));

vi.mock('@openAwork/web-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openAwork/web-client')>();
  return {
    ...actual,
    createSessionsClient: () => ({
      create: sessionsClientMocks.create,
      list: sessionsClientMocks.list,
    }),
  };
});

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{location.pathname}</div>;
}

function createWrapper(initialPath = '/chat/session-1') {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={[initialPath]}>
        {children}
        <LocationProbe />
      </MemoryRouter>
    );
  };
}

function renderUseSessions(initialPath?: string) {
  return renderHook(() => useSessions(), { wrapper: createWrapper(initialPath) });
}

beforeEach(() => {
  sessionsClientMocks.create.mockClear();
  sessionsClientMocks.list.mockClear();
  useAuthStore.setState({ accessToken: 'test-token', gatewayUrl: 'http://localhost:3000' });
  useUIStateStore.setState({
    activeTabId: null,
    chatView: 'session',
    savedWorkspacePaths: [],
    selectedWorkspacePath: null,
    tabs: [],
  });
});

afterEach(() => {
  cleanup();
});

describe('useSessions.newSession — 草稿会话', () => {
  it('不创建服务端会话，只切到 /chat 草稿态', async () => {
    const { result } = renderUseSessions();

    await act(async () => {
      await result.current.newSession();
    });

    expect(sessionsClientMocks.create).not.toHaveBeenCalled();
    expect(useUIStateStore.getState().chatView).toBe('home');
    expect(window.document.querySelector('[data-testid="location-probe"]')?.textContent).toBe(
      '/chat',
    );
    expect(useUIStateStore.getState().tabs).toHaveLength(1);
    expect(useUIStateStore.getState().tabs[0]?.type).toBe('draft');
  });

  it('连续点击复用同一个草稿标签，不会无限堆积空对话', async () => {
    const { result } = renderUseSessions();

    await act(async () => {
      await result.current.newSession();
      await result.current.newSession();
      await result.current.newSession();
    });

    expect(sessionsClientMocks.create).not.toHaveBeenCalled();
    expect(useUIStateStore.getState().tabs).toHaveLength(1);
  });

  it('带工作区新建时把草稿绑定到该工作区', async () => {
    const { result } = renderUseSessions();

    await act(async () => {
      await result.current.newSession('/ws/a');
    });

    const state = useUIStateStore.getState();
    expect(sessionsClientMocks.create).not.toHaveBeenCalled();
    expect(state.selectedWorkspacePath).toBe('/ws/a');
    expect(state.savedWorkspacePaths).toContain('/ws/a');
    expect(state.tabs[0]?.workspacePath).toBe('/ws/a');
  });
});

describe('useSessions — 会话列表瞬时失败自愈', () => {
  it('首次传输层失败后按退避自动重试，成功后不进入错误态', async () => {
    sessionsClientMocks.list
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValueOnce([
        { id: 'session-1', title: '会话一', updated_at: '2026-01-02T00:00:00.000Z' },
      ]);

    const { result } = renderUseSessions();

    // 首次请求立即失败 → 进入 400ms 退避 → 第二次成功。
    await waitFor(() => expect(result.current.sessions).toHaveLength(1), { timeout: 3000 });

    expect(sessionsClientMocks.list).toHaveBeenCalledTimes(2);
    expect(result.current.sessionsError).toBeNull();
    expect(result.current.sessions[0]?.id).toBe('session-1');
  });

  it('服务端确定性失败（HttpError）不重试，直接进入错误态', async () => {
    sessionsClientMocks.list.mockRejectedValueOnce(new HttpError('服务端错误', 500));

    const { result } = renderUseSessions();

    await waitFor(() => expect(result.current.sessionsError).toBe('会话列表加载失败'));

    expect(sessionsClientMocks.list).toHaveBeenCalledTimes(1);
  });

  it('慢失败（墙钟超时类）不重试，避免骨架屏被拖长', async () => {
    vi.useFakeTimers();
    try {
      sessionsClientMocks.list.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            window.setTimeout(() => reject(new Error('网络异常，读取会话列表失败。')), 6_000);
          }),
      );

      const { result } = renderUseSessions();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(6_001);
      });

      expect(sessionsClientMocks.list).toHaveBeenCalledTimes(1);
      expect(result.current.sessionsError).toBe('会话列表加载失败');
    } finally {
      vi.useRealTimers();
    }
  });
});
