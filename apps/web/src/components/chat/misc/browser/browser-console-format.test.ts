// @vitest-environment jsdom
/**
 * 控制台/网络格式化逻辑覆盖。
 *
 * 这里断言的是"复制出去的东西长什么样"——用户会把它贴进终端或 issue，
 * 格式错了比没有更糟（例如 cURL 里未转义的单引号会直接语法报错）。
 */

import { describe, expect, it } from 'vitest';
import type { ConsoleEntry, NetworkExchange } from './browser-console-types.js';
import {
  buildCurlCommand,
  formatEntryForComposer,
  formatEntryText,
  formatNetworkEntryMessage,
  formatNetworkRequestText,
  formatNetworkResponseText,
  isPendingNetworkPayload,
  mergeNetworkIntoEntry,
  parseNetworkPayload,
} from './browser-console-format.js';

function makeNetwork(overrides: Partial<NetworkExchange> = {}): NetworkExchange {
  return {
    networkId: 'net-1',
    source: 'fetch',
    method: 'GET',
    url: 'http://localhost:3000/api/users',
    ...overrides,
  };
}

describe('buildCurlCommand', () => {
  it('GET 请求不写 -X，只带 URL', () => {
    const command = buildCurlCommand(makeNetwork());
    expect(command).toContain("'http://localhost:3000/api/users'");
    expect(command).not.toContain('-X');
  });

  it('POST 请求带上方法、请求头与请求体', () => {
    const command = buildCurlCommand(
      makeNetwork({
        method: 'POST',
        requestHeaders: { 'content-type': 'application/json' },
        requestBody: '{"name":"ada"}',
      }),
    );
    expect(command).toContain('-X POST');
    expect(command).toContain("-H 'content-type: application/json'");
    expect(command).toContain('--data-raw');
    expect(command).toContain('{"name":"ada"}');
  });

  it('转义单引号，避免贴进终端后语法报错', () => {
    const command = buildCurlCommand(
      makeNetwork({ method: 'POST', requestBody: '{"name":"O\'Brien"}' }),
    );
    // shell 里单引号需写成 '\''，否则参数被提前截断
    expect(command).toContain("'\\''");
  });
});

describe('formatNetworkRequestText / formatNetworkResponseText', () => {
  it('请求块包含方法、URL、请求头与请求体', () => {
    const text = formatNetworkRequestText(
      makeNetwork({
        method: 'POST',
        requestHeaders: { authorization: '***' },
        requestBody: '{"a":1}',
      }),
    );
    expect(text).toContain('POST http://localhost:3000/api/users');
    expect(text).toContain('authorization: ***');
    expect(text).toContain('{"a":1}');
  });

  it('响应块包含状态、耗时与响应体', () => {
    const text = formatNetworkResponseText(
      makeNetwork({ status: 200, statusText: 'OK', durationMs: 42, responseBody: '{"ok":true}' }),
    );
    expect(text).toContain('状态 200 OK · 42ms');
    expect(text).toContain('{"ok":true}');
  });

  it('请求中与失败两种状态各有明确文案', () => {
    expect(formatNetworkResponseText(makeNetwork({ pending: true }))).toContain('尚未返回');
    expect(formatNetworkResponseText(makeNetwork({ errorMessage: 'Failed to fetch' }))).toContain(
      'Failed to fetch',
    );
  });

  it('被截断的 body 会显式标注', () => {
    const text = formatNetworkResponseText(
      makeNetwork({ status: 200, responseBody: 'x', responseBodyTruncated: true }),
    );
    expect(text).toContain('内容已截断');
  });
});

describe('formatNetworkEntryMessage', () => {
  it('请求阶段显示发出箭头', () => {
    expect(formatNetworkEntryMessage(makeNetwork({ pending: true }))).toBe(
      '⟶ GET http://localhost:3000/api/users',
    );
  });

  it('响应阶段显示状态码与耗时', () => {
    expect(formatNetworkEntryMessage(makeNetwork({ status: 404, durationMs: 12 }))).toBe(
      '⟵ 404 GET http://localhost:3000/api/users · 12ms',
    );
  });

  it('失败显示叉号与原因', () => {
    expect(
      formatNetworkEntryMessage(makeNetwork({ durationMs: 5, errorMessage: 'CORS blocked' })),
    ).toBe('✗ GET http://localhost:3000/api/users · 5ms · CORS blocked');
  });
});

