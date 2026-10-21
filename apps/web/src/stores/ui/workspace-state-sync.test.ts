// @vitest-environment jsdom
/**
 * 工作台现场同步：本地为种子、远端回灌、GET 在途改动优先本地。
 *
 * 模块是「单例 + 模块级订阅」的形态，每个用例先 `resetModules` 再动态 import，
 * 保证订阅、去抖计时器与 scope 互不串味。
 */

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const settingsMocks = vi.hoisted(() => ({
  getWorkspaceState: vi.fn(),
  putWorkspaceState: vi.fn(),
}));

vi.mock('@openAwork/web-client', () => ({
  createSettingsClient: () => ({
    getWorkspaceState: settingsMocks.getWorkspaceState,
    putWorkspaceState: settingsMocks.putWorkspaceState,
  }),
}));

const WORKSPACE = '/w/a';
const TABS_KEY = `openawork:builtin-browser:tabs:v1:${WORKSPACE}`;
const BOOKMARKS_KEY = 'openawork:builtin-browser:bookmarks:v1';

const SAMPLE_TABS = {
  version: 1,
  activeTabId: 'tab-1',
  tabs: [
    {
      id: 'tab-1',
      url: 'https://example.test/app',
      title: 'App',
      history: ['https://example.test/app'],
      historyIndex: 0,
    },
  ],
};

type SyncModule = typeof import('./workspace-state-sync.js');
type UiStoreModule = typeof import('./uiState.js');
type AuthStoreModule = typeof import('../auth/auth.js');

interface Harness {
  sync: SyncModule;
  ui: UiStoreModule;
}

async function loadHarness(): Promise<Harness> {
  vi.resetModules();
  const sync = await import('./workspace-state-sync.js');
  const ui = await import('./uiState.js');
  const auth = (await import('../auth/auth.js')) as AuthStoreModule;
  auth.useAuthStore.setState({
    accessToken: 'token-1',
    email: 'ada@example.com',
    gatewayUrl: 'http://gateway.test',
  });
  return { sync, ui };
}

beforeEach(() => {
  localStorage.clear();
  settingsMocks.getWorkspaceState.mockReset();
  settingsMocks.putWorkspaceState.mockReset();
  settingsMocks.putWorkspaceState.mockResolvedValue({ state: null, updatedAt: null });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
});

describe('collectBrowserTabsByWorkspace', () => {
  it('按工作区前缀枚举本地标签快照', async () => {
    localStorage.setItem(TABS_KEY, JSON.stringify(SAMPLE_TABS));
    // 另一个工作区的现场同样按自己的键收进来：服务端按工作区分桶存储。
    localStorage.setItem(
      'openawork:builtin-browser:tabs:v1:/w/b',
      JSON.stringify({
        version: 1,
        activeTabId: 't2',
        tabs: [
          {
            id: 't2',
            url: 'http://localhost:4173/',
            history: ['http://localhost:4173/'],
            historyIndex: 0,
          },
        ],
      }),
    );

    const { sync } = await loadHarness();
    const collected = sync.collectBrowserTabsByWorkspace();

    expect(collected[WORKSPACE]?.activeTabId).toBe('tab-1');
    expect(collected[WORKSPACE]?.tabs[0]?.url).toBe('https://example.test/app');
    expect(Object.keys(collected).sort()).toEqual([WORKSPACE, '/w/b']);
  });
});

