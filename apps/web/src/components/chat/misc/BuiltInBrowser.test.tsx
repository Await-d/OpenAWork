// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserLiveCallbacks, BrowserLiveStatus } from '@openAwork/web-client';
import { BuiltInBrowser } from './BuiltInBrowser.js';
import { COMPOSER_INSERT_EVENT } from './browser/browser-clipboard.js';
import {
  BROWSER_PREVIEW_SHORTCUTS,
  browserPreviewShortcutTitle,
  type BrowserPreviewShortcutId,
} from './browser/hooks/use-browser-preview-shortcuts.js';
import { useAuthStore } from '../../../stores/auth/auth.js';

const STORAGE_KEY_PREFIX = 'openawork:builtin-browser:tabs:v1';
const LEGACY_DEFAULT_URL = 'http://localhost:3000';

/** 控制台按钮 title 由快捷键描述符派生，测试与实现共用同一份文案。 */
const consoleTitleOpen = browserPreviewShortcutTitle('打开控制台', 'toggleConsole');

const liveMocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  connect: vi.fn(),
  installBrowser: vi.fn(),
  getInstallStatus: vi.fn(),
}));

/**
 * Tauri 原生 webview 的模块替身：Tauri 模式下 `useTauriWebview` 会动态 import
 * 这些模块。测试只关心采集链路，这里让创建流程安静完成（不触发 created/error
 * 回调），避免真实 Tauri API 在 jsdom 里抛错。
 */
const tauriMocks = vi.hoisted(() => {
  class FakeWebview {
    readonly close = vi.fn(async (): Promise<void> => undefined);
    readonly setPosition = vi.fn(async (_position: unknown): Promise<void> => undefined);
    readonly setSize = vi.fn(async (_size: unknown): Promise<void> => undefined);

    once(_event: string, _handler: unknown): Promise<() => void> {
      return Promise.resolve(() => undefined);
    }
  }
  return { FakeWebview };
});

vi.mock('@tauri-apps/api/webview', () => ({ Webview: tauriMocks.FakeWebview }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label: 'main' }) }));
vi.mock('@tauri-apps/api/dpi', () => ({
  LogicalPosition: class LogicalPosition {
    constructor(
      public readonly x: number,
      public readonly y: number,
    ) {}
  },
  LogicalSize: class LogicalSize {
    constructor(
      public readonly width: number,
      public readonly height: number,
    ) {}
  },
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async (): Promise<boolean> => true) }));

vi.mock('@openAwork/web-client', () => ({
  HttpError: class HttpError extends Error {
    constructor(
      message: string,
      public readonly status: number,
      public readonly data?: unknown,
    ) {
      super(message);
    }
  },
  createBrowserLiveClient: () => ({
    getStatus: liveMocks.getStatus,
    connect: liveMocks.connect,
    start: vi.fn(),
    stop: vi.fn(),
    screenshot: vi.fn(),
    installBrowser: liveMocks.installBrowser,
    getInstallStatus: liveMocks.getInstallStatus,
  }),
  // 工作区索引版本轮询（预览自动刷新）依赖它；返回稳定版本，避免触发重载。
  createWorkspaceClient: () => ({
    getFileIndexVersion: vi.fn(async () => ({ root: '', version: 0 })),
  }),
}));

beforeEach(() => {
  localStorage.clear();
  liveMocks.getStatus.mockReset();
  liveMocks.connect.mockReset();
  liveMocks.installBrowser.mockReset();
  liveMocks.getInstallStatus.mockReset();
  useAuthStore.setState({ accessToken: null });
});

afterEach(() => {
  cleanup();
  useAuthStore.setState({ accessToken: null });
});

