import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchWithTimeout,
  DEFAULT_FETCH_TIMEOUT_MS,
  describeNonJsonResponse,
  isGenericFetchErrorMessage,
} from './http.js';

/** 构造一个只实现测试所需字段的 Response 替身。 */
function jsonResponseStub(input: {
  status?: number;
  contentType?: string;
  json: () => Promise<unknown>;
}): Response {
  return {
    ok: (input.status ?? 200) < 400,
    status: input.status ?? 200,
    headers: {
      get: (name: string) => (name === 'content-type' ? (input.contentType ?? null) : null),
    },
    json: input.json,
  } as unknown as Response;
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('fetchWithTimeout', () => {
  it('正常响应直接透传', async () => {
    globalThis.fetch = vi.fn(
      async () => ({ ok: true, status: 200 }) as unknown as Response,
    ) as typeof fetch;
    const res = await fetchWithTimeout('http://localhost/x', { timeoutMs: 1000 });
    expect(res.ok).toBe(true);
  });

  it('挂起的请求在 timeoutMs 后 abort 并 reject（不会永久 pending）', async () => {
    // 模拟一个永不响应、但遵守 abort signal 的 fetch（半开连接）。
    globalThis.fetch = vi.fn((_input: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal) {
          signal.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }
      });
    }) as unknown as typeof fetch;

    await expect(fetchWithTimeout('http://localhost/hang', { timeoutMs: 30 })).rejects.toThrow(
      /abort/i,
    );
  });

  it('调用方 signal 先于超时触发时也会 abort', async () => {
    globalThis.fetch = vi.fn((_input: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }) as unknown as typeof fetch;

    const controller = new AbortController();
    const promise = fetchWithTimeout('http://localhost/hang', {
      timeoutMs: 10_000,
      signal: controller.signal,
    });
    controller.abort();
    await expect(promise).rejects.toThrow(/abort/i);
  });

  it('已 abort 的调用方 signal 立即生效', async () => {
    globalThis.fetch = vi.fn((_input: string, init?: RequestInit) => {
      return new Promise<Response>((resolve, reject) => {
        if (init?.signal?.aborted) {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
          return;
        }
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
        resolve({ ok: true, status: 200 } as unknown as Response);
      });
    }) as unknown as typeof fetch;

    const controller = new AbortController();
    controller.abort();
    await expect(
      fetchWithTimeout('http://localhost/x', { timeoutMs: 1000, signal: controller.signal }),
    ).rejects.toThrow(/abort/i);
  });

  it('timeoutMs<=0 时禁用墙钟（不 arm 定时器，直接透传 fetch）', async () => {
    const fetchMock = vi.fn(
      async (_input: string, _init?: RequestInit) =>
        ({ ok: true, status: 200 }) as unknown as Response,
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const res = await fetchWithTimeout('http://localhost/x', { timeoutMs: 0 });
    expect(res.ok).toBe(true);
    // 未注入 controller.signal（透传原始 init，无 signal）。
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.signal).toBeUndefined();
  });

  it('默认超时常量为 20s', () => {
    expect(DEFAULT_FETCH_TIMEOUT_MS).toBe(20_000);
  });
});

describe('isGenericFetchErrorMessage', () => {
  it('识别浏览器原生的网络失败文案', () => {
    expect(isGenericFetchErrorMessage('Failed to fetch')).toBe(true);
    expect(isGenericFetchErrorMessage('Load failed')).toBe(true);
    expect(isGenericFetchErrorMessage('NetworkError when attempting to fetch resource.')).toBe(
      true,
    );
  });

  it('识别 fetchWithTimeout 墙钟超时产生的 abort 文案（否则原始 "aborted" 会泄漏到 UI）', () => {
    // The various runtimes phrase AbortError differently; all must collapse so
    // the team/* normalizers map a wall-clock timeout to a friendly localized
    // network message instead of surfacing the raw abort string.
    expect(isGenericFetchErrorMessage('The operation was aborted')).toBe(true);
    expect(isGenericFetchErrorMessage('The operation was aborted.')).toBe(true);
    expect(isGenericFetchErrorMessage('This operation was aborted')).toBe(true);
    expect(isGenericFetchErrorMessage('aborted')).toBe(true);
    expect(isGenericFetchErrorMessage('The user aborted a request.')).toBe(true);
  });

  it('不误判真实的业务错误文案', () => {
    expect(isGenericFetchErrorMessage('inbound window expired')).toBe(false);
    expect(isGenericFetchErrorMessage('请求体参数无效。')).toBe(false);
    expect(isGenericFetchErrorMessage('')).toBe(false);
  });
});

describe('fetchWithTimeout 的非 JSON 响应诊断', () => {
  it('响应是 SPA 兜底的 index.html 时,response.json() 抛出可执行的地址排查提示', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponseStub({
        contentType: 'text/html; charset=utf-8',
        json: async () => {
          throw new SyntaxError(`Unexpected token '<', "<!doctype "... is not valid JSON`);
        },
      }),
    ) as unknown as typeof fetch;

    const response = await fetchWithTimeout('http://localhost:3000/usage/records', {
      timeoutMs: 1000,
    });

    await expect(response.json()).rejects.toThrow(/不是接口数据/);
  });

  it('JSON 正常时解析行为与原生一致', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponseStub({
        contentType: 'application/json',
        json: async () => ({ records: [] as unknown[] }),
      }),
    ) as unknown as typeof fetch;

    const response = await fetchWithTimeout('http://localhost:3000/usage/records', {
      timeoutMs: 1000,
    });

    await expect(response.json()).resolves.toEqual({ records: [] });
  });

  it('Response 不可扩展(只读替身)时保持原样透传,不让诊断本身破坏请求', async () => {
    const frozen = Object.freeze(
      jsonResponseStub({ contentType: 'text/html', json: async () => ({ ok: true }) }),
    );
    globalThis.fetch = vi.fn(async () => frozen) as unknown as typeof fetch;

    const response = await fetchWithTimeout('http://localhost:3000/x', { timeoutMs: 1000 });

    expect(response).toBe(frozen);
  });
});

describe('describeNonJsonResponse', () => {
  it('HTML 响应给出网关地址排查指引', () => {
    expect(
      describeNonJsonResponse(
        jsonResponseStub({ contentType: 'text/html', json: async () => null }),
      ),
    ).toContain('Gateway');
  });

  it('非 HTML 的非 JSON 响应给出通用文案并带上状态码', () => {
    expect(
      describeNonJsonResponse(
        jsonResponseStub({ status: 502, contentType: 'text/plain', json: async () => null }),
      ),
    ).toBe('网关返回的内容不是可解析的 JSON(HTTP 502)。');
  });
});
