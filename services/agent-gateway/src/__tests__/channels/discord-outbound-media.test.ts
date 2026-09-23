import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelInstance } from '../../channels/types.js';

// Mock the shared channel HTTP helper so outbound media tests never hit the
// network; every assertion reads the captured request instead.
const channelFetchMock = vi.fn();
vi.mock('../../channels/channel-http.js', () => ({
  channelFetch: (...args: unknown[]) => channelFetchMock(...args),
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
    id: 'discord-outbound-1',
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
  const call = channelFetchMock.mock.calls[index] as [string, CapturedInit] | undefined;
  if (!call) {
    throw new Error(`channelFetch call #${index} is missing`);
  }
  return { url: call[0], init: call[1] };
}

function readForm(init: CapturedInit): FormData {
  if (!(init.body instanceof FormData)) {
    throw new Error('expected a multipart FormData body');
  }
  return init.body;
}

function readPayload(form: FormData): Record<string, unknown> {
  const raw = form.get('payload_json');
  if (typeof raw !== 'string') {
    throw new Error('payload_json part is missing');
  }
  return JSON.parse(raw) as Record<string, unknown>;
}

function readAttachment(form: FormData): File {
  const entry = form.get('files[0]');
  if (!(entry instanceof File)) {
    throw new Error('files[0] part is missing');
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

describe('DiscordChannelService 出站图片/文件', () => {
  it('sendImage 走 multipart 消息端点，payload_json 带正文且请求不带 Content-Type 头', async () => {
    channelFetchMock.mockResolvedValue(okResponse({ id: 'msg-1' }));
    const signal = new AbortController().signal;
    const service = new DiscordChannelService(buildInstance(), vi.fn());

    const result = await service.sendImage('chan-1', {
      buffer: Buffer.from('png-bytes'),
      fileName: 'photo.png',
      text: '看图',
      signal,
    });

    expect(result).toEqual({ messageId: 'msg-1' });

    const { url, init } = captureRequest(0);
    expect(url).toBe(`${DISCORD_API}/channels/chan-1/messages`);
    expect(init.method).toBe('POST');
    expect(init.signal).toBe(signal);
    expect(init.timeoutMs).toBe(30_000);
    expect(readPayload(readForm(init))).toEqual({ content: '看图' });
    const attachment = readAttachment(readForm(init));
    expect(attachment).toBeInstanceOf(Blob);
    expect(attachment.name).toBe('photo.png');
    const headers = readHeaders(init);
    expect(headers.get('authorization')).toBe('Bot bot-token');
    // multipart 请求必须让 fetch 自己生成 boundary，不能固定 JSON Content-Type。
    expect(headers.get('content-type')).toBeNull();
  });

  it('sendImage 把超长正文截断到 Discord 的 2000 字符上限', async () => {
    channelFetchMock.mockResolvedValue(okResponse({ id: 'msg-2' }));
    const service = new DiscordChannelService(buildInstance(), vi.fn());

    await service.sendImage('chan-1', {
      buffer: Buffer.from('x'),
      text: '长'.repeat(3000),
    });

    const content = readPayload(readForm(captureRequest(0).init))['content'];
    if (typeof content !== 'string') {
      throw new Error('payload_json.content must be a string');
    }
    expect(content.length).toBeLessThanOrEqual(2000);
    expect(content.length).toBe(2000);
    expect(content.endsWith('…')).toBe(true);
  });

  it('sendImage 清洗文件名里的路径分隔符、引号与换行', async () => {
    channelFetchMock.mockResolvedValue(okResponse({ id: 'msg-3' }));
    const service = new DiscordChannelService(buildInstance(), vi.fn());

    await service.sendImage('chan-1', {
      buffer: Buffer.from('x'),
      fileName: '../a"b\n.png',
    });

    const attachment = readAttachment(readForm(captureRequest(0).init));
    expect(attachment.name).not.toMatch(DANGEROUS_FILE_NAME_CHARS);
    expect(attachment.name).toBe('_a_b_.png');
  });

  it('sendImage 对空文件名回退 upload.bin，对超长文件名截断到 100', async () => {
    // 同一测试里发两次请求，必须每次返回新的 Response（body 只能读一次）。
    channelFetchMock.mockImplementation(() => Promise.resolve(okResponse({ id: 'msg-4' })));
    const service = new DiscordChannelService(buildInstance(), vi.fn());

    await service.sendImage('chan-1', { buffer: Buffer.from('x'), fileName: ' . ' });
    await service.sendImage('chan-1', {
      buffer: Buffer.from('x'),
      fileName: `${'a'.repeat(150)}.png`,
    });

    expect(readAttachment(readForm(captureRequest(0).init)).name).toBe('upload.bin');
    expect(readAttachment(readForm(captureRequest(1).init)).name).toBe('a'.repeat(100));
  });

  it('replyImage 用引用里的 channelId 作为路径，message_reference 指向被回复消息', async () => {
    channelFetchMock.mockResolvedValue(okResponse({ id: 'msg-5' }));
    const service = new DiscordChannelService(buildInstance(), vi.fn());

    const result = await service.replyImage('123:456', {
      buffer: Buffer.from('x'),
      text: 'reply',
    });

    expect(result).toEqual({ messageId: 'msg-5' });
    const { url, init } = captureRequest(0);
    expect(url).toBe(`${DISCORD_API}/channels/123/messages`);
    const payload = readPayload(readForm(init));
    expect(payload['content']).toBe('reply');
    expect(payload['message_reference']).toEqual({ message_id: '456' });
  });

  it('replyImage 缺少 "<channelId>:<messageId>" 引用时直接抛错且不发请求', async () => {
    const service = new DiscordChannelService(buildInstance(), vi.fn());

    await expect(service.replyImage('123', { buffer: Buffer.from('x') })).rejects.toThrow(
      /<channelId>:<messageId>/,
    );
    expect(channelFetchMock).not.toHaveBeenCalled();
  });

  it('sendImage 上游 400 时抛出携带 Discord message 的错误', async () => {
    channelFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: 'Invalid Form Body', code: 50035 }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const service = new DiscordChannelService(buildInstance(), vi.fn());

    await expect(
      service.sendImage('chan-1', { buffer: Buffer.from('x'), text: 'hi' }),
    ).rejects.toThrow('Discord message send failed: Invalid Form Body');
  });

  it('sendImage 成功时返回上游消息 id', async () => {
    channelFetchMock.mockResolvedValue(okResponse({ id: '999' }));
    const service = new DiscordChannelService(buildInstance(), vi.fn());

    await expect(service.sendImage('chan-1', { buffer: Buffer.from('x') })).resolves.toEqual({
      messageId: '999',
    });
  });
});
