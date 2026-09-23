import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelInstance } from '../../channels/types.js';
import type { QQMediaApiContext } from '../../channels/qq-media.js';

// Mock 掉共享的渠道 HTTP 助手：出站文件测试不触网，所有断言都读取捕获的请求。
const channelFetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
vi.mock('../../channels/channel-http.js', () => ({
  channelFetch: (url: string, init?: RequestInit): Promise<Response> => channelFetchMock(url, init),
}));

const { QQChannelService } = await import('../../channels/qq.js');
const { sendQQFile } = await import('../../channels/qq-media.js');

/** 生产环境的 QQ 开放平台 base（`QQApiClient` 默认域名）。 */
const QQ_API_BASE = 'https://api.sgroup.qq.com';
/** 直接调用 `sendQQFile` 时自带的 base：与 `QQApiClient` 无关，便于断言。 */
const DIRECT_API_BASE = 'https://qq.example.test';

interface CapturedInit extends RequestInit {
  readonly timeoutMs?: number;
}

function makeQQChannel(): ChannelInstance {
  return {
    id: 'qq-outbound-file',
    type: 'qq',
    name: 'QQ Outbound File',
    enabled: true,
    config: { appId: 'app-id', clientSecret: 'client-secret', markdownSupport: 'false' },
    ownerUserId: 'user-qq-outbound-file',
    createdAt: 1_788_000_000_000,
    updatedAt: 1_788_000_000_000,
  };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** 每个用例的第一次 `channelFetch`：获取 access token。 */
function queueTokenResponse(): void {
  channelFetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'token', expires_in: 7200 }));
}

/** 富媒体上传成功响应（`file_info` 会被带进 media 消息体）。 */
function queueUploadResponse(): void {
  channelFetchMock.mockResolvedValueOnce(
    jsonResponse({ file_uuid: 'file-uuid', file_info: 'file-info', ttl: 60 }),
  );
}

function captureRequest(index: number): { readonly url: string; readonly init: CapturedInit } {
  const call = channelFetchMock.mock.calls[index];
  if (!call) {
    throw new Error(`channelFetch 第 ${index + 1} 次调用不存在`);
  }
  return { url: call[0], init: call[1] ?? {} };
}

function readJsonBody(init: CapturedInit): Record<string, unknown> {
  if (typeof init.body !== 'string') {
    throw new Error('期望 JSON 字符串请求体');
  }
  return JSON.parse(init.body) as Record<string, unknown>;
}

function makeMediaContext(overrides: Partial<QQMediaApiContext> = {}): QQMediaApiContext {
  return {
    apiBase: DIRECT_API_BASE,
    getAccessToken: async () => 'token',
    getNextMsgSeq: () => 1,
    sendMessageBody: async () => ({ messageId: 'sent-direct' }),
    ...overrides,
  };
}

