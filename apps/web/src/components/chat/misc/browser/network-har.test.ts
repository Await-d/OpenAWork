// @vitest-environment jsdom
/**
 * HAR 1.2 导出的单测：条目形状、失败请求、脱敏头部透传、确定性与空输入。
 *
 * 「确定性」用伪时钟直接验证：两个不同的挂钟时刻构建同一份输入，输出必须逐字节
 * 相同——实现不允许在构建期读时钟，时间只来自调用方传入的 `startedAtMs`。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildNetworkHar, downloadNetworkHar } from './network-har.js';
import type { HarExchange } from './network-har.js';

const STARTED_AT = Date.UTC(2020, 5, 1, 12, 0, 0);
const STARTED_ISO = '2020-06-01T12:00:00.000Z';

function makeExchange(overrides: Partial<HarExchange> = {}): HarExchange {
  return {
    networkId: 'net-1',
    source: 'fetch',
    method: 'POST',
    url: 'http://localhost:3000/api/login?next=%2Fhome&flag',
    requestHeaders: { 'content-type': 'application/json', authorization: '***' },
    requestBody: '{"user":"ada"}',
    status: 200,
    statusText: 'OK',
    ok: true,
    durationMs: 18,
    responseHeaders: { 'content-type': 'application/json; charset=utf-8' },
    startedAtMs: STARTED_AT,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('buildNetworkHar', () => {
  it('产出 spec 形状的条目：request / response / timings / cache 与页面引用', () => {
    const har = buildNetworkHar([makeExchange()], {
      url: 'http://localhost:3000/',
      title: '登录页',
    });

    expect(har.log.version).toBe('1.2');
    expect(har.log.creator).toEqual({ name: 'OpenAWork', version: '1.0' });
    expect(har.log.pages).toEqual([
      {
        startedDateTime: STARTED_ISO,
        id: 'page_0',
        title: '登录页',
        pageTimings: { onContentLoad: -1, onLoad: -1 },
      },
    ]);

    const entry = har.log.entries[0];
    expect(entry).toBeDefined();
    if (entry === undefined) return;

    expect(entry.pageref).toBe('page_0');
    expect(entry.startedDateTime).toBe(STARTED_ISO);
    expect(entry.time).toBe(18);
    expect(entry.cache).toEqual({});

    expect(entry.request.method).toBe('POST');
    expect(entry.request.url).toBe('http://localhost:3000/api/login?next=%2Fhome&flag');
    expect(entry.request.httpVersion).toBe('');
    expect(entry.request.queryString).toEqual([
      { name: 'next', value: '/home' },
      { name: 'flag', value: '' },
    ]);
    expect(entry.request.headers).toEqual([
      { name: 'content-type', value: 'application/json' },
      { name: 'authorization', value: '***' },
    ]);
    expect(entry.request.headersSize).toBe(-1);
    expect(entry.request.bodySize).toBe(14);
    expect(entry.request.postData).toEqual({
      mimeType: 'application/json',
      text: '{"user":"ada"}',
    });

    expect(entry.response.status).toBe(200);
    expect(entry.response.statusText).toBe('OK');
    expect(entry.response.httpVersion).toBe('');
    expect(entry.response.headers).toEqual([
      { name: 'content-type', value: 'application/json; charset=utf-8' },
    ]);
    expect(entry.response.content).toEqual({
      size: -1,
      mimeType: 'application/json; charset=utf-8',
      _bodyNotCaptured: true,
    });
    expect(entry.response.redirectURL).toBe('');
    expect(entry.response.headersSize).toBe(-1);
    expect(entry.response.bodySize).toBe(-1);

    expect(entry.timings).toEqual({
      blocked: -1,
      dns: -1,
      connect: -1,
      send: -1,
      wait: 18,
      receive: -1,
    });

    // 没有采集服务器 IP：字段必须缺省，而不是填假值。
    expect('serverIPAddress' in entry).toBe(false);
    expect('_error' in entry.response).toBe(false);
  });

  it('3xx 响应把 Location 头部提升为 redirectURL', () => {
    const har = buildNetworkHar([
      makeExchange({
        status: 302,
        statusText: 'Found',
        responseHeaders: { location: 'https://example.com/next' },
      }),
    ]);

    expect(har.log.entries[0]?.response.redirectURL).toBe('https://example.com/next');
  });

  it('失败请求写 status 0 与 _error；未返回的请求不带 _error', () => {
    const failed = buildNetworkHar([
      makeExchange({
        status: undefined,
        statusText: undefined,
        durationMs: 3,
        errorMessage: 'net::ERR_CONNECTION_REFUSED',
      }),
    ]).log.entries[0];
    expect(failed?.response.status).toBe(0);
    expect(failed?.response.statusText).toBe('');
    expect(failed?.response._error).toBe('net::ERR_CONNECTION_REFUSED');
    expect(failed?.time).toBe(3);
    expect(failed?.timings.wait).toBe(3);

    const pending = buildNetworkHar([
      makeExchange({
        status: undefined,
        statusText: undefined,
        durationMs: undefined,
      }),
    ]).log.entries[0];
    expect(pending?.response.status).toBe(0);
    expect(pending?.response.statusText).toBe('');
    expect(pending === undefined ? true : '_error' in pending.response).toBe(false);
    expect(pending?.time).toBe(-1);
    expect(pending?.timings.wait).toBe(-1);
  });

  it('脱敏头部原样透传，缺省头部输出空数组', () => {
    const har = buildNetworkHar([
      makeExchange({
        requestHeaders: { authorization: '***', cookie: '***' },
        responseHeaders: undefined,
      }),
    ]);

    const entry = har.log.entries[0];
    expect(entry?.request.headers).toEqual([
      { name: 'authorization', value: '***' },
      { name: 'cookie', value: '***' },
    ]);
    expect(entry?.response.headers).toEqual([]);
    expect(entry?.response.content.mimeType).toBe('');
  });

  it('输出只包含记录中的时间戳：换一个挂钟时刻构建结果完全相同', () => {
    const exchanges = [
      makeExchange(),
      makeExchange({
        networkId: 'net-2',
        method: 'GET',
        url: 'http://localhost:3000/api/users',
        status: 500,
        statusText: 'Internal Server Error',
        durationMs: 42,
        startedAtMs: STARTED_AT + 250,
        responseHeaders: undefined,
        requestHeaders: undefined,
        requestBody: undefined,
      }),
    ];
    const context = { url: 'http://localhost:3000/', title: '首页' };

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T10:00:00.000Z'));
    const first = JSON.stringify(buildNetworkHar(exchanges, context));
    vi.setSystemTime(new Date('2031-01-02T03:04:05.000Z'));
    const second = JSON.stringify(buildNetworkHar(exchanges, context));

    expect(second).toBe(first);
    expect(first).toContain(STARTED_ISO);
    expect(first).toContain('2020-06-01T12:00:00.250Z');
    // 两个挂钟时刻都没有泄漏进输出。
    expect(first).not.toContain('2026-09-15T10:00:00.000Z');
    expect(first).not.toContain('2031-01-02T03:04:05.000Z');
  });

  it('空输入产出空 entries，page 时间戳回退到 epoch（仍然确定）', () => {
    const first = buildNetworkHar([]);
    const second = buildNetworkHar([]);

    expect(first.log.entries).toEqual([]);
    expect(first.log.pages[0]?.startedDateTime).toBe('1970-01-01T00:00:00.000Z');
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

describe('downloadNetworkHar', () => {
  it('通过 Blob + <a download> 触发本地下载，并回收 objectURL', async () => {
    const createdBlobs: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      createdBlobs.push(blob);
      return 'blob:mock';
    });
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    const clickedAnchors: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clickedAnchors.push(this);
    });

    const har = buildNetworkHar([makeExchange()]);
    downloadNetworkHar(har, 'openawork-network.har');

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock');
    expect(clickedAnchors.length).toBe(1);
    expect(clickedAnchors[0]?.download).toBe('openawork-network.har');

    const blob = createdBlobs[0];
    expect(blob).toBeDefined();
    expect(blob?.type).toContain('application/json');
    const text = await blob?.text();
    expect(text).toContain('"version": "1.2"');
    expect(text).toContain('"url": "http://localhost:3000/api/login?next=%2Fhome&flag"');
  });
});