describe('workspace state bootstrap', () => {
  it('服务端无记录时以本地现场为种子推送', async () => {
    settingsMocks.getWorkspaceState.mockResolvedValue({ state: null, updatedAt: null });
    localStorage.setItem(TABS_KEY, JSON.stringify(SAMPLE_TABS));
    localStorage.setItem(
      BOOKMARKS_KEY,
      JSON.stringify([{ id: 'bm-1', url: 'https://example.test/', title: '站点', createdAt: 1 }]),
    );

    const { sync } = await loadHarness();
    renderHook(() => sync.useWorkspaceStateSyncBootstrap(true));

    await waitFor(() => expect(settingsMocks.putWorkspaceState).toHaveBeenCalledTimes(1));

    const payload = settingsMocks.putWorkspaceState.mock.calls[0]?.[1] as {
      uiState: Record<string, unknown>;
      bookmarks: unknown[];
      browserTabsByWorkspace: Record<string, { activeTabId: string }>;
    };
    expect(payload.uiState).toBeTypeOf('object');
    expect(payload.bookmarks).toHaveLength(1);
    expect(payload.browserTabsByWorkspace[WORKSPACE]?.activeTabId).toBe('tab-1');
  });

  it('服务端有快照且本地无改动时回灌（UI 状态 / 书签 / 标签页）', async () => {
    settingsMocks.getWorkspaceState.mockResolvedValue({
      state: {
        version: 1,
        uiStateVersion: 28,
        uiState: {
          browserPreviewUrlByWorkspace: { [WORKSPACE]: 'http://localhost:5173' },
          rightOpen: true,
          rightTab: 'overview',
        },
        bookmarks: [
          { id: 'bm-remote', url: 'https://remote.test/', title: '远端书签', createdAt: 2 },
        ],
        browserTabsByWorkspace: {
          [WORKSPACE]: { tabs: SAMPLE_TABS.tabs, activeTabId: 'tab-remote' },
        },
      },
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const { sync, ui } = await loadHarness();
    renderHook(() => sync.useWorkspaceStateSyncBootstrap(true));

    await waitFor(() =>
      expect(ui.useUIStateStore.getState().browserPreviewUrlByWorkspace[WORKSPACE]).toBe(
        'http://localhost:5173',
      ),
    );
    expect(ui.useUIStateStore.getState().rightOpen).toBe(true);

    const storedBookmarks = JSON.parse(localStorage.getItem(BOOKMARKS_KEY) ?? '[]') as Array<{
      id: string;
    }>;
    expect(storedBookmarks[0]?.id).toBe('bm-remote');

    const storedTabs = JSON.parse(localStorage.getItem(TABS_KEY) ?? '{}') as {
      activeTabId?: string;
    };
    expect(storedTabs.activeTabId).toBe('tab-remote');

    // 回灌不等于需要回推：远端内容刚写回本地，不应立刻再 PUT 一次。
    expect(settingsMocks.putWorkspaceState).not.toHaveBeenCalled();
  });

  it('本地改动经去抖合并后推送，内容未变不重复 PUT', async () => {
    settingsMocks.getWorkspaceState.mockResolvedValue({ state: null, updatedAt: null });

    const { sync, ui } = await loadHarness();
    renderHook(() => sync.useWorkspaceStateSyncBootstrap(true));

    // 首次种子推送。
    await waitFor(() => expect(settingsMocks.putWorkspaceState).toHaveBeenCalledTimes(1));

    vi.useFakeTimers();
    act(() => {
      ui.useUIStateStore.getState().setRightOpen(true);
    });
    await act(async () => {
      vi.advanceTimersByTime(900);
    });
    expect(settingsMocks.putWorkspaceState).toHaveBeenCalledTimes(2);

    // 再写一次同样的值：内容没变，不该再打一次 PUT。
    act(() => {
      ui.useUIStateStore.getState().setRightOpen(true);
    });
    await act(async () => {
      vi.advanceTimersByTime(900);
    });
    expect(settingsMocks.putWorkspaceState).toHaveBeenCalledTimes(2);
  });

  it('上次推送失败（pendingPush）时跳过 GET，以本地为准推送', async () => {
    localStorage.setItem(
      'openAwork-workspace-state-sync',
      JSON.stringify({ ownerEmail: 'ada@example.com', pendingPush: true }),
    );
    localStorage.setItem(TABS_KEY, JSON.stringify(SAMPLE_TABS));

    const { sync } = await loadHarness();
    renderHook(() => sync.useWorkspaceStateSyncBootstrap(true));

    await waitFor(() => expect(settingsMocks.putWorkspaceState).toHaveBeenCalledTimes(1));
    // 本地优先自愈：不读远端，避免把远端旧值盖到本地未推成功的改动上。
    expect(settingsMocks.getWorkspaceState).not.toHaveBeenCalled();

    const payload = settingsMocks.putWorkspaceState.mock.calls[0]?.[1] as {
      browserTabsByWorkspace: Record<string, { activeTabId: string }>;
    };
    expect(payload.browserTabsByWorkspace[WORKSPACE]?.activeTabId).toBe('tab-1');
  });

  it('本机没有持久化现场（换设备 / 清缓存）：无条件采用远端，启动噪声不回推', async () => {
    let resolveGet: ((value: { state: unknown; updatedAt: string }) => void) | null = null;
    settingsMocks.getWorkspaceState.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveGet = resolve;
        }),
    );

    const { sync, ui } = await loadHarness();
    renderHook(() => sync.useWorkspaceStateSyncBootstrap(true));

    await waitFor(() => expect(settingsMocks.getWorkspaceState).toHaveBeenCalledTimes(1));

    // 启动期自身写入的状态（例如路由 / 面板初始化）不算用户意图。
    act(() => {
      ui.useUIStateStore.getState().setRightOpen(true);
    });

    await act(async () => {
      resolveGet?.({
        state: {
          version: 1,
          uiStateVersion: 28,
          uiState: {
            browserPreviewUrlByWorkspace: { [WORKSPACE]: 'http://localhost:5173' },
            rightOpen: false,
          },
          bookmarks: [],
          browserTabsByWorkspace: {},
        },
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
    });

    await waitFor(() =>
      expect(ui.useUIStateStore.getState().browserPreviewUrlByWorkspace[WORKSPACE]).toBe(
        'http://localhost:5173',
      ),
    );
    expect(ui.useUIStateStore.getState().rightOpen).toBe(false);
    expect(settingsMocks.putWorkspaceState).not.toHaveBeenCalled();
  });
});