beforeEach(() => {
  channelFetchMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('QQChannelService.sendFile', () => {
  it('C2C：先上传 file_type 4 的富媒体，再以 msg_type 7 发送', async () => {
    const fileBuffer = Buffer.from('fake pdf bytes');
    queueTokenResponse();
    queueUploadResponse();
    channelFetchMock.mockResolvedValueOnce(jsonResponse({ id: 'sent-file' }));
    const service = new QQChannelService(makeQQChannel(), () => undefined);

    const result = await service.sendFile('c2c:user-open-id', {
      buffer: fileBuffer,
      fileName: 'report.pdf',
      fileType: 'pdf',
      text: '月度报告',
    });

    expect(result).toEqual({ messageId: 'sent-file' });
    expect(channelFetchMock).toHaveBeenCalledTimes(3);

    const upload = captureRequest(1);
    expect(upload.url).toBe(`${QQ_API_BASE}/v2/users/user-open-id/files`);
    expect(upload.init.method).toBe('POST');
    expect(new Headers(upload.init.headers).get('authorization')).toBe('QQBot token');
    expect(readJsonBody(upload.init)).toEqual({
      file_type: 4,
      file_data: fileBuffer.toString('base64'),
    });

    const send = captureRequest(2);
    expect(send.url).toBe(`${QQ_API_BASE}/v2/users/user-open-id/messages`);
    expect(send.init.method).toBe('POST');
    expect(readJsonBody(send.init)).toMatchObject({
      content: '月度报告',
      media: { file_info: 'file-info' },
      msg_type: 7,
      msg_seq: 1,
    });
  });

  it('群聊：上传与发送都走 group endpoint，未给 text 时 content 为空格', async () => {
    const fileBuffer = Buffer.from('group zip');
    queueTokenResponse();
    queueUploadResponse();
    channelFetchMock.mockResolvedValueOnce(jsonResponse({ id: 'sent-group-file' }));
    const service = new QQChannelService(makeQQChannel(), () => undefined);

    await service.sendFile('group:group-open-id', {
      buffer: fileBuffer,
      fileName: 'archive.zip',
    });

    expect(captureRequest(1).url).toBe(`${QQ_API_BASE}/v2/groups/group-open-id/files`);
    expect(readJsonBody(captureRequest(1).init)).toEqual({
      file_type: 4,
      file_data: fileBuffer.toString('base64'),
    });
    expect(captureRequest(2).url).toBe(`${QQ_API_BASE}/v2/groups/group-open-id/messages`);
    expect(readJsonBody(captureRequest(2).init)).toMatchObject({
      content: ' ',
      media: { file_info: 'file-info' },
      msg_type: 7,
      msg_seq: 1,
    });
  });

  it('频道目标不支持文件发送，且不发任何请求', async () => {
    const service = new QQChannelService(makeQQChannel(), () => undefined);

    await expect(
      service.sendFile('channel:channel-id', { buffer: Buffer.from('x'), fileName: 'x.bin' }),
    ).rejects.toThrow('do not support this file sender');
    expect(channelFetchMock).not.toHaveBeenCalled();
  });

  it('上传失败（上游 code/message）时 rejects，且不发送媒体消息', async () => {
    queueTokenResponse();
    channelFetchMock.mockResolvedValueOnce(jsonResponse({ code: 'xxx', message: 'fail' }));
    const service = new QQChannelService(makeQQChannel(), () => undefined);

    await expect(
      service.sendFile('c2c:user-open-id', { buffer: Buffer.from('x'), fileName: 'x.bin' }),
    ).rejects.toThrow('QQ media upload error xxx: fail');
    expect(channelFetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('sendQQFile', () => {
  it('sourceUrl 存在时上传体用 url 字段而不是 file_data', async () => {
    channelFetchMock.mockResolvedValueOnce(
      jsonResponse({ file_uuid: 'file-uuid', file_info: 'file-info', ttl: 60 }),
    );
    const sendMessageBody = vi.fn<QQMediaApiContext['sendMessageBody']>(async () => ({
      messageId: 'sent-url-file',
    }));

    const result = await sendQQFile(
      makeMediaContext({ sendMessageBody }),
      { type: 'c2c', id: 'user-open-id' },
      {
        buffer: Buffer.from('downloaded bytes'),
        fileName: 'remote.pdf',
        sourceUrl: 'https://example.com/remote.pdf',
      },
    );

    expect(result).toEqual({ messageId: 'sent-url-file' });

    const upload = captureRequest(0);
    expect(upload.url).toBe(`${DIRECT_API_BASE}/v2/users/user-open-id/files`);
    expect(readJsonBody(upload.init)).toEqual({
      file_type: 4,
      url: 'https://example.com/remote.pdf',
    });

    expect(sendMessageBody).toHaveBeenCalledTimes(1);
    expect(sendMessageBody.mock.calls[0]?.[0]).toBe('/v2/users/user-open-id/messages');
    expect(sendMessageBody.mock.calls[0]?.[1]).toMatchObject({
      content: ' ',
      media: { file_info: 'file-info' },
      msg_type: 7,
      msg_seq: 1,
    });
  });
});