describe('parseNetworkPayload', () => {
  it('缺少 networkId 或 url 时丢弃', () => {
    expect(parseNetworkPayload({})).toBeNull();
    expect(parseNetworkPayload({ networkId: 'a' })).toBeNull();
    expect(parseNetworkPayload({ url: 'http://x' })).toBeNull();
  });

  it('丢弃类型不合法的字段而不是照单全收', () => {
    const parsed = parseNetworkPayload({
      networkId: 'net-9',
      url: 'http://x',
      source: 'xhr',
      method: 'POST',
      status: '200',
      requestHeaders: ['not', 'a', 'record'],
      responseBody: 42,
    });
    expect(parsed?.source).toBe('xhr');
    expect(parsed?.method).toBe('POST');
    expect(parsed?.status).toBeUndefined();
    expect(parsed?.requestHeaders).toBeUndefined();
    expect(parsed?.responseBody).toBeUndefined();
  });
});

describe('isPendingNetworkPayload', () => {
  it('只有请求阶段算 pending', () => {
    expect(isPendingNetworkPayload({ networkId: 'a', url: 'http://x' })).toBe(true);
    expect(
      isPendingNetworkPayload({ networkId: 'a', url: 'http://x', requestBody: '{"a":1}' }),
    ).toBe(true);
  });

  it('带上状态、错误或响应体都视为已回来', () => {
    expect(isPendingNetworkPayload({ networkId: 'a', url: 'http://x', status: 200 })).toBe(false);
    expect(isPendingNetworkPayload({ networkId: 'a', url: 'http://x', errorMessage: 'boom' })).toBe(
      false,
    );
    // 响应体阶段不带 status —— 必须也算作"已回来"，否则会打回 pending
    expect(
      isPendingNetworkPayload({ networkId: 'a', url: 'http://x', responseBody: '{"ok":true}' }),
    ).toBe(false);
  });
});

describe('mergeNetworkIntoEntry', () => {
  const baseEntry: ConsoleEntry = {
    id: 'net-net-1',
    level: 'network',
    message: '⟶ GET http://localhost:3000/api/users',
    timestamp: 1_700_000_000_000,
    network: makeNetwork({
      method: 'POST',
      pending: true,
      requestHeaders: { 'content-type': 'application/json' },
      requestBody: '{"a":1}',
    }),
  };

  it('响应阶段不覆盖请求阶段已抓到的请求头与请求体', () => {
    const merged = mergeNetworkIntoEntry(
      baseEntry,
      makeNetwork({ method: 'POST', status: 201, durationMs: 30 }),
    );
    expect(merged.network?.requestBody).toBe('{"a":1}');
    expect(merged.network?.requestHeaders).toEqual({ 'content-type': 'application/json' });
    expect(merged.network?.status).toBe(201);
  });

  it('拿到状态后清掉 pending 并重算展示文案', () => {
    const merged = mergeNetworkIntoEntry(
      baseEntry,
      makeNetwork({ method: 'POST', status: 201, durationMs: 30 }),
    );
    expect(merged.network?.pending).toBeUndefined();
    expect(merged.message).toBe('⟵ 201 POST http://localhost:3000/api/users · 30ms');
  });

  it('响应体后到时会补进同一条记录', () => {
    const withStatus = mergeNetworkIntoEntry(
      baseEntry,
      makeNetwork({ method: 'POST', status: 200, durationMs: 10 }),
    );
    const withBody = mergeNetworkIntoEntry(
      withStatus,
      makeNetwork({ method: 'POST', responseBody: '{"ok":true}' }),
    );
    expect(withBody.network?.responseBody).toBe('{"ok":true}');
    expect(withBody.network?.status).toBe(200);
  });
});

describe('formatEntryText / formatEntryForComposer', () => {
  it('普通日志带 ISO 时间戳与级别', () => {
    const text = formatEntryText({
      id: 'e1',
      level: 'error',
      message: 'boom',
      timestamp: Date.UTC(2026, 0, 2, 3, 4, 5),
    });
    expect(text).toBe('[2026-01-02T03:04:05.000Z] [error] boom');
  });

  it('网络记录带请求与响应全文', () => {
    const text = formatEntryText({
      id: 'net-net-1',
      level: 'network',
      message: '⟵ 200 GET http://localhost:3000/api/users · 7ms',
      timestamp: 0,
      network: makeNetwork({ status: 200, durationMs: 7, responseBody: '{"ok":true}' }),
    });
    expect(text).toContain('# 请求');
    expect(text).toContain('# 响应');
    expect(text).toContain('{"ok":true}');
  });

  it('引用进输入框的版本面向 LLM，保留接口与关键数据', () => {
    const text = formatEntryForComposer({
      id: 'net-net-1',
      level: 'network',
      message: 'x',
      timestamp: 0,
      network: makeNetwork({
        method: 'POST',
        status: 500,
        requestBody: '{"a":1}',
        responseBody: '{"error":"boom"}',
      }),
    });
    expect(text).toContain('网络请求 POST http://localhost:3000/api/users');
    expect(text).toContain('状态：500');
    expect(text).toContain('请求体：{"a":1}');
    expect(text).toContain('响应体：{"error":"boom"}');
  });
});
