// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserLiveStatus } from '@openAwork/web-client';
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
}));

vi.mock('@openAwork/web-client', () => ({
  createBrowserLiveClient: () => ({
    getStatus: liveMocks.getStatus,
    connect: liveMocks.connect,
    start: vi.fn(),
    stop: vi.fn(),
    screenshot: vi.fn(),
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
});
