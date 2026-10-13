// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createSettingsClient: vi.fn(),
  getDisplayPreferences: vi.fn(),
  putDisplayPreferences: vi.fn(),
}));

vi.mock('@openAwork/web-client', () => ({
  acquireRefresh: vi.fn(),
  createSettingsClient: mocks.createSettingsClient,
}));

type AuthModule = typeof import('../auth/auth.js');
type DisplayModule = typeof import('./display-preferences.js');
type UiModule = typeof import('../ui/uiState.js');
type SyncModule = typeof import('./display-preferences-sync.js');

const SYNC_META_KEY = 'openAwork-display-preferences-sync';
const GATEWAY_URL = 'https://gw.test';
const EMAIL = 'display@example.com';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

/**
 * 每个用例重置模块缓存后重新加载，保证模块级同步状态（scope / 快照 / 队列）互不串扰。
 * `prepareDisplay` 在同步模块注册订阅之前运行，用于构造「本机已有设置」的初始状态。
 */
async function loadModules(options?: {
  prepareDisplay?: (display: DisplayModule) => void;
}): Promise<{ auth: AuthModule; display: DisplayModule; ui: UiModule; sync: SyncModule }> {
  const auth = await import('../auth/auth.js');
  const display = await import('./display-preferences.js');
  options?.prepareDisplay?.(display);
  const ui = await import('../ui/uiState.js');
  const sync = await import('./display-preferences-sync.js');
  return { auth, display, ui, sync };
}

function setAuth(
  auth: AuthModule,
  overrides?: { accessToken?: string; email?: string; gatewayUrl?: string },
): void {
  auth.useAuthStore.setState({
    accessToken: overrides?.accessToken ?? 'token-a',
    email: overrides?.email ?? EMAIL,
    gatewayUrl: overrides?.gatewayUrl ?? GATEWAY_URL,
  });
}

/** 触发一次启动方向决策（与 `useDisplayPreferencesSyncBootstrap` 同一入口，免去 React 渲染）。 */
function startBootstrap(sync: SyncModule): void {
  sync.useDisplayPreferencesSyncStore.getState().retry();
}

async function waitUntil(assertion: () => void, timeoutMs = 2000): Promise<void> {
  const startedAt = Date.now();
  for (;;) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() - startedAt > timeoutMs) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

beforeEach(() => {
  vi.resetModules();
  window.localStorage.clear();
  mocks.createSettingsClient.mockReset();
  mocks.getDisplayPreferences.mockReset();
  mocks.putDisplayPreferences.mockReset();
  mocks.createSettingsClient.mockImplementation(() => ({
    getDisplayPreferences: mocks.getDisplayPreferences,
    putDisplayPreferences: mocks.putDisplayPreferences,
  }));
});

