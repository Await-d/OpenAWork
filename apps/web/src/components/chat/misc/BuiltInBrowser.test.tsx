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

describe('BuiltInBrowser · 标签持久化', () => {
  const WS = 'E:\\01.Projects\\OpenAWork';
  const KEY = `openawork:builtin-browser:tabs:v1:${WS}`;

  it('同步挂载时能恢复上次的标签与地址', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        version: 1,
        activeTabId: 'tab-keep',
        tabs: [
          {
            id: 'tab-keep',
            url: 'https://example.test/kept',
            title: 'Kept',
            history: ['https://example.test/kept'],
            historyIndex: 0,
          },
        ],
      }),
    );

    render(<BuiltInBrowser workspacePath={WS} />);

    expect(screen.getByDisplayValue('https://example.test/kept')).toBeTruthy();
  });

  /**
   * 冷启动的关键回归：`workspacePath` 先是 `null`（工作目录尚未解析），随后才有值。
   *
   * 旧实现在 `null` 阶段按 `__default__` 读（读不到），于是新建一个空白标签，并在
   * 真实路径到位后把这个占位标签**写进了真实 workspace 的 key**，把历史覆盖掉
   * ——用户看到的就是「重启后什么都没有了」。
   */
  it('workspace 晚就绪时不会覆盖已有历史', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        version: 1,
        activeTabId: 'tab-a',
        tabs: [
          {
            id: 'tab-a',
            url: 'https://example.test/important',
            title: 'Important',
            history: ['https://example.test/important'],
            historyIndex: 0,
          },
        ],
      }),
    );

    const view = render(<BuiltInBrowser workspacePath={null} />);
    // 就绪前不做任何落盘：真实 key 必须原封不动。
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}').tabs?.[0]?.url).toBe(
      'https://example.test/important',
    );

    view.rerender(<BuiltInBrowser workspacePath={WS} />);

    // 就绪后读回真实历史，而不是占位空白标签。
    expect(screen.getByDisplayValue('https://example.test/important')).toBeTruthy();
    // 关键断言：历史没有被占位标签覆盖（覆盖发生在写盘，不在渲染）。
    const persisted = JSON.parse(localStorage.getItem(KEY) ?? '{}') as {
      tabs?: Array<{ url: string }>;
    };
    expect(persisted.tabs?.map((tab) => tab.url)).toEqual(['https://example.test/important']);
  });

  /**
   * 早期版本把标签误写进 `__default__` 桶：就绪时迁移回来，避免历史彻底消失。
   */
  it('把误写进 __default__ 桶的历史迁移到真实 workspace', () => {
    localStorage.setItem(
      'openawork:builtin-browser:tabs:v1:__default__',
      JSON.stringify({
        version: 1,
        activeTabId: 'tab-lost',
        tabs: [
          {
            id: 'tab-lost',
            url: 'https://example.test/lost',
            title: 'Lost',
            history: ['https://example.test/lost'],
            historyIndex: 0,
          },
        ],
      }),
    );

    render(<BuiltInBrowser workspacePath={WS} />);

    expect(screen.getByDisplayValue('https://example.test/lost')).toBeTruthy();
    // 迁移后临时桶被清掉，真实桶拿到数据。
    expect(localStorage.getItem('openawork:builtin-browser:tabs:v1:__default__')).toBeNull();
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}').tabs?.[0]?.url).toBe(
      'https://example.test/lost',
    );
  });

  it('标签图标会被持久化', () => {
    render(<BuiltInBrowser workspacePath={WS} previewUrl="http://localhost:5173" />);

    const raw = localStorage.getItem(KEY);
    expect(raw).not.toBeNull();
    const persisted = JSON.parse(raw ?? '{}') as { tabs?: Array<{ faviconUrl?: string }> };
    expect(persisted.tabs?.[0]?.faviconUrl).toBe('http://localhost:5173/favicon.ico');
  });
});

