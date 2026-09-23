import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelInstance } from '../../channels/types.js';

// channelFetch 是出站发图唯一的网络出口：mock 掉它，断言全部基于捕获到的请求。
const channelFetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
vi.mock('../../channels/channel-http.js', () => ({
  channelFetch: (url: string, init?: RequestInit): Promise<Response> => channelFetchMock(url, init),
}));

const { TelegramChannelService } = await import('../../channels/telegram.js');

const BOT_TOKEN = '123:test-token';
const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

/** PNG 魔数（12 字节，仅作为可区分的二进制负载）。 */
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

interface CapturedInit extends RequestInit {
  readonly timeoutMs?: number;
}

function buildInstance(): ChannelInstance {
  return {
    id: 'tg-outbound-media',
    type: 'telegram',
    name: 'tg',
    enabled: true,
    config: { token: BOT_TOKEN },
    createdAt: 0,
    updatedAt: 0,
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

beforeEach(() => {
  channelFetchMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TelegramChannelService 出站发图', () => {
  it('sendImage 走 sendPhoto multipart：chat_id / photo / caption 齐备且不带引用', async () => {
    channelFetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, result: { message_id: 77 } }));
    const signal = new AbortController().signal;
    const service = new TelegramChannelService(buildInstance(), vi.fn());

    const result = await service.sendImage('9', {
      buffer: PNG_BYTES,
      fileName: 'a.png',
      text: '看这张',
      signal,
      sourceUrl: 'https://example.com/a.png',
    });

    expect(result).toEqual({ messageId: '77' });

    const { url, init } = captureRequest(0);
    expect(url).toBe(`${API_BASE}/sendPhoto`);
    expect(init.method).toBe('POST');
    expect(init.timeoutMs).toBe(30_000);
    expect(init.signal).toBe(signal);
    // multipart 的 boundary 必须由 fetch 生成，不能手动设置 Content-Type。
    expect(init.headers).toBeUndefined();

    const form = readForm(init);
    expect(form.get('chat_id')).toBe('9');
    expect(form.get('caption')).toBe('看这张');
    expect(form.has('reply_to_message_id')).toBe(false);
    const photo = form.get('photo');
    expect(photo).toBeInstanceOf(Blob);
    if (photo instanceof Blob) {
      expect(photo.size).toBe(PNG_BYTES.byteLength);
    }
    if (photo instanceof File) {
      expect(photo.name).toBe('a.png');
    }
  });

  it('replyImage 按 "<chatId>:<msgId>" 拆分，reply_to_message_id 指向被回复消息', async () => {
    channelFetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, result: { message_id: 78 } }));
    const service = new TelegramChannelService(buildInstance(), vi.fn());

    const result = await service.replyImage('9:123', {
      buffer: PNG_BYTES,
      fileName: 'b.png',
      text: '回复图',
    });

    expect(result).toEqual({ messageId: '78' });
    const { url, init } = captureRequest(0);
    expect(url).toBe(`${API_BASE}/sendPhoto`);
    const form = readForm(init);
    expect(form.get('chat_id')).toBe('9');
    expect(form.get('reply_to_message_id')).toBe('123');
    expect(form.get('caption')).toBe('回复图');
    const photo = form.get('photo');
    expect(photo).toBeInstanceOf(Blob);
    if (photo instanceof File) {
      expect(photo.name).toBe('b.png');
    }
  });

  it('replyImage 缺少 "<chatId>:<messageId>" 引用时直接抛错且不发请求', async () => {
    const service = new TelegramChannelService(buildInstance(), vi.fn());

    await expect(service.replyImage('bad-ref', { buffer: PNG_BYTES })).rejects.toThrow(
      '<chatId>:<messageId>',
    );
    await expect(service.replyImage('9:', { buffer: PNG_BYTES })).rejects.toThrow(
      'Telegram image reply requires "<chatId>:<messageId>" reference',
    );
    expect(channelFetchMock).not.toHaveBeenCalled();
  });

  it('上游 ok:false 时 rejects，错误信息带 description', async () => {
    channelFetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, description: 'boom' }));
    const service = new TelegramChannelService(buildInstance(), vi.fn());

    await expect(service.sendImage('9', { buffer: PNG_BYTES, text: 'hi' })).rejects.toThrow(
      'Telegram sendPhoto failed: boom',
    );
  });
});
