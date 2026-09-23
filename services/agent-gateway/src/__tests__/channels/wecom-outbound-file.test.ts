import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelInstance } from '../../channels/types.js';

// channelFetch 是出站发文件唯一的网络出口：mock 掉它，断言全部基于捕获到的请求。
const channelFetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
vi.mock('../../channels/channel-http.js', () => ({
  channelFetch: (url: string, init?: RequestInit): Promise<Response> => channelFetchMock(url, init),
}));

const { WeComChannelService } = await import('../../channels/wecom.js');

const CORP_CONFIG = { corpId: 'corp-1', corpSecret: 'secret-1', agentId: '100001' };
const TOKEN = 'wecom-token-abc';

/** 可区分的二进制负载（内容无关紧要，只验证字节被原样放入附件）。 */
const FILE_BYTES = Buffer.from('%PDF-1.7 wecom test payload');

interface CapturedInit extends RequestInit {
  readonly timeoutMs?: number;
}

function buildInstance(config: Record<string, string>): ChannelInstance {
  return {
    id: 'wecom-outbound-file',
    type: 'wecom',
    name: 'WeCom Outbound File',
    enabled: true,
    config,
    features: { autoReply: true, streamingReply: false, autoStart: true },
    ownerUserId: 'u-wecom',
    createdAt: 1_788_000_000_000,
    updatedAt: 1_788_000_000_000,
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function captureRequest(index: number): { readonly url: string; readonly init: CapturedInit } {
  const call = channelFetchMock.mock.calls[index];
  if (!call) {
    throw new Error(`channelFetch 第 ${index + 1} 次调用不存在`);
  }
  return { url: call[0], init: call[1] ?? {} };
}

function readForm(init: CapturedInit): FormData {
  if (!(init.body instanceof FormData)) {
    throw new Error('期望 multipart FormData 请求体');
  }
  return init.body;
}

function readJsonBody(init: CapturedInit): Record<string, unknown> {
  if (typeof init.body !== 'string') {
    throw new Error('期望 JSON 字符串请求体');
  }
  return JSON.parse(init.body) as Record<string, unknown>;
}

beforeEach(() => {
  channelFetchMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WeComChannelService 出站发文件', () => {
  it('webhook-only 模式拒绝发文件，且零网络请求', async () => {
    const service = new WeComChannelService(
      buildInstance({ webhookUrl: 'https://wecom.example/webhook' }),
      vi.fn(),
    );

    await expect(
      service.sendFile('user-1', { buffer: FILE_BYTES, fileName: 'report.pdf' }),
    ).rejects.toThrow('WeCom webhook mode does not support file messages');
    expect(channelFetchMock).not.toHaveBeenCalled();
  });

  it('应用模式：gettoken → media/upload（multipart media）→ message/send（msgtype=file）', async () => {
    channelFetchMock
      .mockResolvedValueOnce(jsonResponse({ errcode: 0, access_token: TOKEN }))
      .mockResolvedValueOnce(jsonResponse({ errcode: 0, media_id: 'MEDIA-1' }))
      .mockResolvedValueOnce(jsonResponse({ errcode: 0, errmsg: 'ok', msgid: 'MSG-9' }));
    const signal = new AbortController().signal;
    const service = new WeComChannelService(buildInstance({ ...CORP_CONFIG }), vi.fn());

    const result = await service.sendFile('user-1', {
      buffer: FILE_BYTES,
      fileName: 'report.pdf',
      fileType: 'pdf',
      text: '报告',
      signal,
    });

    expect(result).toEqual({ messageId: 'MSG-9' });
    expect(channelFetchMock).toHaveBeenCalledTimes(3);

    const tokenCall = captureRequest(0);
    expect(tokenCall.url).toContain('/cgi-bin/gettoken');
    expect(tokenCall.url).toContain('corpid=corp-1');

    const uploadCall = captureRequest(1);
    expect(uploadCall.url).toContain('/cgi-bin/media/upload');
    expect(uploadCall.url).toContain('type=file');
    expect(uploadCall.url).toContain(`access_token=${TOKEN}`);
    expect(uploadCall.init.method).toBe('POST');
    expect(uploadCall.init.timeoutMs).toBe(60_000);
    expect(uploadCall.init.signal).toBe(signal);
    // multipart 的 boundary 必须由 fetch 生成，不能手动设置 Content-Type。
    expect(uploadCall.init.headers).toBeUndefined();
    const media = readForm(uploadCall.init).get('media');
    expect(media).toBeInstanceOf(Blob);
    if (media instanceof Blob) {
      expect(media.size).toBe(FILE_BYTES.byteLength);
    }
    if (media instanceof File) {
      expect(media.name).toBe('report.pdf');
    }

    const sendCall = captureRequest(2);
    expect(sendCall.url).toBe(
      `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${TOKEN}`,
    );
    expect(sendCall.init.method).toBe('POST');
    expect(sendCall.init.signal).toBe(signal);
    const body = readJsonBody(sendCall.init);
    expect(body['touser']).toBe('user-1');
    expect(body['msgtype']).toBe('file');
    expect(body['agentid']).toBe(100001);
    expect(typeof body['agentid']).toBe('number');
    expect(body['file']).toEqual({ media_id: 'MEDIA-1' });
    // 企业微信 file 消息没有 caption 字段：text 不参与发送。
    expect(body).not.toHaveProperty('text');
  });

  it('媒体上传 errcode 非 0 时抛错，且不发 file 消息', async () => {
    channelFetchMock
      .mockResolvedValueOnce(jsonResponse({ errcode: 0, access_token: TOKEN }))
      .mockResolvedValueOnce(jsonResponse({ errcode: 40001, errmsg: 'invalid credential' }));
    const service = new WeComChannelService(buildInstance({ ...CORP_CONFIG }), vi.fn());

    await expect(
      service.sendFile('user-1', { buffer: FILE_BYTES, fileName: 'report.pdf' }),
    ).rejects.toThrow('WeCom media upload failed: invalid credential');
    expect(channelFetchMock).toHaveBeenCalledTimes(2);
    expect(captureRequest(1).url).toContain('/cgi-bin/media/upload');
  });

  it('上传成功但缺 media_id 时同样抛错', async () => {
    channelFetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: TOKEN }))
      .mockResolvedValueOnce(jsonResponse({ errcode: 0 }));
    const service = new WeComChannelService(buildInstance({ ...CORP_CONFIG }), vi.fn());

    await expect(
      service.sendFile('user-1', { buffer: FILE_BYTES, fileName: 'report.pdf' }),
    ).rejects.toThrow('WeCom media upload failed: 0');
    expect(channelFetchMock).toHaveBeenCalledTimes(2);
  });

  it('发送 file 消息 errcode 非 0 时抛错并带错误码', async () => {
    channelFetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: TOKEN }))
      .mockResolvedValueOnce(jsonResponse({ media_id: 'MEDIA-1' }))
      .mockResolvedValueOnce(jsonResponse({ errcode: 81013, errmsg: 'no permission' }));
    const service = new WeComChannelService(buildInstance({ ...CORP_CONFIG }), vi.fn());

    await expect(
      service.sendFile('user-1', { buffer: FILE_BYTES, fileName: 'report.pdf' }),
    ).rejects.toThrow('WeCom API error 81013: no permission');
    expect(channelFetchMock).toHaveBeenCalledTimes(3);
  });

  it('上游未返回 msgid 时以时间戳兜底', async () => {
    channelFetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: TOKEN }))
      .mockResolvedValueOnce(jsonResponse({ media_id: 'MEDIA-1' }))
      .mockResolvedValueOnce(jsonResponse({ errcode: 0 }));
    const service = new WeComChannelService(buildInstance({ ...CORP_CONFIG }), vi.fn());

    const result = await service.sendFile('user-1', {
      buffer: FILE_BYTES,
      fileName: 'report.pdf',
    });

    expect(result.messageId).toMatch(/^\d+$/);
  });
});
