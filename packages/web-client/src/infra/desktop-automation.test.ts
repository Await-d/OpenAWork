import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDesktopAutomationClient } from './desktop-automation.js';

const originalFetch = globalThis.fetch;
type FetchHandler = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

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

describe('createDesktopAutomationClient', () => {
  it('getStatus 成功时返回 enabled', async () => {
    stubFetch(async () => jsonResponse({ enabled: true, started: false }));

    const client = createDesktopAutomationClient('http://localhost:3000');
    const result = await client.getStatus('token-1');

    expect(result.enabled).toBe(true);
    expect(result.started).toBe(false);
  });

  it('start 失败时会保留后端 error 文案', async () => {
    stubFetch(async () => jsonResponse({ error: 'desktop automation already running' }, 409));

    const client = createDesktopAutomationClient('http://localhost:3000');

    await expect(client.start('token-1')).rejects.toThrow('desktop automation already running');
  });

  it('click 网络异常时会转换成中文网络错误', async () => {
    stubFetch(async () => {
      throw new Error('Failed to fetch');
    });

    const client = createDesktopAutomationClient('http://localhost:3000');

    await expect(client.click('token-1', '#submit')).rejects.toThrow(
      '网络异常，执行桌面自动化点击失败。',
    );
  });

  it('start 会读取 ApiErrorResponse.data.message', async () => {
    stubFetch(async () =>
      jsonResponse(
        {
          name: 'BadRequest',
          data: { message: '请求体参数无效。', kind: 'Body' },
        },
        400,
      ),
    );

    const client = createDesktopAutomationClient('http://localhost:3000');

    await expect(client.start('token-1')).rejects.toThrow('请求体参数无效。');
  });

  it('press 会请求按键路由并发送 selector 与 key', async () => {
    const fetchMock = vi.fn<FetchHandler>(async () => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const client = createDesktopAutomationClient('http://localhost:3000');

    await expect(client.press('token-1', '#query', 'Enter')).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/desktop-automation/press',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ selector: '#query', key: 'Enter' }),
      }),
    );
  });

  it('snapshot 成功时返回页面快照', async () => {
    stubFetch(async () =>
      jsonResponse({
        snapshot: {
          currentPageId: 'page-1',
          openPages: ['page-1'],
          url: 'https://example.com/',
          title: 'Example',
        },
      }),
    );

    const client = createDesktopAutomationClient('http://localhost:3000');
    const result = await client.snapshot('token-1');

    expect(result.snapshot.url).toBe('https://example.com/');
    expect(result.snapshot.openPages).toEqual(['page-1']);
  });
});