describe('BuiltInBrowser', () => {
  it('新标签页展示开始页而不是白板，地址栏不再显示 about:blank', () => {
    render(<BuiltInBrowser workspacePath="E:\\01.Projects\\OpenAWork" />);

    // 开始页铺在占位 iframe 之上；iframe 本身仍停在占位页，避免请求网关根路径。
    expect(screen.getByTestId('browser-start-page')).toBeTruthy();
    expect(screen.getByTitle('内置浏览器').getAttribute('src')).toBe('about:blank');

    const addressInput = screen.getByPlaceholderText('输入网址或搜索…') as HTMLInputElement;
    expect(addressInput.value).toBe('');
  });

  /**
   * 回归：关掉最后一个标签必须重建内容区。
   *
   * 旧实现只重置 `tabs`、没有同步 `activeTabId`，iframe 的 key（含 `activeTabId`）
   * 不变 → 旧文档不会被卸载，页面里的音视频继续播——用户看到的就是
   * 「标签都关了，内容还在放」。
   */
  it('关闭最后一个标签会重建内容区，旧页面被卸载', () => {
    render(
      <BuiltInBrowser
        workspacePath="E:\\01.Projects\\OpenAWork"
        previewUrl="http://localhost:5173"
      />,
    );

    const before = screen.getByTitle('内置浏览器');
    expect(before.getAttribute('src')).toBe('http://localhost:5173');

    fireEvent.click(screen.getByLabelText('关闭标签'));

    const after = screen.getByTitle('内置浏览器');
    // key 变化 → 旧 iframe 节点销毁，页面里的播放随之停止。
    expect(after).not.toBe(before);
    expect(after.getAttribute('src')).toBe('about:blank');
  });

  it('页面内部导航写回地址栏（oaw-navigate）', () => {
    render(
      <BuiltInBrowser
        workspacePath="E:\\01.Projects\\OpenAWork"
        previewUrl="http://localhost:5173"
      />,
    );
    expect(screen.getByDisplayValue('http://localhost:5173')).toBeTruthy();

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'oaw-navigate',
            url: 'http://localhost:5173/about',
            title: 'About',
          },
        }),
      );
    });

    expect(screen.getByDisplayValue('http://localhost:5173/about')).toBeTruthy();
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
    expect(screen.getByTestId('browser-start-page')).toBeTruthy();

    const addressInput = screen.getByPlaceholderText('输入网址或搜索…') as HTMLInputElement;
    expect(addressInput.value).toBe('');
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

  /**
   * 回归：控制台关闭时的日志只在缓冲里累积，不参与渲染；打开面板后必须一次回填。
   *
   * 旧实现每批（80ms）都把日志写进 React 状态，页面加载时的 console/network 风暴
   * 会持续重渲染整个浏览器 UI，与实时画面绘制、点击反馈抢主线程。
   */
  it('控制台关闭期间的日志仍会累积，打开后一次回填且不影响徽章计数', async () => {
    render(<BuiltInBrowser workspacePath="E:\\01.Projects\\OpenAWork" />);

    expect(screen.queryAllByTestId('console-entry')).toHaveLength(0);

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'oaw-console', level: 'error', message: 'closed-period-error' },
        }),
      );
    });

    // 关闭状态下只有轻量计数参与渲染：工具栏徽章仍要立刻反映出来。
    await waitFor(() => {
      expect(screen.getByTitle('发送 1 条错误/失败请求到输入框')).toBeTruthy();
    });
    expect(screen.queryAllByTestId('console-entry')).toHaveLength(0);

    fireEvent.click(screen.getByTitle(consoleTitleOpen));

    await waitFor(() => expect(screen.getAllByTestId('console-entry').length).toBe(1));
    expect(screen.getByText(/closed-period-error/)).toBeTruthy();
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
 * 导航回报的标签归属。
 *
 * 真实缺陷：新建空白标签 → 切到前面已打开的标签（它已有地址）→ 再切回空白标签，
 * 空白标签的地址被替换成前一个标签的。原因是网关的 `nav` 回报是延迟的（要等主文档
 * 提交 + settle + 读 title），用户切标签之后才到达，而宿主无条件写回「当前激活标签」。
 */
