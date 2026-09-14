// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BuiltInBrowser } from './BuiltInBrowser.js';

const STORAGE_KEY_PREFIX = 'openawork:builtin-browser:tabs:v1';
const LEGACY_DEFAULT_URL = 'http://localhost:3000';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
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
    fireEvent.click(screen.getByTitle('打开控制台'));

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
    fireEvent.click(screen.getByTitle('打开控制台'));

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
});
