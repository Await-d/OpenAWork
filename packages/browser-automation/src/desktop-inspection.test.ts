import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BROWSER_AUTOMATION_CONSOLE_BUFFER_LIMIT,
  BROWSER_AUTOMATION_NETWORK_BODY_LIMIT,
  BROWSER_AUTOMATION_NETWORK_BUFFER_LIMIT,
  DesktopBrowserAutomation,
} from './index.js';

type EventHandler = (...args: unknown[]) => void;

interface FakeFrame {
  name(): string;
  url(): string;
  parentFrame(): FakeFrame | null;
}

interface FakePage {
  on(event: string, handler: EventHandler): void;
  off(event: string, handler: EventHandler): void;
  frames(): FakeFrame[];
}

interface FakePageHandle {
  page: FakePage;
  emit(event: string, ...args: unknown[]): void;
}

function createFakePage(frames: FakeFrame[] = []): FakePageHandle {
  const handlers = new Map<string, EventHandler[]>();
  const page: FakePage = {
    on(event, handler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    off(event, handler) {
      const list = handlers.get(event) ?? [];
      handlers.set(
        event,
        list.filter((item) => item !== handler),
      );
    },
    frames: () => frames,
  };

  return {
    page,
    emit(event, ...args) {
      for (const handler of handlers.get(event) ?? []) {
        handler(...args);
      }
    },
  };
}

function createFrame(name: string, url: string, parent: FakeFrame | null): FakeFrame {
  return { name: () => name, url: () => url, parentFrame: () => parent };
}

/**
 * 通过反射注入伪造页，避免在单测中真实启动 Playwright 浏览器。
 * `console` 与 `pageerror` 监听器由 `registerPage` 在注入时挂载。
 */
function attachFakePage(automation: DesktopBrowserAutomation, page: FakePage): void {
  const internal = automation as unknown as { registerPage(target: unknown): string };
  internal.registerPage(page);
  Object.assign(automation, { currentPageId: 'page-1' });
}

function consoleEvent(type: string, text: string): { type(): string; text(): string } {
  return { type: () => type, text: () => text };
}

interface FakeRequest {
  method(): string;
  url(): string;
  resourceType(): string;
  headers(): Record<string, string>;
  postData(): string | null;
  failure(): { errorText: string } | null;
}

interface FakeResponse {
  request(): FakeRequest;
  status(): number;
  ok(): boolean;
  headers(): Record<string, string>;
}

interface FakeRequestOptions {
  method?: string;
  resourceType?: string;
  headers?: Record<string, string>;
  body?: string | null;
  failure?: { errorText: string } | null;
}

function createFakeRequest(url: string, options: FakeRequestOptions = {}): FakeRequest {
  return {
    method: () => options.method ?? 'GET',
    url: () => url,
    resourceType: () => options.resourceType ?? 'document',
    headers: () => options.headers ?? {},
    postData: () => options.body ?? null,
    failure: () => options.failure ?? null,
  };
}

function createFakeResponse(
  request: FakeRequest,
  status: number,
  headers: Record<string, string> = {},
): FakeResponse {
  return {
    request: () => request,
    status: () => status,
    ok: () => status >= 200 && status < 300,
    headers: () => headers,
  };
}

describe('DesktopBrowserAutomation.consoleMessages', () => {
  let automation: DesktopBrowserAutomation;
  let handle: FakePageHandle;

  beforeEach(() => {
    automation = new DesktopBrowserAutomation();
    handle = createFakePage();
    attachFakePage(automation, handle.page);
  });

  it('捕获控制台消息与页面错误并归一化级别', () => {
    handle.emit('console', consoleEvent('log', 'hello'));
    handle.emit('console', consoleEvent('warning', 'careful'));
    handle.emit('console', consoleEvent('error', 'boom'));
    handle.emit('pageerror', new Error('uncaught'));

    const snapshot = automation.consoleMessages();

    expect(snapshot.messages.map((message) => message.level)).toEqual(['log', 'warn', 'error']);
    expect(snapshot.messages.map((message) => message.text)).toEqual(['hello', 'careful', 'boom']);
    expect(snapshot.errors).toEqual([{ message: 'uncaught', timestamp: expect.any(Number) }]);
    expect(snapshot.truncated).toBe(false);
  });

  it('按 limit 返回最近消息并标记 truncated，clear 清空缓冲', () => {
    for (let index = 0; index < 5; index += 1) {
      handle.emit('console', consoleEvent('log', `m${index}`));
    }

    const limited = automation.consoleMessages({ limit: 2 });

    expect(limited.messages.map((message) => message.text)).toEqual(['m3', 'm4']);
    expect(limited.truncated).toBe(true);

    const cleared = automation.consoleMessages({ clear: true });

    expect(cleared.messages).toHaveLength(5);
    expect(automation.consoleMessages().messages).toHaveLength(0);
    expect(automation.consoleMessages().errors).toHaveLength(0);
  });

  it('level 过滤仅返回指定级别，且不改动缓冲', () => {
    handle.emit('console', consoleEvent('log', 'plain'));
    handle.emit('console', consoleEvent('error', 'boom'));
    handle.emit('console', consoleEvent('error', 'again'));

    const errors = automation.consoleMessages({ level: 'error' });

    expect(errors.messages.map((message) => message.text)).toEqual(['boom', 'again']);
    expect(automation.consoleMessages().messages).toHaveLength(3);
  });

  it('缓冲超过上限时丢弃最旧消息（truncated 仅表示查询 limit 截断）', () => {
    const overflow = BROWSER_AUTOMATION_CONSOLE_BUFFER_LIMIT + 50;
    for (let index = 0; index < overflow; index += 1) {
      handle.emit('console', consoleEvent('log', `m${index}`));
    }

    const snapshot = automation.consoleMessages({
      limit: BROWSER_AUTOMATION_CONSOLE_BUFFER_LIMIT,
    });

    expect(snapshot.messages).toHaveLength(BROWSER_AUTOMATION_CONSOLE_BUFFER_LIMIT);
    expect(snapshot.messages[0]?.text).toBe('m50');
    expect(snapshot.truncated).toBe(false);
  });

  it('limit 越界时收敛到 [1, 上限]', () => {
    handle.emit('console', consoleEvent('log', 'only'));

    expect(automation.consoleMessages({ limit: 0 }).messages).toHaveLength(1);
    expect(automation.consoleMessages({ limit: 1_000_000 }).messages).toHaveLength(1);
  });
});

describe('DesktopBrowserAutomation.frames', () => {
  let automation: DesktopBrowserAutomation;

  beforeEach(() => {
    automation = new DesktopBrowserAutomation();
  });

  it('返回主 frame 与子 frame 的层级关系', () => {
    const main = createFrame('', 'https://example.test/', null);
    const child = createFrame('child', 'https://child.test/', main);
    const handle = createFakePage([main, child]);
    attachFakePage(automation, handle.page);

    expect(automation.frames()).toEqual([
      { index: 0, name: '', url: 'https://example.test/', isMain: true, parentIndex: null },
      { index: 1, name: 'child', url: 'https://child.test/', isMain: false, parentIndex: 0 },
    ]);
  });

  it('未启动时读取 frames 抛出明确错误', () => {
    expect(() => automation.frames()).toThrow(/No active page/);
  });
});

describe('DesktopBrowserAutomation.networkRequests', () => {
  let automation: DesktopBrowserAutomation;
  let handle: FakePageHandle;

  beforeEach(() => {
    automation = new DesktopBrowserAutomation();
    handle = createFakePage();
    attachFakePage(automation, handle.page);
  });

  it('合并 request/response/requestfinished 为单条记录并补齐响应字段', () => {
    const request = createFakeRequest('https://api.example.test/login', {
      method: 'POST',
      resourceType: 'fetch',
      headers: { 'content-type': 'application/json' },
      body: '{"user":"demo"}',
    });

    handle.emit('request', request);
    handle.emit(
      'response',
      createFakeResponse(request, 200, { 'content-type': 'application/json' }),
    );
    handle.emit('requestfinished', request);

    const snapshot = automation.networkRequests();

    expect(snapshot.truncated).toBe(false);
    expect(snapshot.requests).toHaveLength(1);
    expect(snapshot.requests[0]).toMatchObject({
      id: 'req-1',
      method: 'POST',
      url: 'https://api.example.test/login',
      resourceType: 'fetch',
      status: 200,
      ok: true,
      failureText: null,
      requestHeaders: { 'content-type': 'application/json' },
      responseHeaders: { 'content-type': 'application/json' },
      requestBody: null,
      requestBodyTruncated: false,
    });
    expect(snapshot.requests[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('捕获时剔除认证头与请求体，列表和单条读取均不暴露凭据', () => {
    const request = createFakeRequest('https://user:secret@example.test/login?token=secret', {
      method: 'POST',
      headers: { Authorization: 'Bearer secret', Cookie: 'session=secret', Accept: 'text/html' },
      body: '{"password":"secret"}',
    });
    handle.emit('request', request);
    handle.emit(
      'response',
      createFakeResponse(request, 200, {
        'Set-Cookie': 'session=secret',
        'Content-Type': 'application/json',
      }),
    );

    for (const record of [
      automation.networkRequests().requests[0],
      automation.networkRequest('req-1'),
    ]) {
      expect(JSON.stringify(record)).not.toContain('secret');
      expect(record?.url).toBe('https://example.test/login');
      expect(record?.requestHeaders).toEqual({ Accept: 'text/html' });
      expect(record?.responseHeaders).toEqual({ 'Content-Type': 'application/json' });
      expect(record?.requestBody).toBeNull();
    }
  });

  it('返回快照副本：后续事件不会改写已返回的记录', () => {
    const request = createFakeRequest('https://api.example.test/slow');
    handle.emit('request', request);

    const snapshot = automation.networkRequests();
    expect(snapshot.requests).toHaveLength(1);
    expect(snapshot.requests[0]?.status).toBeNull();

    // 后续 response 事件会补齐内部记录；已返回的快照必须保持不变。
    handle.emit('response', createFakeResponse(request, 200));
    expect(snapshot.requests[0]?.status).toBeNull();
    expect(automation.networkRequests().requests[0]?.status).toBe(200);
  });

  it('记录请求失败的错误文本且保留未完成状态', () => {
    const request = createFakeRequest('https://api.example.test/boom', {
      failure: { errorText: 'net::ERR_FAILED' },
    });

    handle.emit('request', request);
    handle.emit('requestfailed', request);

    const [record] = automation.networkRequests().requests;

    expect(record?.failureText).toBe('net::ERR_FAILED');
    expect(record?.status).toBeNull();
    expect(record?.ok).toBeNull();
  });

  it('按 urlContains 字面量与 method 过滤（方法大小写不敏感）', () => {
    handle.emit('request', createFakeRequest('https://api.example.test/users', { method: 'GET' }));
    handle.emit('request', createFakeRequest('https://api.example.test/login', { method: 'POST' }));
    handle.emit(
      'request',
      createFakeRequest('https://cdn.example.test/app.js', {
        method: 'GET',
        resourceType: 'script',
      }),
    );

    expect(
      automation.networkRequests({ urlContains: 'api.example.test' }).requests.map((r) => r.id),
    ).toEqual(['req-1', 'req-2']);
    expect(automation.networkRequests({ method: 'post' }).requests.map((r) => r.url)).toEqual([
      'https://api.example.test/login',
    ]);
    expect(automation.networkRequests({ urlContains: 'missing' }).requests).toHaveLength(0);
  });

  it('按 limit 返回最近请求并标记 truncated', () => {
    for (let index = 0; index < 5; index += 1) {
      handle.emit('request', createFakeRequest(`https://example.test/${index}`));
    }

    const limited = automation.networkRequests({ limit: 2 });

    expect(limited.requests.map((request) => request.url)).toEqual([
      'https://example.test/3',
      'https://example.test/4',
    ]);
    expect(limited.truncated).toBe(true);
  });

  it('缓冲超过上限时丢弃最旧请求，且 limit 收敛到 [1, 上限]', () => {
    const overflow = BROWSER_AUTOMATION_NETWORK_BUFFER_LIMIT + 50;
    for (let index = 0; index < overflow; index += 1) {
      handle.emit('request', createFakeRequest(`https://example.test/${index}`));
    }

    const snapshot = automation.networkRequests({
      limit: BROWSER_AUTOMATION_NETWORK_BUFFER_LIMIT,
    });

    expect(snapshot.requests).toHaveLength(BROWSER_AUTOMATION_NETWORK_BUFFER_LIMIT);
    expect(snapshot.requests[0]?.id).toBe('req-51');
    expect(snapshot.truncated).toBe(false);
    expect(automation.networkRequests({ limit: 0 }).requests).toHaveLength(1);
  });

  it('networkRequest 命中稳定序号，未命中或被淘汰时返回 null', () => {
    handle.emit('request', createFakeRequest('https://example.test/one'));

    expect(automation.networkRequest('req-1')?.url).toBe('https://example.test/one');
    expect(automation.networkRequest('req-404')).toBeNull();
  });

  it('请求体超出上限时也不保留内容', () => {
    const body = 'x'.repeat(BROWSER_AUTOMATION_NETWORK_BODY_LIMIT + 10);

    handle.emit(
      'request',
      createFakeRequest('https://example.test/upload', { method: 'POST', body }),
    );

    const record = automation.networkRequest('req-1');

    expect(record?.requestBody).toBeNull();
    expect(record?.requestBodyTruncated).toBe(false);
  });

  it('捕获监听异常时不影响页面操作', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const broken = {
      method: () => 'GET',
      url: () => 'https://example.test/broken',
      resourceType: () => 'document',
      headers: () => {
        throw new Error('boom');
      },
      postData: () => null,
      failure: () => null,
    };

    expect(() => handle.emit('request', broken)).not.toThrow();
    expect(automation.networkRequests().requests).toHaveLength(0);
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
  });
});
