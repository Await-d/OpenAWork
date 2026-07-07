import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDesktopControlClient } from './desktop-control.js';

const originalFetch = globalThis.fetch;
type FetchHandler = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const SAMPLE_CAPABILITIES = {
  screenshot: { available: true, driver: 'grim' },
  click: { available: true, driver: 'xdotool' },
  typeText: { available: true, driver: 'xdotool' },
  key: { available: true, driver: 'xdotool' },
  hotkey: { available: true, driver: 'xdotool' },
  scroll: { available: true, driver: 'xdotool' },
  wait: { available: true, driver: 'std-thread-sleep' },
} as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stubFetch(handler: FetchHandler): void {
  vi.stubGlobal('fetch', vi.fn(handler));
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createDesktopControlClient', () => {
  it('getStatus 成功时返回 enabled', async () => {
    stubFetch(async () => jsonResponse({ enabled: true, capabilities: SAMPLE_CAPABILITIES }));

    const client = createDesktopControlClient('http://localhost:3000');
    const result = await client.getStatus('token-1');

    expect(result.enabled).toBe(true);
    expect(result.capabilities).toEqual(SAMPLE_CAPABILITIES);
  });

  it('click 会请求系统桌面点击路由并返回 result', async () => {
    const fetchMock = vi.fn<FetchHandler>(async () =>
      jsonResponse({ result: { success: true, x: 12, y: 34 } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = createDesktopControlClient('http://localhost:3000');
    const result = await client.click('token-1', { x: 12, y: 34 });

    expect(result).toEqual({ success: true, x: 12, y: 34 });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/desktop-control/click',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ x: 12, y: 34 }),
      }),
    );
  });

  it('screenshot 失败时会保留后端 error 文案', async () => {
    stubFetch(async () => jsonResponse({ error: '当前运行环境未启用系统桌面控制。' }, 503));

    const client = createDesktopControlClient('http://localhost:3000');

    await expect(client.screenshot('token-1')).rejects.toThrow('当前运行环境未启用系统桌面控制。');
  });

  it('key 网络异常时会转换成中文网络错误', async () => {
    stubFetch(async () => {
      throw new Error('Failed to fetch');
    });

    const client = createDesktopControlClient('http://localhost:3000');

    await expect(client.key('token-1', { key: 'Enter' })).rejects.toThrow(
      '网络异常，执行系统桌面按键失败。',
    );
  });
});