describe('BuiltInBrowser · 导航回报归属', () => {
  function liveReadyStatus(): BrowserLiveStatus {
    return {
      available: true,
      engine: 'chromium',
      screencast: true,
      reason: 'ready',
      installable: false,
      source: 'managed',
      expectedRevision: '1208',
      executablePath: '/usr/bin/chromium',
    };
  }

  async function mountLiveBrowser(): Promise<FakeLiveConnectionEntry> {
    liveMocks.getStatus.mockResolvedValue(liveReadyStatus());
    useAuthStore.setState({ accessToken: 'live-token', gatewayUrl: 'http://gateway.test' });
    const connections = installFakeLiveConnections();

    render(<BuiltInBrowser workspacePath="E:\\01.Projects\\OpenAWork" />);

    await waitFor(() => expect(connections.length).toBe(1));
    const entry = connections[0];
    if (!entry) throw new Error('未建立实时连接');
    act(() => {
      entry.callbacks.onOpen?.();
      entry.callbacks.onEnvelope({
        ch: 'hello',
        seq: 0,
        ts: 1,
        payload: { available: true, engine: 'chromium', screencast: true },
      });
    });
    return entry;
  }

  /**
   * 打开第二个标签并导航到给定地址（模拟「前面已打开的标签」）。
   *
   * 地址栏用 placeholder 定位：预览里还有一个承载 IME 的隐藏 textarea，
   * 两者都是 `textbox` 角色，按角色查询会命中多个。
   */
  function openTabWithUrl(url: string): void {
    fireEvent.click(screen.getByTitle('新建标签页'));
    const input = screen.getByPlaceholderText('输入网址或搜索…');
    fireEvent.change(input, { target: { value: url } });
    fireEvent.keyDown(input, { key: 'Enter' });
  }

  it('切回空白标签后，上个标签迟到的 nav 不会覆盖它', async () => {
    const entry = await mountLiveBrowser();

    // 1) 新建标签 → 导航到 app 并让远端确认。
    openTabWithUrl('https://example.test/app');
    act(() => {
      entry.callbacks.onEnvelope({
        ch: 'nav',
        seq: 1,
        ts: 2,
        payload: { url: 'https://example.test/app', title: 'App', generation: 1 },
      });
    });
    expect(screen.getByDisplayValue('https://example.test/app')).toBeTruthy();

    // 2) 切回第一个（空白）标签：地址栏留空，开始页重新出现。
    const tabs = screen.getAllByRole('tab');
    act(() => {
      fireEvent.click(tabs[0] as HTMLElement);
    });
    expect(screen.getByTestId('browser-start-page')).toBeTruthy();

    // 3) 上个标签的 nav 迟到：地址是 app，但当前标签是空白页 —— 必须丢弃。
    act(() => {
      entry.callbacks.onEnvelope({
        ch: 'nav',
        seq: 2,
        ts: 3,
        payload: { url: 'https://example.test/app', title: 'App', generation: 1 },
      });
    });

    expect(screen.getByTestId('browser-start-page')).toBeTruthy();
  });

  it('空白标签自己的回报仍然会写回（不能过度过滤）', async () => {
    const entry = await mountLiveBrowser();

    act(() => {
      entry.callbacks.onEnvelope({
        ch: 'nav',
        seq: 1,
        ts: 2,
        payload: { url: 'about:blank', title: '空白页标题', generation: 1 },
      });
    });

    // 地址没变时写回只更新标题：标签栏出现新标题即证明这条回报被接受。
    expect(screen.getByText('空白页标题')).toBeTruthy();
  });
});

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
