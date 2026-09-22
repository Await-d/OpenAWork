import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webfetchTool } from '../../tools/web-tools.js';

const NO_SIGNAL = new AbortController().signal;

/** 读取第 `callIndex` 次 fetch 调用实际发送的 User-Agent。 */
function userAgentOf(callIndex: number): string | null {
  const init = vi.mocked(globalThis.fetch).mock.calls[callIndex]?.[1];
  return new Headers(init?.headers).get('user-agent');
}

function cloudflareChallengeResponse(): Response {
  return new Response('challenge', {
    status: 403,
    headers: { 'cf-mitigated': 'challenge' },
  });
}

function okResponse(): Response {
  return new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } });
}

describe('webfetch Cloudflare 挑战重试', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('首次命中 cf-mitigated:challenge 时换 User-Agent 重试一次并成功', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(cloudflareChallengeResponse())
      .mockResolvedValueOnce(okResponse());

    const result = await webfetchTool.execute(
      { url: 'https://example.com/protected', format: 'text', timeout: 20 },
      NO_SIGNAL,
    );

    expect(result.status).toBe(200);
    expect(result.content).toBe('ok');
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);

    // 首次请求不显式设置 UA（保持运行时默认，零行为变更）；
    // 仅重试时改用专用 UA，因此二者必然不同。
    const firstUserAgent = userAgentOf(0);
    const secondUserAgent = userAgentOf(1);
    expect(firstUserAgent).toBeNull();
    expect(secondUserAgent).not.toBeNull();
    expect(secondUserAgent).not.toBe(firstUserAgent);
  });

  it('403 但没有 cf-mitigated:challenge 时不重试', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response('forbidden', { status: 403 }));

    await expect(
      webfetchTool.execute(
        { url: 'https://example.com/forbidden', format: 'text', timeout: 20 },
        NO_SIGNAL,
      ),
    ).rejects.toThrow('webfetch request failed with status 403');

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('非 403 响应不重试', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(okResponse());

    const result = await webfetchTool.execute(
      { url: 'https://example.com/plain', format: 'text', timeout: 20 },
      NO_SIGNAL,
    );

    expect(result.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('重试后仍为 403 时返回原有错误且只请求两次', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(cloudflareChallengeResponse());

    await expect(
      webfetchTool.execute(
        { url: 'https://example.com/always-challenged', format: 'text', timeout: 20 },
        NO_SIGNAL,
      ),
    ).rejects.toThrow('webfetch request failed with status 403');

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(userAgentOf(0)).toBeNull();
    expect(userAgentOf(1)).not.toBeNull();
  });
});
