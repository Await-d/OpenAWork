import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// channelFetch 是本模块唯一的网络出口：mock 掉它即可在无网络条件下覆盖
// 入站下载与出站上传的全部分支。
const channelFetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
vi.mock('../../channels/channel-http.js', () => ({
  channelFetch: (url: string, init?: RequestInit): Promise<Response> => channelFetchMock(url, init),
}));

const {
  TELEGRAM_CAPTION_MAX_LENGTH,
  TELEGRAM_INBOUND_IMAGE_MAX_BYTES,
  downloadTelegramInboundImage,
  sendTelegramPhoto,
} = await import('../../channels/telegram-media.js');

const API_BASE = 'https://api.telegram.org/bot123';
const FILE_BASE_URL = 'https://api.telegram.org/file/bot123';

/** PNG 魔数（12 字节，满足 sniffImageMediaType 的最小长度要求）。 */
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

/** 不匹配任何已知图片魔数的 12 字节负载，用于验证 sniff 失败分支。 */
const UNKNOWN_BYTES = Buffer.from('not-an-image');

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function binaryResponse(bytes: Buffer, status = 200): Response {
  return new Response(new Uint8Array(bytes), { status });
}

function readCall(index: number): { url: string; init: RequestInit } {
  const call = channelFetchMock.mock.calls[index];
  if (!call) {
    throw new Error(`channelFetch 第 ${index + 1} 次调用不存在`);
  }
  return { url: call[0], init: call[1] ?? {} };
}

function readFormData(index: number): FormData {
  const { init } = readCall(index);
  if (!(init.body instanceof FormData)) {
    throw new Error('channelFetch 的 body 不是 FormData');
  }
  return init.body;
}

function inboundInput(overrides: Partial<Parameters<typeof downloadTelegramInboundImage>[0]> = {}) {
  return {
    apiBase: API_BASE,
    fileBaseUrl: FILE_BASE_URL,
    fileId: 'file-1',
    ...overrides,
  };
}

function photoInput(overrides: Partial<Parameters<typeof sendTelegramPhoto>[0]> = {}) {
  return {
    apiBase: API_BASE,
    chatId: 'chat-9',
    buffer: PNG_BYTES,
    ...overrides,
  };
}

beforeEach(() => {
  channelFetchMock.mockReset();
  // 入站失败路径会 warn，测试里静音以免污染输出；用例本身不依赖 warn 内容。
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('downloadTelegramInboundImage', () => {
  it('成功路径：按魔数判定 mediaType 并转 base64，fileName 透传', async () => {
    channelFetchMock
      .mockResolvedValueOnce(
        jsonResponse({ ok: true, result: { file_path: 'photos/a.png', file_size: 100 } }),
      )
      .mockResolvedValueOnce(binaryResponse(PNG_BYTES));

    const attachment = await downloadTelegramInboundImage(inboundInput({ fileName: 'a.png' }));

    expect(attachment).toEqual({
      base64: PNG_BYTES.toString('base64'),
      mediaType: 'image/png',
      fileName: 'a.png',
    });
    expect(channelFetchMock).toHaveBeenCalledTimes(2);

    const fileInfoCall = readCall(0);
    expect(fileInfoCall.url).toBe(`${API_BASE}/getFile?file_id=file-1`);
    expect(fileInfoCall.init).toMatchObject({ timeoutMs: 30_000 });
    expect(readCall(1).url).toBe(`${FILE_BASE_URL}/photos/a.png`);
  });

  it('入参 fileSize 超限时直接返回 null，且零网络请求', async () => {
    const attachment = await downloadTelegramInboundImage(
      inboundInput({ fileSize: TELEGRAM_INBOUND_IMAGE_MAX_BYTES + 1 }),
    );

    expect(attachment).toBeNull();
    expect(channelFetchMock).not.toHaveBeenCalled();
  });

  it('getFile 返回 ok:false 时返回 null', async () => {
    channelFetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: false, description: 'file is too big' }),
    );

    const attachment = await downloadTelegramInboundImage(inboundInput());

    expect(attachment).toBeNull();
    expect(channelFetchMock).toHaveBeenCalledTimes(1);
  });

  it('getFile 返回的 file_size 超限时返回 null，且不再下载文件', async () => {
    channelFetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        result: { file_path: 'photos/big.png', file_size: TELEGRAM_INBOUND_IMAGE_MAX_BYTES + 1 },
      }),
    );

    const attachment = await downloadTelegramInboundImage(inboundInput());

    expect(attachment).toBeNull();
    expect(channelFetchMock).toHaveBeenCalledTimes(1);
  });

  it('文件下载返回 HTTP 500 时返回 null', async () => {
    channelFetchMock
      .mockResolvedValueOnce(
        jsonResponse({ ok: true, result: { file_path: 'photos/a.png', file_size: 100 } }),
      )
      .mockResolvedValueOnce(new Response('upstream down', { status: 500 }));

    const attachment = await downloadTelegramInboundImage(inboundInput());

    expect(attachment).toBeNull();
    expect(channelFetchMock).toHaveBeenCalledTimes(2);
  });

  it('魔数无法识别时回退到调用方提供的 mimeType', async () => {
    channelFetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: true, result: { file_path: 'photos/a.bin' } }))
      .mockResolvedValueOnce(binaryResponse(UNKNOWN_BYTES));

    const attachment = await downloadTelegramInboundImage(inboundInput({ mimeType: 'image/heic' }));

    expect(attachment).toEqual({
      base64: UNKNOWN_BYTES.toString('base64'),
      mediaType: 'image/heic',
    });
  });

  it('魔数与 mimeType 都无法确定 mediaType 时返回 null（不猜测）', async () => {
    channelFetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: true, result: { file_path: 'photos/a.bin' } }))
      .mockResolvedValueOnce(binaryResponse(UNKNOWN_BYTES));

    const attachment = await downloadTelegramInboundImage(inboundInput());

    expect(attachment).toBeNull();
  });

  it('网络异常不向调用方抛出，而是 warn 后返回 null', async () => {
    channelFetchMock.mockRejectedValueOnce(new Error('socket hang up'));

    await expect(downloadTelegramInboundImage(inboundInput())).resolves.toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      '[telegram] 入站图片下载失败',
      expect.objectContaining({ fileId: 'file-1', error: 'socket hang up' }),
    );
  });
});

