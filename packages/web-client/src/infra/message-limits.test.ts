import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMessageLimitsClient } from './message-limits.js';
import { HttpError } from '../gateway/http.js';

const snapshot = {
  maxChars: 32768,
  minChars: 1024,
  hardMaxChars: 200000,
  defaultMaxChars: 32768,
  canEdit: true,
};
afterEach(() => vi.unstubAllGlobals());

describe('message limits client', () => {
  it('读取与写入使用正确端点、认证和请求体', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => Response.json(snapshot));
    vi.stubGlobal('fetch', fetchMock);
    const client = createMessageLimitsClient('http://gateway/');
    expect(await client.read('token')).toEqual(snapshot);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://gateway/settings/message-limits');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: 'Bearer token' },
    });
    expect(await client.write('admin', 1024)).toEqual(snapshot);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: 'PUT',
      headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
      body: '{"maxChars":1024}',
    });
  });

  it.each([
    null,
    {},
    { ...snapshot, maxChars: 1023 },
    { ...snapshot, canEdit: 'true' },
    { ...snapshot, hardMaxChars: 300000 },
    { ...snapshot, maxChars: 1024.5 },
  ])('拒绝损坏响应 %j', async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body)));
    await expect(createMessageLimitsClient('http://gateway').read('t')).rejects.toBeInstanceOf(
      HttpError,
    );
  });

  it.each([401, 403, 400, 500])('保留 HTTP 错误状态 %i', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: '失败' }, { status })));
    await expect(
      createMessageLimitsClient('http://gateway').write('t', 1024),
    ).rejects.toMatchObject({ status });
  });
});