describe('display preferences remote sync', () => {
  it('服务端已有记录时应用远端值（含主题镜像 key），且不回推', async () => {
    const { auth, display, ui, sync } = await loadModules();
    setAuth(auth);
    mocks.getDisplayPreferences.mockResolvedValue({
      preferences: {
        themeMode: 'dark',
        themeStyle: 'ocean',
        showMetaLine: false,
        messageLayout: 'split',
        workbenchLayoutMode: 'classic',
      },
      updatedAt: '2026-10-12T00:00:00.000Z',
    });

    startBootstrap(sync);

    await waitUntil(() =>
      expect(sync.useDisplayPreferencesSyncStore.getState().status).toBe('synced'),
    );
    const state = display.useDisplayPreferencesStore.getState();
    expect(state.themeMode).toBe('dark');
    expect(state.themeStyle).toBe('ocean');
    expect(state.showMetaLine).toBe(false);
    expect(state.messageLayout).toBe('split');
    expect(ui.useUIStateStore.getState().workbenchLayoutMode).toBe('classic');
    expect(window.localStorage.getItem('theme-style')).toBe('ocean');
    expect(window.localStorage.getItem('theme-mode')).toBe('dark');
    expect(mocks.putDisplayPreferences).not.toHaveBeenCalled();
  });

  it('服务端无记录时把本机已有设置作为种子推上去', async () => {
    const { auth, sync } = await loadModules({
      prepareDisplay: (display) => {
        display.useDisplayPreferencesStore.getState().setThemeStyle('sakura');
        display.useDisplayPreferencesStore.getState().setShowVoiceInputButton(false);
      },
    });
    setAuth(auth);
    mocks.getDisplayPreferences.mockResolvedValue({ preferences: null, updatedAt: null });
    mocks.putDisplayPreferences.mockResolvedValue({
      preferences: {},
      updatedAt: '2026-10-12T00:00:00.000Z',
    });

    startBootstrap(sync);

    await waitUntil(() => expect(mocks.putDisplayPreferences).toHaveBeenCalledTimes(1));
    const payload = mocks.putDisplayPreferences.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload['themeStyle']).toBe('sakura');
    expect(payload['showVoiceInputButton']).toBe(false);
    expect(payload).toHaveProperty('workbenchLayoutMode');
    await waitUntil(() =>
      expect(sync.useDisplayPreferencesSyncStore.getState().status).toBe('synced'),
    );
    const meta = JSON.parse(window.localStorage.getItem(SYNC_META_KEY) ?? '{}') as {
      ownerEmail?: string;
      pendingPush?: boolean;
    };
    expect(meta.ownerEmail).toBe(EMAIL);
    expect(meta.pendingPush).toBe(false);
  });

  it('启动 GET 失败时保留本地设置并给出错误状态', async () => {
    const { auth, display, sync } = await loadModules({
      prepareDisplay: (display) => {
        display.useDisplayPreferencesStore.getState().setThemeStyle('forest');
      },
    });
    setAuth(auth);
    mocks.getDisplayPreferences.mockRejectedValue(new Error('云端读取失败'));

    startBootstrap(sync);

    await waitUntil(() =>
      expect(sync.useDisplayPreferencesSyncStore.getState().status).toBe('error'),
    );
    expect(display.useDisplayPreferencesStore.getState().themeStyle).toBe('forest');
    expect(sync.useDisplayPreferencesSyncStore.getState().errorMessage).toBe('云端读取失败');
    expect(mocks.putDisplayPreferences).not.toHaveBeenCalled();
  });

  it('本地修改经 500ms 防抖合并成一次全量 PUT', async () => {
    const { auth, display, sync } = await loadModules();
    setAuth(auth);
    mocks.getDisplayPreferences.mockResolvedValue({
      preferences: { themeMode: 'dark' },
      updatedAt: '2026-10-12T00:00:00.000Z',
    });
    mocks.putDisplayPreferences.mockResolvedValue({
      preferences: {},
      updatedAt: '2026-10-12T00:00:01.000Z',
    });

    startBootstrap(sync);
    await waitUntil(() =>
      expect(sync.useDisplayPreferencesSyncStore.getState().status).toBe('synced'),
    );

    display.useDisplayPreferencesStore.getState().setShowMetaLine(false);
    display.useDisplayPreferencesStore.getState().setShowMessageTimestamps(false);
    expect(mocks.putDisplayPreferences).not.toHaveBeenCalled();

    await waitUntil(() => expect(mocks.putDisplayPreferences).toHaveBeenCalledTimes(1));
    const payload = mocks.putDisplayPreferences.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload['showMetaLine']).toBe(false);
    expect(payload['showMessageTimestamps']).toBe(false);
    expect(payload['themeMode']).toBe('dark');
    expect(payload).toHaveProperty('workbenchLayoutMode');

    // 防抖窗口内两次修改只发一次请求；等待一个窗口期确认没有追加请求。
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(mocks.putDisplayPreferences).toHaveBeenCalledTimes(1);
  });

  it('PUT 失败后记录 pendingPush，下次启动跳过 GET 直接推本地', async () => {
    const first = await loadModules();
    setAuth(first.auth);
    mocks.getDisplayPreferences.mockResolvedValue({ preferences: null, updatedAt: null });
    mocks.putDisplayPreferences.mockRejectedValue(new Error('云端写入失败'));

    startBootstrap(first.sync);
    await waitUntil(() =>
      expect(first.sync.useDisplayPreferencesSyncStore.getState().status).toBe('error'),
    );
    const meta = JSON.parse(window.localStorage.getItem(SYNC_META_KEY) ?? '{}') as {
      ownerEmail?: string;
      pendingPush?: boolean;
    };
    expect(meta.pendingPush).toBe(true);
    expect(meta.ownerEmail).toBe(EMAIL);

    // 模拟重启：模块状态清零，但 localStorage（meta + 本地偏好）保留。
    vi.resetModules();
    mocks.getDisplayPreferences.mockClear();
    mocks.putDisplayPreferences.mockClear();
    mocks.putDisplayPreferences.mockResolvedValue({
      preferences: {},
      updatedAt: '2026-10-12T00:00:02.000Z',
    });

    const second = await loadModules();
    setAuth(second.auth);
    startBootstrap(second.sync);

    await waitUntil(() => expect(mocks.putDisplayPreferences).toHaveBeenCalledTimes(1));
    expect(mocks.getDisplayPreferences).not.toHaveBeenCalled();
    await waitUntil(() =>
      expect(second.sync.useDisplayPreferencesSyncStore.getState().status).toBe('synced'),
    );
    const healedMeta = JSON.parse(window.localStorage.getItem(SYNC_META_KEY) ?? '{}') as {
      pendingPush?: boolean;
    };
    expect(healedMeta.pendingPush).toBe(false);
  });

  it('换账号且服务端为空时重置为出厂默认，不把旧账号设置当种子', async () => {
    window.localStorage.setItem(
      SYNC_META_KEY,
      JSON.stringify({ ownerEmail: 'user-a@example.com' }),
    );
    const { auth, display, ui, sync } = await loadModules({
      prepareDisplay: (display) => {
        display.useDisplayPreferencesStore.getState().setThemeStyle('ocean');
        display.useDisplayPreferencesStore.getState().setThemeMode('dark');
        display.useDisplayPreferencesStore.getState().setShowMetaLine(false);
      },
    });
    setAuth(auth, { accessToken: 'token-b', email: 'user-b@example.com' });
    mocks.getDisplayPreferences.mockResolvedValue({ preferences: null, updatedAt: null });

    startBootstrap(sync);

    await waitUntil(() =>
      expect(sync.useDisplayPreferencesSyncStore.getState().status).toBe('synced'),
    );
    const state = display.useDisplayPreferencesStore.getState();
    expect(state.themeStyle).toBe('carbon');
    expect(state.themeMode).toBe('system');
    expect(state.showMetaLine).toBe(true);
    expect(ui.useUIStateStore.getState().workbenchLayoutMode).toBe('fusion');
    expect(mocks.putDisplayPreferences).not.toHaveBeenCalled();
  });

  it('本地在 GET 返回前有改动时保留本地并推上去自愈', async () => {
    const { auth, display, sync } = await loadModules();
    setAuth(auth);
    const deferred = createDeferred<{
      preferences: Record<string, unknown> | null;
      updatedAt: string | null;
    }>();
    mocks.getDisplayPreferences.mockReturnValue(deferred.promise);
    mocks.putDisplayPreferences.mockResolvedValue({
      preferences: {},
      updatedAt: '2026-10-12T00:00:03.000Z',
    });

    startBootstrap(sync);
    await waitUntil(() => expect(mocks.getDisplayPreferences).toHaveBeenCalledTimes(1));

    // 用户在 GET 返回前改了主题。
    display.useDisplayPreferencesStore.getState().setThemeStyle('sakura');

    deferred.resolve({
      preferences: { themeStyle: 'carbon' },
      updatedAt: '2026-10-12T00:00:00.000Z',
    });

    await waitUntil(() =>
      expect(sync.useDisplayPreferencesSyncStore.getState().status).toBe('synced'),
    );
    expect(display.useDisplayPreferencesStore.getState().themeStyle).toBe('sakura');
    await waitUntil(() => expect(mocks.putDisplayPreferences).toHaveBeenCalledTimes(1));
    const payload = mocks.putDisplayPreferences.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload['themeStyle']).toBe('sakura');
  });

  it('工作台布局变更会触发同步推送', async () => {
    const { auth, ui, sync } = await loadModules();
    setAuth(auth);
    mocks.getDisplayPreferences.mockResolvedValue({
      preferences: { themeMode: 'system' },
      updatedAt: '2026-10-12T00:00:00.000Z',
    });
    mocks.putDisplayPreferences.mockResolvedValue({
      preferences: {},
      updatedAt: '2026-10-12T00:00:04.000Z',
    });

    startBootstrap(sync);
    await waitUntil(() =>
      expect(sync.useDisplayPreferencesSyncStore.getState().status).toBe('synced'),
    );

    ui.useUIStateStore.getState().setWorkbenchLayoutMode('classic');

    await waitUntil(() => expect(mocks.putDisplayPreferences).toHaveBeenCalledTimes(1));
    const payload = mocks.putDisplayPreferences.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload['workbenchLayoutMode']).toBe('classic');
  });

  it('同 scope 重新 bootstrap 时，GET 在途期间已成功推送的改动不会被旧响应回滚', async () => {
    const { auth, display, sync } = await loadModules();
    setAuth(auth);
    mocks.getDisplayPreferences.mockResolvedValueOnce({
      preferences: { themeStyle: 'ocean' },
      updatedAt: '2026-10-12T00:00:00.000Z',
    });
    mocks.putDisplayPreferences.mockResolvedValue({
      preferences: {},
      updatedAt: '2026-10-12T00:00:07.000Z',
    });

    startBootstrap(sync);
    await waitUntil(() =>
      expect(sync.useDisplayPreferencesSyncStore.getState().status).toBe('synced'),
    );

    // token 刷新等导致的同 scope 重跑：第二次 GET 挂起不返回。
    const deferred = createDeferred<{
      preferences: Record<string, unknown> | null;
      updatedAt: string | null;
    }>();
    mocks.getDisplayPreferences.mockReturnValueOnce(deferred.promise);
    startBootstrap(sync);
    await waitUntil(() => expect(mocks.getDisplayPreferences).toHaveBeenCalledTimes(2));

    // 用户在 GET 在途期间修改并成功推送。
    display.useDisplayPreferencesStore.getState().setThemeStyle('sakura');
    await waitUntil(() => expect(mocks.putDisplayPreferences).toHaveBeenCalledTimes(1), 3000);

    // 旧 GET 响应（推送前的服务端数据）此刻才返回：不得回滚本地。
    deferred.resolve({
      preferences: { themeStyle: 'ocean' },
      updatedAt: '2026-10-12T00:00:00.000Z',
    });
    await waitUntil(() =>
      expect(sync.useDisplayPreferencesSyncStore.getState().status).toBe('synced'),
    );
    expect(display.useDisplayPreferencesStore.getState().themeStyle).toBe('sakura');
    expect(mocks.putDisplayPreferences).toHaveBeenCalledTimes(1);
  });

  it('改回快照值后走快进分支时会清除 pendingPush 标记', async () => {
    const { auth, display, sync } = await loadModules();
    setAuth(auth);
    mocks.getDisplayPreferences.mockResolvedValue({
      preferences: { themeStyle: 'ocean' },
      updatedAt: '2026-10-12T00:00:00.000Z',
    });
    mocks.putDisplayPreferences.mockRejectedValueOnce(new Error('云端写入失败'));
    mocks.putDisplayPreferences.mockResolvedValue({
      preferences: {},
      updatedAt: '2026-10-12T00:00:08.000Z',
    });

    startBootstrap(sync);
    await waitUntil(() =>
      expect(sync.useDisplayPreferencesSyncStore.getState().status).toBe('synced'),
    );

    // 改一个值 → 推送失败 → 写入 pendingPush。
    display.useDisplayPreferencesStore.getState().setThemeStyle('sakura');
    await waitUntil(
      () => expect(sync.useDisplayPreferencesSyncStore.getState().status).toBe('error'),
      3000,
    );
    const failedMeta = JSON.parse(window.localStorage.getItem(SYNC_META_KEY) ?? '{}') as {
      pendingPush?: boolean;
    };
    expect(failedMeta.pendingPush).toBe(true);

    // 改回原值 → 载荷与已知远端快照一致 → 快进分支应同步清除标记，
    // 否则下次启动会跳过 GET 盲目覆盖服务端。
    display.useDisplayPreferencesStore.getState().setThemeStyle('ocean');
    await waitUntil(
      () => expect(sync.useDisplayPreferencesSyncStore.getState().status).toBe('synced'),
      3000,
    );
    const healedMeta = JSON.parse(window.localStorage.getItem(SYNC_META_KEY) ?? '{}') as {
      pendingPush?: boolean;
    };
    expect(healedMeta.pendingPush).toBe(false);
  });

  it('换账号且服务端已有部分记录时，缺失字段回落出厂默认而不是沿用旧账号', async () => {
    window.localStorage.setItem(
      SYNC_META_KEY,
      JSON.stringify({ ownerEmail: 'user-a@example.com' }),
    );
    const { auth, display, sync } = await loadModules({
      prepareDisplay: (display) => {
        display.useDisplayPreferencesStore.getState().setThemeStyle('ocean');
        display.useDisplayPreferencesStore.getState().setThemeMode('dark');
        display.useDisplayPreferencesStore.getState().setShowMetaLine(false);
      },
    });
    setAuth(auth, { accessToken: 'token-b', email: 'user-b@example.com' });
    mocks.getDisplayPreferences.mockResolvedValue({
      preferences: { themeMode: 'light' },
      updatedAt: '2026-10-12T00:00:00.000Z',
    });

    startBootstrap(sync);
    await waitUntil(() =>
      expect(sync.useDisplayPreferencesSyncStore.getState().status).toBe('synced'),
    );
    const state = display.useDisplayPreferencesStore.getState();
    expect(state.themeMode).toBe('light');
    expect(state.themeStyle).toBe('carbon');
    expect(state.showMetaLine).toBe(true);
    expect(mocks.putDisplayPreferences).not.toHaveBeenCalled();
  });

  it('远端非法或未知字段被忽略，本机值保留', async () => {
    const { auth, display, sync } = await loadModules();
    setAuth(auth);
    mocks.getDisplayPreferences.mockResolvedValue({
      preferences: {
        themeMode: 'neon',
        toolExpandedOverrides: { bash: true },
        unknownField: 'x',
        showMetaLine: false,
      },
      updatedAt: '2026-10-12T00:00:00.000Z',
    });

    startBootstrap(sync);
    await waitUntil(() =>
      expect(sync.useDisplayPreferencesSyncStore.getState().status).toBe('synced'),
    );
    const state = display.useDisplayPreferencesStore.getState();
    expect(state.themeMode).toBe('system');
    expect(state.toolExpandedOverrides).toEqual({
      bash: false,
      fileEdit: true,
      fileRead: false,
      mcp: false,
      skill: false,
      web: false,
      batch: false,
      other: false,
    });
    expect(state.showMetaLine).toBe(false);
  });

  it('pendingPush 属于其他账号时必须走 GET，而不是跳过 GET 盲目推本地', async () => {
    window.localStorage.setItem(
      SYNC_META_KEY,
      JSON.stringify({ pendingPush: true, ownerEmail: 'user-a@example.com' }),
    );
    const { auth, display, sync } = await loadModules();
    setAuth(auth, { accessToken: 'token-b', email: 'user-b@example.com' });
    mocks.getDisplayPreferences.mockResolvedValue({
      preferences: { themeStyle: 'forest' },
      updatedAt: '2026-10-12T00:00:00.000Z',
    });

    startBootstrap(sync);
    await waitUntil(() =>
      expect(sync.useDisplayPreferencesSyncStore.getState().status).toBe('synced'),
    );
    expect(mocks.getDisplayPreferences).toHaveBeenCalledTimes(1);
    expect(mocks.putDisplayPreferences).not.toHaveBeenCalled();
    expect(display.useDisplayPreferencesStore.getState().themeStyle).toBe('forest');
  });

  it('GET 失败后重试成功时，失败期间的本地编辑会被推送上去', async () => {
    const { auth, display, sync } = await loadModules();
    setAuth(auth);
    mocks.getDisplayPreferences.mockRejectedValueOnce(new Error('云端读取失败'));
    mocks.getDisplayPreferences.mockResolvedValue({
      preferences: { themeStyle: 'ocean' },
      updatedAt: '2026-10-12T00:00:00.000Z',
    });
    mocks.putDisplayPreferences.mockResolvedValue({
      preferences: {},
      updatedAt: '2026-10-12T00:00:09.000Z',
    });

    startBootstrap(sync);
    await waitUntil(() =>
      expect(sync.useDisplayPreferencesSyncStore.getState().status).toBe('error'),
    );

    // GET 失败期间用户改动：同步方向未定，推送被拦截。
    display.useDisplayPreferencesStore.getState().setThemeStyle('sakura');
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(mocks.putDisplayPreferences).not.toHaveBeenCalled();
    expect(display.useDisplayPreferencesStore.getState().themeStyle).toBe('sakura');

    // 手动重试：服务端有记录但本地有未推送改动 → 保留本地并推送。
    sync.useDisplayPreferencesSyncStore.getState().retry();
    await waitUntil(() => expect(mocks.putDisplayPreferences).toHaveBeenCalledTimes(1), 3000);
    const payload = mocks.putDisplayPreferences.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload['themeStyle']).toBe('sakura');
    expect(display.useDisplayPreferencesStore.getState().themeStyle).toBe('sakura');
  });
});