describe('sendTelegramPhoto', () => {
  it('以 multipart 发送 chat_id / photo / caption / reply_to_message_id', async () => {
    channelFetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, result: { message_id: 77 } }));

    const sent = await sendTelegramPhoto(
      photoInput({
        fileName: 'photo.png',
        caption: '看这张图',
        replyToMessageId: '42',
      }),
    );

    expect(sent).toEqual({ messageId: '77' });
    expect(channelFetchMock).toHaveBeenCalledTimes(1);

    const call = readCall(0);
    expect(call.url).toMatch(/\/sendPhoto$/);
    expect(call.init.method).toBe('POST');
    // 不得手动设置 Content-Type：FormData 的 boundary 必须由 fetch 生成。
    expect(call.init.headers).toBeUndefined();
    expect(call.init.body).toBeInstanceOf(FormData);

    const form = readFormData(0);
    expect(form.get('chat_id')).toBe('chat-9');
    expect(form.get('caption')).toBe('看这张图');
    expect(form.get('reply_to_message_id')).toBe('42');

    const photo = form.get('photo');
    expect(photo).toBeInstanceOf(Blob);
    if (photo instanceof Blob) {
      expect(photo.size).toBe(PNG_BYTES.byteLength);
    }
    if (photo instanceof File) {
      expect(photo.name).toBe('photo.png');
    }
  });

  it('未提供 caption / replyToMessageId 时不写入对应字段', async () => {
    channelFetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, result: { message_id: 1 } }));

    await sendTelegramPhoto(photoInput());

    const form = readFormData(0);
    expect(form.has('caption')).toBe(false);
    expect(form.has('reply_to_message_id')).toBe(false);
    const photo = form.get('photo');
    if (photo instanceof File) {
      expect(photo.name).toBe('image.png');
    }
  });

  it('超长 caption 截断到 TELEGRAM_CAPTION_MAX_LENGTH 以内', async () => {
    channelFetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, result: { message_id: 1 } }));

    await sendTelegramPhoto(photoInput({ caption: '很'.repeat(2000) }));

    const caption = readFormData(0).get('caption');
    expect(typeof caption).toBe('string');
    if (typeof caption === 'string') {
      expect(caption.length).toBeLessThanOrEqual(TELEGRAM_CAPTION_MAX_LENGTH);
      expect(caption).toBe(`${'很'.repeat(TELEGRAM_CAPTION_MAX_LENGTH - 1)}…`);
    }
  });

  it('上游 ok:false 时抛出带 description 的错误', async () => {
    channelFetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: false, description: 'Bad Request: chat not found' }),
    );

    await expect(sendTelegramPhoto(photoInput())).rejects.toThrow(
      'Telegram sendPhoto failed: Bad Request: chat not found',
    );
  });
});
