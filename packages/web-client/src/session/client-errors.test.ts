import { afterEach, describe, expect, it, vi } from 'vitest';

import { createClientErrorReporter } from './client-errors.js';

const GATEWAY_URL = 'http://localhost:3000';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createClientErrorReporter', () => {
  it('把错误以 POST + Bearer 上报，并回传 outcome', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse({ ok: true, outcome: 'persisted', messageId: 'msg-1' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const reporter = createClientErrorReporter(GATEWAY_URL);
    const result = await reporter.reportClientStreamError('token-1', {
      clientRequestId: 'req-1',
      code: 'WS_CLOSED',
      message: 'WebSocket 连接已关闭。',
      technicalDetail: '连接在流式传输过程中中断。',
      sessionId: 'session-1',
    });

    expect(result).toEqual({ ok: true, outcome: 'persisted', messageId: 'msg-1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`${GATEWAY_URL}/sessions/session-1/client-errors`);
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string> | undefined)?.['Authorization']).toBe(
      'Bearer token-1',
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      clientRequestId: 'req-1',
      code: 'WS_CLOSED',
      message: 'WebSocket 连接已关闭。',
      technicalDetail: '连接在流式传输过程中中断。',
    });
  });

  it('缺少 technicalDetail 时不发送该字段', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse({ ok: true, outcome: 'persisted' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const reporter = createClientErrorReporter(GATEWAY_URL);
    await reporter.reportClientStreamError('token-1', {
      clientRequestId: 'req-1',
      code: 'SSE_ERROR',
      sessionId: 'session-1',
    });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({
      clientRequestId: 'req-1',
      code: 'SSE_ERROR',
      message: 'SSE_ERROR',
    });
  });

  it('网关判定为重复 / 跳过时视为已受理', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ ok: true, outcome: 'deduplicated', messageId: 'msg-2' })),
    );

    const reporter = createClientErrorReporter(GATEWAY_URL);
    const result = await reporter.reportClientStreamError('token-1', {
      clientRequestId: 'req-1',
      code: 'SSE_ERROR',
      sessionId: 'session-1',
    });

    expect(result.ok).toBe(true);
    expect(result.outcome).toBe('deduplicated');
  });

  it('缺少 clientRequestId（无幂等键）时直接放弃上报', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const reporter = createClientErrorReporter(GATEWAY_URL);
    const result = await reporter.reportClientStreamError('token-1', {
      clientRequestId: '   ',
      code: 'SSE_ERROR',
      sessionId: 'session-1',
    });

    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('网关不可达时静默失败，绝不抛错（传输层已经失败过一次）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    const reporter = createClientErrorReporter(GATEWAY_URL);
    await expect(
      reporter.reportClientStreamError('token-1', {
        clientRequestId: 'req-1',
        code: 'SSE_ERROR',
        sessionId: 'session-1',
      }),
    ).resolves.toMatchObject({ ok: false, outcome: 'failed' });
  });

  it('HTTP 4xx 返回结构化错误信息而不是抛异常', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: '请求体参数无效。' }, 400)),
    );

    const reporter = createClientErrorReporter(GATEWAY_URL);
    const result = await reporter.reportClientStreamError('token-1', {
      clientRequestId: 'req-1',
      code: 'SSE_ERROR',
      sessionId: 'session-1',
    });

    expect(result).toEqual({ ok: false, outcome: 'failed', errorMessage: '请求体参数无效。' });
  });
});