describe('BuiltInBrowser', () => {
  it('以空白页作为新标签页，避免请求只提供 API 的网关根路径', () => {
    render(<BuiltInBrowser workspacePath="E:\\01.Projects\\OpenAWork" />);

    expect(screen.getByTitle('内置浏览器').getAttribute('src')).toBe('about:blank');
  });

  it('将已持久化的旧网关默认页迁移为空白页', () => {
    const workspacePath = 'E:\\01.Projects\\OpenAWork';
    localStorage.setItem(
      `${STORAGE_KEY_PREFIX}:${workspacePath}`,
      JSON.stringify({
        version: 1,
        tabs: [
          {
            id: 'legacy-tab',
            url: LEGACY_DEFAULT_URL,
            title: 'localhost:3000',
            history: [LEGACY_DEFAULT_URL],
            historyIndex: 0,
          },
        ],
        activeTabId: 'legacy-tab',
      }),
    );

    render(<BuiltInBrowser workspacePath={workspacePath} />);

    expect(screen.getByTitle('内置浏览器').getAttribute('src')).toBe('about:blank');
    expect(screen.getByDisplayValue('about:blank')).toBeTruthy();
  });

  /**
   * 网络上报是分三段（request → response → body）到达的，宿主必须按
   * networkId 归并成**一条**记录并把各阶段字段补齐——否则一个请求会占三行，
   * 且响应体会丢失（后到的那条没有请求信息）。
   */
  it('同一个网络请求的三段上报归并成一条记录', async () => {
    render(<BuiltInBrowser workspacePath="E:\\01.Projects\\OpenAWork" />);
    fireEvent.click(screen.getByTitle(consoleTitleOpen));

    const base = {
      type: 'oaw-network',
      networkId: 'net-42',
      source: 'fetch',
      method: 'POST',
      url: 'http://localhost:3000/api/login',
    };
    const emit = (payload: Record<string, unknown>): void => {
      act(() => {
        window.dispatchEvent(new MessageEvent('message', { data: { ...base, ...payload } }));
      });
    };

    emit({
      requestHeaders: { 'content-type': 'application/json' },
      requestBody: '{"user":"ada"}',
    });
    emit({ status: 200, statusText: 'OK', ok: true, durationMs: 12 });
    emit({ responseBody: '{"token":"abc"}' });

    await waitFor(() => expect(screen.getAllByTestId('console-entry').length).toBe(1));
    expect(screen.getByText(/⟵ 200 POST http:\/\/localhost:3000\/api\/login/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '查看详情' }));
    // 请求体来自第一阶段、响应体来自第三阶段，都要在同一行里能找到。
    expect(screen.getAllByText(/ada/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/token/).length).toBeGreaterThan(0);
    expect(screen.getByText('请求')).toBeTruthy();
    expect(screen.getByText('响应')).toBeTruthy();
  });

  it('网络请求失败时记录错误原因而不是留在请求中', async () => {
    render(<BuiltInBrowser workspacePath="E:\\01.Projects\\OpenAWork" />);
    fireEvent.click(screen.getByTitle(consoleTitleOpen));

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'oaw-network',
            networkId: 'net-err',
            source: 'fetch',
            method: 'GET',
            url: 'http://localhost:3000/api/missing',
            durationMs: 3,
            errorMessage: 'Failed to fetch',
          },
        }),
      );
    });

    await waitFor(() => expect(screen.getByText(/Failed to fetch/)).toBeTruthy());
    expect(screen.getByText(/✗ GET http:\/\/localhost:3000\/api\/missing/)).toBeTruthy();
  });

  it('点击发送错误按钮把控制台错误摘要插入输入框', async () => {
    render(<BuiltInBrowser workspacePath="E:\\01.Projects\\OpenAWork" />);

    const details: Array<{ text: string; mode: string }> = [];
    const listener = (event: Event): void => {
      details.push((event as CustomEvent<{ text: string; mode: string }>).detail);
    };
    window.addEventListener(COMPOSER_INSERT_EVENT, listener);

    try {
      fireEvent.click(screen.getByTitle(consoleTitleOpen));

      act(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: { type: 'oaw-console', level: 'error', message: 'boom-error' },
          }),
        );
      });

      await waitFor(() => {
        const sendButton = screen.getByTitle('发送 1 条错误/失败请求到输入框');
        expect((sendButton as HTMLButtonElement).disabled).toBe(false);
      });

      fireEvent.click(screen.getByTitle('发送 1 条错误/失败请求到输入框'));

      expect(details.length).toBe(1);
      expect(details[0]?.text).toContain('boom-error');
    } finally {
      window.removeEventListener(COMPOSER_INSERT_EVENT, listener);
    }
  });

  it('实时预览不可用（browser-missing）时保持 iframe 路径并给出安装提示', async () => {
    liveMocks.getStatus.mockResolvedValue({
      available: false,
      engine: null,
      screencast: false,
      reason: 'browser-missing',
      installable: true,
      source: null,
      expectedRevision: null,
      executablePath: null,
    } satisfies BrowserLiveStatus);
    useAuthStore.setState({ accessToken: 'live-token', gatewayUrl: 'http://gateway.test' });

    render(<BuiltInBrowser workspacePath="E:\\01.Projects\\OpenAWork" />);

    await waitFor(() => {
      expect(screen.getByText(/安装 Chrome\/Edge/)).toBeTruthy();
    });
    expect(screen.getByText(/npx playwright install chromium/)).toBeTruthy();
    expect(screen.getByTitle('内置浏览器')).toBeTruthy();
    expect(liveMocks.connect).not.toHaveBeenCalled();
  });

  it('实时预览不可用（browser-outdated）时保持 iframe 路径并提示重新安装', async () => {
    liveMocks.getStatus.mockResolvedValue({
      available: false,
      engine: 'chromium',
      screencast: false,
      reason: 'browser-outdated',
      installable: true,
      source: 'managed',
      expectedRevision: '1208',
      executablePath: '/home/user/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome',
    } satisfies BrowserLiveStatus);
    useAuthStore.setState({ accessToken: 'live-token', gatewayUrl: 'http://gateway.test' });

    render(<BuiltInBrowser workspacePath="E:\\01.Projects\\OpenAWork" />);

    await waitFor(() => {
      expect(screen.getByText(/调试浏览器版本与当前 Playwright 不匹配/)).toBeTruthy();
    });
    expect(screen.getByText(/重新执行 npx playwright install chromium/)).toBeTruthy();
    expect(screen.getByTitle('内置浏览器')).toBeTruthy();
    expect(liveMocks.connect).not.toHaveBeenCalled();
  });

  it('browser-missing 且可安装时展示安装按钮，仅在点击后触发安装与轮询', async () => {
    liveMocks.getStatus.mockResolvedValue({
      available: false,
      engine: null,
      screencast: false,
      reason: 'browser-missing',
      installable: true,
      source: null,
      expectedRevision: null,
      executablePath: null,
    } satisfies BrowserLiveStatus);
    liveMocks.installBrowser.mockResolvedValue(undefined);
    liveMocks.getInstallStatus.mockResolvedValue({
      state: 'running',
      startedAt: 1,
      finishedAt: null,
      tailLog: ['正在下载 chromium 50%'],
      error: null,
      browsersPath: '/data/browsers',
    });
    useAuthStore.setState({ accessToken: 'live-token', gatewayUrl: 'http://gateway.test' });

    render(<BuiltInBrowser workspacePath="E:\\01.Projects\\OpenAWork" />);

    const button = await screen.findByRole('button', { name: '安装调试浏览器' });
    expect(liveMocks.installBrowser).not.toHaveBeenCalled();
    expect(liveMocks.getInstallStatus).not.toHaveBeenCalled();

    fireEvent.click(button);

    await waitFor(() => expect(liveMocks.installBrowser).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId('browser-install-progress').textContent).toContain(
        '正在下载 chromium 50%',
      ),
    );
  });

  it('安装成功后重探可用性（无需刷新页面）', async () => {
    const missing = {
      available: false,
      engine: null,
      screencast: false,
      reason: 'browser-missing',
      installable: true,
      source: null,
      expectedRevision: null,
      executablePath: null,
    } satisfies BrowserLiveStatus;
    liveMocks.getStatus.mockResolvedValue(missing);
    liveMocks.installBrowser.mockResolvedValue(undefined);
    liveMocks.getInstallStatus.mockResolvedValue({
      state: 'succeeded',
      startedAt: 1,
      finishedAt: 2,
      tailLog: ['done'],
      error: null,
      browsersPath: '/data/browsers',
    });
    useAuthStore.setState({ accessToken: 'live-token', gatewayUrl: 'http://gateway.test' });

    render(<BuiltInBrowser workspacePath="E:\\01.Projects\\OpenAWork" />);
    const button = await screen.findByRole('button', { name: '安装调试浏览器' });
    const statusCallsBefore = liveMocks.getStatus.mock.calls.length;

    fireEvent.click(button);

    await waitFor(() => expect(screen.getByRole('button', { name: '已安装' })).toBeTruthy());
    // 安装成功后 hook 递增 nonce，可用性 effect 必须重新请求 /browser-live/status。
    await waitFor(() =>
      expect(liveMocks.getStatus.mock.calls.length).toBeGreaterThan(statusCallsBefore),
    );
  });

  it('安装失败（CLI 不可用）时展示错误与手动命令', async () => {
    liveMocks.getStatus.mockResolvedValue({
      available: false,
      engine: null,
      screencast: false,
      reason: 'browser-missing',
      installable: true,
      source: null,
      expectedRevision: null,
      executablePath: null,
    } satisfies BrowserLiveStatus);
    liveMocks.installBrowser.mockResolvedValue(undefined);
    liveMocks.getInstallStatus.mockResolvedValue({
      state: 'unavailable',
      startedAt: null,
      finishedAt: 2,
      tailLog: [],
      error: '当前运行环境未内置 Playwright 安装器',
      browsersPath: null,
    });
    useAuthStore.setState({ accessToken: 'live-token', gatewayUrl: 'http://gateway.test' });

    render(<BuiltInBrowser workspacePath="E:\\01.Projects\\OpenAWork" />);
    fireEvent.click(await screen.findByRole('button', { name: '安装调试浏览器' }));

    await waitFor(() => {
      const error = screen.getByTestId('browser-install-error');
      expect(error.textContent).toContain('未内置 Playwright 安装器');
      expect(error.textContent).toContain('npx playwright install chromium');
    });
  });

  it('disabled runtime 时不展示安装按钮', async () => {
    liveMocks.getStatus.mockResolvedValue({
      available: false,
      engine: null,
      screencast: false,
      reason: 'browser live view is disabled in this runtime',
    } satisfies BrowserLiveStatus);
    useAuthStore.setState({ accessToken: 'live-token', gatewayUrl: 'http://gateway.test' });

    render(<BuiltInBrowser workspacePath="E:\\01.Projects\\OpenAWork" />);

    await waitFor(() => expect(screen.getByText(/OPENAWORK_BROWSER_LIVE=1/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /安装调试浏览器/ })).toBeNull();
  });

  it('工具栏控件的 title 与快捷键提示条共用 BROWSER_PREVIEW_SHORTCUTS，不会漂移', () => {
    render(<BuiltInBrowser workspacePath="E:\\01.Projects\\OpenAWork" />);

    const controlTitles: ReadonlyArray<readonly [string, BrowserPreviewShortcutId]> = [
      ['刷新', 'reload'],
      ['打开控制台', 'toggleConsole'],
      ['放大', 'zoomIn'],
      ['缩小', 'zoomOut'],
      ['重置缩放为 100%', 'zoomReset'],
      ['设备预设：模拟目标设备的视口尺寸', 'cycleDevicePreset'],
    ];
    for (const [base, id] of controlTitles) {
      expect(
        screen.getByTitle(browserPreviewShortcutTitle(base, id)),
        `${id} 控件应展示组合键`,
      ).toBeTruthy();
    }

    const hints = screen.getByTestId('browser-shortcut-hints');
    for (const shortcut of BROWSER_PREVIEW_SHORTCUTS) {
      expect(hints.textContent).toContain(shortcut.label);
      expect(hints.textContent).toContain(shortcut.combination);
    }
  });

  it('根节点在 flex 宿主中可增长且允许收缩，避免内容区被 chrome 挤成 0', () => {
    const view = render(<BuiltInBrowser workspacePath="E:\\01.Projects\\OpenAWork" />);

    // jsdom 没有布局引擎，这里钉住的是「宿主高度不足时内容区不被 chrome 挤成 0」
    // 所依赖的契约：flex-grow 吃掉剩余高度、min-height/min-width 允许真正收缩。
    const root = view.container.firstElementChild as HTMLElement;
    expect(root.style.flexGrow).toBe('1');
    expect(root.style.flexShrink).toBe('1');
    expect(root.style.minHeight).toBe('0px');
    expect(root.style.minWidth).toBe('0px');
  });
});

