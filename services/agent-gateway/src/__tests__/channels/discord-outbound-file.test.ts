import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelInstance } from '../../channels/types.js';

// Mock the shared channel HTTP helper so outbound file tests never hit the
// network; every assertion reads the captured request instead.
const channelFetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
vi.mock('../../channels/channel-http.js', () => ({
  channelFetch: (url: string, init?: RequestInit): Promise<Response> => channelFetchMock(url, init),
}));

const { DiscordChannelService } = await import('../../channels/discord.js');

const DISCORD_API = 'https://discord.com/api/v10';
/** 与实现中的 sanitize 正则保持一致的危险字符集合。 */
const DANGEROUS_FILE_NAME_CHARS = /[\\/:*?"<>|\r\n\t]/;

interface CapturedInit extends RequestInit {
  readonly timeoutMs?: number;
}

function buildInstance(): ChannelInstance {
  return {
    id: 'discord-outbound-file',
    type: 'discord',
    name: 'discord',
    enabled: true,
    config: { token: 'bot-token' },
    createdAt: 0,
    updatedAt: 0,
  };
}

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
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

function readPayload(form: FormData): Record<string, unknown> {
  const raw = form.get('payload_json');
  if (typeof raw !== 'string') {
    throw new Error('payload_json 分片缺失');
  }
  return JSON.parse(raw) as Record<string, unknown>;
}

function readAttachment(form: FormData): File {
  const entry = form.get('files[0]');
  if (!(entry instanceof File)) {
    throw new Error('files[0] 分片缺失');
  }
  return entry;
}

function readHeaders(init: CapturedInit): Headers {
  return new Headers(init.headers);
}

beforeEach(() => {
  channelFetchMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DiscordChannelService 出站发文件', () => {
  it('sendFile 走 multipart 消息端点，payload_json 带正文且请求不带 Content-Type 头', async () => {
    channelFetchMock.mockResolvedValue(okResponse({ id: 'msg-1' }));
    const signal = new AbortController().signal;
    const service = new DiscordChannelService(buildInstance(), vi.fn());

    const result = await service.sendFile('123', {
      buffer: Buffer.from('zip-bytes'),
      fileName: 'a.zip',
      text: 'x',
      signal,
    });

    expect(result).toEqual({ messageId: 'msg-1' });

    const { url, init } = captureRequest(0);
    expect(url).toBe(`${DISCORD_API}/channels/123/messages`);
    expect(init.method).toBe('POST');
    expect(init.signal).toBe(signal);
    expect(init.timeoutMs).toBe(30_000);
    expect(readPayload(readForm(init))).toEqual({ content: 'x' });
    const attachment = readAttachment(readForm(init));
    expect(attachment).toBeInstanceOf(Blob);
    expect(attachment.name).toBe('a.zip');
    const headers = readHeaders(init);
    expect(headers.get('authorization')).toBe('Bot bot-token');
    // multipart 请求必须让 fetch 自己生成 boundary，不能固定 JSON Content-Type。
    expect(headers.get('content-type')).toBeNull();
  });

  it('sendFile 清洗文件名里的路径分隔符、引号与换行', async () => {
    channelFetchMock.mockResolvedValue(okResponse({ id: 'msg-2' }));
    const service = new DiscordChannelService(buildInstance(), vi.fn());

    await service.sendFile('123', {
      buffer: Buffer.from('x'),
      fileName: '../b"c\n.zip',
      text: 'x',
    });

    const attachment = readAttachment(readForm(captureRequest(0).init));
    expect(attachment.name).not.toMatch(DANGEROUS_FILE_NAME_CHARS);
    expect(attachment.name).toBe('_b_c_.zip');
  });

  it('sendFile 未提供 text 时 payload_json.content 为空字符串', async () => {
    channelFetchMock.mockResolvedValue(okResponse({ id: 'msg-3' }));
    const service = new DiscordChannelService(buildInstance(), vi.fn());

    await service.sendFile('123', { buffer: Buffer.from('x'), fileName: 'a.zip' });

    const payload = readPayload(readForm(captureRequest(0).init));
    expect(payload['content']).toBe('');
    expect(readAttachment(readForm(captureRequest(0).init)).name).toBe('a.zip');
  });

  it('sendFile 成功时返回上游消息 id', async () => {
    channelFetchMock.mockResolvedValue(okResponse({ id: '999' }));
    const service = new DiscordChannelService(buildInstance(), vi.fn());

    await expect(
      service.sendFile('123', { buffer: Buffer.from('x'), fileName: 'a.zip' }),
    ).resolves.toEqual({ messageId: '999' });
  });
});
