import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelInstance } from '../../channels/types.js';

// channelFetch 是出站发文件唯一的网络出口：mock 掉它，断言全部基于捕获到的请求。
const channelFetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
vi.mock('../../channels/channel-http.js', () => ({
  channelFetch: (url: string, init?: RequestInit): Promise<Response> => channelFetchMock(url, init),
}));

const { TELEGRAM_CAPTION_MAX_LENGTH } = await import('../../channels/telegram-media.js');
const { TelegramChannelService } = await import('../../channels/telegram.js');

const BOT_TOKEN = '123:test-token';
const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

/** 可区分的二进制负载（内容无关紧要，只验证字节被原样放入附件）。 */
const FILE_BYTES = Buffer.from('%PDF-1.7 test payload');

interface CapturedInit extends RequestInit {
  readonly timeoutMs?: number;
}

function buildInstance(): ChannelInstance {
  return {
    id: 'tg-outbound-file',
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

describe('TelegramChannelService 出站发文件', () => {
  it('sendFile 走 sendDocument multipart：chat_id / document / caption 齐备且不带引用', async () => {
    channelFetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, result: { message_id: 91 } }));
    const signal = new AbortController().signal;
    const service = new TelegramChannelService(buildInstance(), vi.fn());

    const result = await service.sendFile('9', {
      buffer: FILE_BYTES,
      fileName: 'report.pdf',
      text: '报告',
      signal,
    });

    expect(result).toEqual({ messageId: '91' });

    const { url, init } = captureRequest(0);
    expect(url).toBe(`${API_BASE}/sendDocument`);
    expect(init.method).toBe('POST');
    expect(init.timeoutMs).toBe(30_000);
    expect(init.signal).toBe(signal);
    // multipart 的 boundary 必须由 fetch 生成，不能手动设置 Content-Type。
    expect(init.headers).toBeUndefined();

    const form = readForm(init);
    expect(form.get('chat_id')).toBe('9');
    expect(form.get('caption')).toBe('报告');
    expect(form.has('reply_to_message_id')).toBe(false);
    const document = form.get('document');
    expect(document).toBeInstanceOf(Blob);
    if (document instanceof Blob) {
      expect(document.size).toBe(FILE_BYTES.byteLength);
    }
    if (document instanceof File) {
      expect(document.name).toBe('report.pdf');
    }
  });

  it('sendFile 未提供 text 时不写入 caption 字段', async () => {
    channelFetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, result: { message_id: 92 } }));
    const service = new TelegramChannelService(buildInstance(), vi.fn());

    await service.sendFile('9', { buffer: FILE_BYTES, fileName: 'report.pdf' });

    const form = readForm(captureRequest(0).init);
    expect(form.has('caption')).toBe(false);
    const document = form.get('document');
    if (document instanceof File) {
      expect(document.name).toBe('report.pdf');
    }
  });

  it('sendFile 超长 text 截断到 TELEGRAM_CAPTION_MAX_LENGTH 以内', async () => {
    channelFetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, result: { message_id: 93 } }));
    const service = new TelegramChannelService(buildInstance(), vi.fn());

    await service.sendFile('9', {
      buffer: FILE_BYTES,
      fileName: 'report.pdf',
      text: '长'.repeat(2000),
    });

    const caption = readForm(captureRequest(0).init).get('caption');
    expect(typeof caption).toBe('string');
    if (typeof caption === 'string') {
      expect(caption.length).toBeLessThanOrEqual(TELEGRAM_CAPTION_MAX_LENGTH);
      expect(caption).toBe(`${'长'.repeat(TELEGRAM_CAPTION_MAX_LENGTH - 1)}…`);
    }
  });

  it('上游 ok:false 时 rejects，错误信息带 description', async () => {
    channelFetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: false, description: 'Bad Request: file is too big' }),
    );
    const service = new TelegramChannelService(buildInstance(), vi.fn());

    await expect(
      service.sendFile('9', { buffer: FILE_BYTES, fileName: 'report.pdf', text: 'hi' }),
    ).rejects.toThrow('Telegram sendDocument failed: Bad Request: file is too big');
  });
});
