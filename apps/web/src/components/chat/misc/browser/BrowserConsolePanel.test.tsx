// @vitest-environment jsdom
/**
 * 控制台面板的复制 / 引用能力覆盖。
 *
 * 重点验证三件事：错误日志能一键复制/引用；网络请求能分别复制请求与响应
 * （含 cURL）；点详情能展开看到请求/响应全文。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ConsoleEntry } from './browser-console-types.js';
import { COMPOSER_INSERT_EVENT } from './browser-clipboard.js';
import { BrowserConsolePanel } from './BrowserConsolePanel.js';

function makeErrorEntry(message = 'Uncaught TypeError: x is not a function'): ConsoleEntry {
  return {
    id: 'err-1',
    level: 'error',
    message,
    timestamp: Date.UTC(2026, 0, 2, 3, 4, 5),
  };
}

function makeNetworkEntry(status = 200): ConsoleEntry {
  return {
    id: 'net-net-7',
    level: 'network',
    message: `⟵ ${status} POST http://localhost:3000/api/login · 18ms`,
    timestamp: Date.UTC(2026, 0, 2, 3, 4, 6),
    network: {
      networkId: 'net-7',
      source: 'fetch',
      method: 'POST',
      url: 'http://localhost:3000/api/login',
      requestHeaders: { 'content-type': 'application/json', authorization: '***' },
      requestBody: '{"user":"ada"}',
      status,
      statusText: status === 200 ? 'OK' : 'Internal Server Error',
      ok: status < 400,
      durationMs: 18,
      responseHeaders: { 'content-type': 'application/json' },
      responseBody: '{"token":"abc"}',
    },
  };
}

function renderPanel(logs: ConsoleEntry[]) {
  return render(
    <BrowserConsolePanel
      logs={logs}
      endRef={{ current: null }}
      onClear={() => {}}
      onClose={() => {}}
    />,
  );
}

function stubClipboard(): ReturnType<typeof vi.fn> {
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
}

afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  vi.restoreAllMocks();
});

describe('BrowserConsolePanel 复制与引用', () => {
  it('错误日志提供复制与引用入口', () => {
    renderPanel([makeErrorEntry()]);

    expect(screen.getByRole('button', { name: '复制' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '引用到输入框' })).toBeTruthy();
  });

  it('复制错误日志写入剪贴板并给出回执', async () => {
    const writeText = stubClipboard();
    renderPanel([makeErrorEntry('boom')]);

    fireEvent.click(screen.getByRole('button', { name: '复制' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = String(writeText.mock.calls[0]?.[0]);
    expect(copied).toContain('[error] boom');
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('已复制'));
  });

  it('引用错误日志会派发输入框插入事件', async () => {
    const details: unknown[] = [];
    const handler = (event: Event): void => {
      details.push((event as CustomEvent).detail);
    };
    window.addEventListener(COMPOSER_INSERT_EVENT, handler);
    try {
      renderPanel([makeErrorEntry('bad thing')]);
      fireEvent.click(screen.getByRole('button', { name: '引用到输入框' }));
    } finally {
      window.removeEventListener(COMPOSER_INSERT_EVENT, handler);
    }

    expect(details.length).toBe(1);
    expect((details[0] as { text: string }).text).toContain('控制台 error：bad thing');
  });

  it('网络条目提供请求 / 响应 / cURL 三个复制入口', () => {
    renderPanel([makeNetworkEntry()]);

    expect(screen.getByRole('button', { name: '复制请求' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '复制响应' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '复制为 cURL' })).toBeTruthy();
  });

  it('复制请求内容包含方法与请求体', async () => {
    const writeText = stubClipboard();
    renderPanel([makeNetworkEntry()]);

    fireEvent.click(screen.getByRole('button', { name: '复制请求' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = String(writeText.mock.calls[0]?.[0]);
    expect(copied).toContain('POST http://localhost:3000/api/login');
    expect(copied).toContain('{"user":"ada"}');
  });

  it('复制响应内容包含状态码与响应体', async () => {
    const writeText = stubClipboard();
    renderPanel([makeNetworkEntry(500)]);

    fireEvent.click(screen.getByRole('button', { name: '复制响应' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = String(writeText.mock.calls[0]?.[0]);
    expect(copied).toContain('状态 500');
    expect(copied).toContain('{"token":"abc"}');
  });

  it('复制为 cURL 生成可直接复现的命令', async () => {
    const writeText = stubClipboard();
    renderPanel([makeNetworkEntry()]);

    fireEvent.click(screen.getByRole('button', { name: '复制为 cURL' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = String(writeText.mock.calls[0]?.[0]);
    expect(copied).toContain('curl');
    expect(copied).toContain('-X POST');
    expect(copied).toContain('--data-raw');
  });

  it('查看详情展开请求/响应全文，并可分块复制', () => {
    renderPanel([makeNetworkEntry()]);

    // 折叠时只有列表行，没有请求/响应分区。
    expect(screen.queryByText('请求')).toBeNull();
    expect(screen.queryByText('响应')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '查看详情' }));

    expect(screen.getByText('请求')).toBeTruthy();
    expect(screen.getByText('响应')).toBeTruthy();
    expect(screen.getByRole('button', { name: '复制请求全文' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '复制响应全文' })).toBeTruthy();

    // 折叠回去后详情消失，避免面板被长文本撑满。
    fireEvent.click(screen.getByRole('button', { name: '收起详情' }));
    expect(screen.queryByText('请求')).toBeNull();
  });

  it('搜索能命中接口 URL 与响应体', () => {
    renderPanel([makeNetworkEntry(), makeErrorEntry('unrelated failure')]);

    fireEvent.change(screen.getByLabelText('搜索控制台日志'), {
      target: { value: 'login' },
    });

    expect(screen.getByText(/POST http:\/\/localhost:3000\/api\/login/)).toBeTruthy();
    expect(screen.queryByText(/unrelated failure/)).toBeNull();
  });
});