interface FakeLiveConnectionEntry {
  callbacks: BrowserLiveCallbacks;
  connection: {
    send: ReturnType<typeof vi.fn>;
    readyState: number;
    close: ReturnType<typeof vi.fn>;
  };
}

/** 用假连接驱动实时通道（与 `use-browser-live-session.test.ts` 同一套形状）。 */
function installFakeLiveConnections(): FakeLiveConnectionEntry[] {
  const connections: FakeLiveConnectionEntry[] = [];
  liveMocks.connect.mockImplementation(
    (input: {
      token: string;
      callbacks: BrowserLiveCallbacks;
    }): FakeLiveConnectionEntry['connection'] => {
      const connection = { send: vi.fn(), readyState: 1, close: vi.fn() };
      connections.push({ callbacks: input.callbacks, connection });
      return connection;
    },
  );
  return connections;
}

/**
 * Tauri 原生窗口的采集链路。
 *
 * 原生 webview 无法注入脚本，画面与采集彻底分离：控制台 / 网络必须由网关侧
 * CDP 引擎采集，导航则由 `useBrowserLiveNavigation` 把当前标签页 URL 下发到
 * 远端采集页面。这里把这条链路端到端钉住，防止回归成「永远空控制台」。
 */
describe('BuiltInBrowser · Tauri 原生窗口采集', () => {
  const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;

  beforeEach(() => {
    // `isTauriEnv()` 读 `__TAURI_INTERNALS__`，必须在 render 之前存在。
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    // 让容器有非零矩形：`useTauriWebview` 会等待布局完成，jsdom 恒为 0 会走超时分支。
    Element.prototype.getBoundingClientRect = (): DOMRect =>
      ({
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        top: 0,
        left: 0,
        right: 800,
        bottom: 600,
        toJSON: () => ({}),
      }) as DOMRect;
  });

  afterEach(() => {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  });

  it('接入实时通道：导航下发给远端页面，控制台与网络照常入面板', async () => {
    liveMocks.getStatus.mockResolvedValue({
      available: true,
      engine: 'chromium',
      screencast: true,
    } satisfies BrowserLiveStatus);
    const connections = installFakeLiveConnections();
    useAuthStore.setState({ accessToken: 'live-token', gatewayUrl: 'http://gateway.test' });

    render(
      <BuiltInBrowser
        workspacePath="E:\\01.Projects\\OpenAWork"
        previewUrl="https://example.test/app"
      />,
    );
    // Tauri 模式必须走原生 webview 分支，不渲染 iframe。
    expect(screen.queryByTitle('内置浏览器')).toBeNull();

    fireEvent.click(screen.getByTitle(consoleTitleOpen));
    await waitFor(() => expect(connections.length).toBe(1));
    const entry = connections[0];
    if (!entry) throw new Error('未建立实时连接');

    act(() => {
      entry.callbacks.onOpen?.();
      entry.callbacks.onEnvelope({
        ch: 'hello',
        seq: 0,
        ts: 1,
        payload: { available: true, engine: 'chromium', screencast: true, viewport: null },
      });
    });

    // 导航在挂载期已进待发队列，hello 后补发——远端页面才不会停在空白页。
    await waitFor(() =>
      expect(entry.connection.send).toHaveBeenCalledWith({
        ch: 'control',
        action: 'navigate',
        url: 'https://example.test/app',
      }),
    );

    act(() => {
      entry.callbacks.onEnvelope({
        ch: 'console',
        seq: 1,
        ts: 2,
        payload: { level: 'error', text: 'tauri-boom', timestamp: 2 },
      });
      entry.callbacks.onEnvelope({
        ch: 'network',
        seq: 2,
        ts: 3,
        payload: {
          phase: 'response',
          requestId: 'req-1',
          method: 'GET',
          url: 'https://example.test/api/data',
          status: 200,
          statusText: 'OK',
          durationMs: 12,
        },
      });
    });

    await waitFor(() => expect(screen.getAllByTestId('console-entry').length).toBe(2));
    expect(screen.getByText(/tauri-boom/)).toBeTruthy();
    expect(screen.getByText(/example\.test\/api\/data/)).toBeTruthy();
  });
});
