import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { ChannelEvent, ChannelInstance, ChannelMessage } from '../../channels/types.js';

// 长轮询与媒体下载共用 channelFetch 这一个网络出口：mock 掉它即可在无网络条件
// 下确定性地驱动「getUpdates → getFile → 取回文件 → notify」全链路。
const channelFetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
vi.mock('../../channels/channel-http.js', () => ({
  channelFetch: (url: string, init?: RequestInit): Promise<Response> => channelFetchMock(url, init),
  // 固定退避让 fake timers 的节奏统一（1000ms），便于确定性推进轮询。
  computeChannelRetryDelayMs: () => 1000,
}));

const { TelegramChannelService } = await import('../../channels/telegram.js');
const { resolveTelegramImageCandidate } =
  await import('../../channels/inbound-parsers/telegram.js');

type Service = InstanceType<typeof TelegramChannelService>;
type NotifyMock = Mock<(event: ChannelEvent) => void>;

const BOT_TOKEN = '123:test-token';
const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;
const FILE_BASE = `https://api.telegram.org/file/bot${BOT_TOKEN}`;

/** PNG 魔数（12 字节，满足 sniffImageMediaType 的最小长度要求）。 */
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

/** 无法被魔数识别的 12 字节负载，用于验证 mimeType 回退。 */
const UNKNOWN_BYTES = Buffer.from('not-an-image');

let service: Service | null = null;

function buildInstance(): ChannelInstance {
  return {
    id: 'tg-inbound-media',
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

function binaryResponse(bytes: Buffer, status = 200): Response {
  return new Response(new Uint8Array(bytes), { status });
}

function okGetMeResponse(): Response {
  return jsonResponse({ ok: true, result: { id: 42, is_bot: true } });
}

function okSetMyCommandsResponse(): Response {
  return jsonResponse({ ok: true, result: true });
}

function updatesResponse(updates: unknown[]): Response {
  return jsonResponse({ ok: true, result: updates });
}

function buildMessage(updateId: number, extra: Record<string, unknown>): unknown {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      from: { id: 1, first_name: 'A' },
      chat: { id: 9, type: 'private' },
      date: 1_788_000_000,
      ...extra,
    },
  };
}

/** 无 text 的 photo 消息，两个尺寸（升序，最后一个最大）。 */
function photoUpdate(updateId: number): unknown {
  return buildMessage(updateId, {
    photo: [
      { file_id: 'f1', file_size: 10 },
      { file_id: 'f2', file_size: 1000 },
    ],
  });
}

function documentUpdate(updateId: number, document: Record<string, unknown>): unknown {
  return buildMessage(updateId, { document });
}

function textUpdate(updateId: number, text: string): unknown {
  return buildMessage(updateId, { text });
}

/**
 * 按脚本顺序返回全新 Response（body 只能消费一次，绝不能复用实例），
 * 脚本耗尽后恒定返回空更新批次。
 */
function scriptChannelFetch(steps: ReadonlyArray<() => Response | Promise<Response>>): void {
  const queue = [...steps];
  channelFetchMock.mockImplementation(async () => {
    const step = queue.shift();
    if (!step) {
      return updatesResponse([]);
    }
    return await step();
  });
}

function readCall(index: number): { readonly url: string; readonly init: RequestInit } {
  const call = channelFetchMock.mock.calls[index];
  if (!call) {
    throw new Error(`channelFetch 第 ${index + 1} 次调用不存在`);
  }
  return { url: call[0], init: call[1] ?? {} };
}

function calledUrls(): string[] {
  return channelFetchMock.mock.calls.map(([url]) => url);
}

function collectMessages(notify: NotifyMock): ChannelMessage[] {
  return notify.mock.calls
    .map(([event]) => event)
    .filter(
      (event): event is Extract<ChannelEvent, { type: 'message' }> => event.type === 'message',
    )
    .map((event) => event.message);
}

/**
 * 派发是 fire-and-forget（图片下载不在轮询拍内完成），断言前必须显式排空微任务：
 * `advanceTimersByTimeAsync(0)` 既不推进 1000ms 的下一拍，又能让已 resolve 的
 * mock 响应链持续前进。不依赖挂钟等待，避免 flaky。
 */
async function flushAsyncWork(rounds = 30): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
  }
}

async function startService(notify: NotifyMock): Promise<Service> {
  const started = new TelegramChannelService(buildInstance(), notify);
  service = started;
  await started.start();
  return started;
}

beforeEach(() => {
  vi.useFakeTimers();
  channelFetchMock.mockReset();
  // 失败降级路径会 warn，静音以免污染输出；用例本身不依赖 warn 文案。
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(async () => {
  if (service) {
    await service.stop();
    service = null;
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Telegram 入站图片接线', () => {
  it('resolveTelegramImageCandidate：photo 取最大尺寸并透出 file_size（零网络短路依据）', () => {
    const candidate = resolveTelegramImageCandidate({
      message: {
        message_id: 1,
        chat: { id: 9, type: 'private' },
        photo: [
          { file_id: 'small', file_size: 10 },
          { file_id: 'big', file_size: 5000 },
        ],
      },
    });

    expect(candidate).toEqual({ fileId: 'big', fileSize: 5000 });
  });

  it('图片消息全链路：取最大尺寸 → getFile → 下载 → base64 附件随消息投递', async () => {
    scriptChannelFetch([
      okGetMeResponse,
      okSetMyCommandsResponse,
      () => updatesResponse([photoUpdate(100)]),
      () => jsonResponse({ ok: true, result: { file_path: 'photos/a.png', file_size: 1000 } }),
      () => binaryResponse(PNG_BYTES),
    ]);
    const notify = vi.fn<(event: ChannelEvent) => void>();
    await startService(notify);

    await vi.advanceTimersByTimeAsync(1000);
    await flushAsyncWork();

    const messages = collectMessages(notify);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: '100',
      chatId: '9',
      senderId: '1',
      content: '[User sent an image]',
      images: [
        {
          base64: PNG_BYTES.toString('base64'),
          mediaType: 'image/png',
        },
      ],
    });

    // 用的是最大尺寸的 file_id 'f2'；文件按 fileBaseUrl 字面拼接下载。
    expect(readCall(3).url).toBe(`${API_BASE}/getFile?file_id=f2`);
    expect(readCall(4).url).toBe(`${FILE_BASE}/photos/a.png`);
  });

  it('下载失败降级：getFile 返回 ok:false 时仍投递占位符消息，但不带 images 键', async () => {
    scriptChannelFetch([
      okGetMeResponse,
      okSetMyCommandsResponse,
      () => updatesResponse([photoUpdate(101)]),
      () => jsonResponse({ ok: false, description: 'file is too big' }),
    ]);
    const notify = vi.fn<(event: ChannelEvent) => void>();
    await startService(notify);

    await vi.advanceTimersByTimeAsync(1000);
    await flushAsyncWork();

    const messages = collectMessages(notify);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe('[User sent an image]');
    expect(messages[0]).not.toHaveProperty('images');
    // 确实走了一次 getFile 尝试，失败后不再发起下载。
    expect(calledUrls().some((url) => url.includes('/getFile'))).toBe(true);
    expect(calledUrls().some((url) => url.includes('/file/bot'))).toBe(false);
  });

  it('文本消息零回归：content 保持原文、无 images 键，且不发起任何媒体请求', async () => {
    scriptChannelFetch([
      okGetMeResponse,
      okSetMyCommandsResponse,
      () => updatesResponse([textUpdate(102, 'hello')]),
    ]);
    const notify = vi.fn<(event: ChannelEvent) => void>();
    await startService(notify);

    await vi.advanceTimersByTimeAsync(1000);
    await flushAsyncWork();

    const messages = collectMessages(notify);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ id: '102', chatId: '9', content: 'hello' });
    expect(messages[0]).not.toHaveProperty('images');
    const urls = calledUrls();
    expect(urls.some((url) => url.includes('/getFile'))).toBe(false);
    expect(urls.some((url) => url.includes('/file/bot'))).toBe(false);
  });

  it('fire-and-forget 安全：下载抛网络异常时不产生 unhandled rejection，消息仍投递', async () => {
    scriptChannelFetch([
      okGetMeResponse,
      okSetMyCommandsResponse,
      () => updatesResponse([photoUpdate(103)]),
      () => Promise.reject(new Error('socket hang up')),
    ]);
    const notify = vi.fn<(event: ChannelEvent) => void>();
    await startService(notify);

    await vi.advanceTimersByTimeAsync(1000);
    await flushAsyncWork();

    // 网络异常被 telegram-media 内部兜底为「未取回」，消息按占位符投递。
    const messages = collectMessages(notify);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe('[User sent an image]');
    expect(messages[0]).not.toHaveProperty('images');
    expect(console.warn).toHaveBeenCalledWith(
      '[telegram] 入站图片下载失败',
      expect.objectContaining({ fileId: 'f2', error: 'socket hang up' }),
    );
    // 派发层没有逃逸出未捕获异常。
    expect(console.warn).not.toHaveBeenCalledWith(
      '[telegram] update dispatch failed',
      expect.anything(),
    );
  });

  it('无文本的图片 document：file_id 可下载，file_name/mime_type 透传到附件', async () => {
    scriptChannelFetch([
      okGetMeResponse,
      okSetMyCommandsResponse,
      () =>
        updatesResponse([
          documentUpdate(104, {
            file_id: 'f3',
            file_name: 'cat.heic',
            mime_type: 'image/heic',
            file_size: 2000,
          }),
        ]),
      () => jsonResponse({ ok: true, result: { file_path: 'docs/cat.heic' } }),
      () => binaryResponse(UNKNOWN_BYTES),
    ]);
    const notify = vi.fn<(event: ChannelEvent) => void>();
    await startService(notify);

    await vi.advanceTimersByTimeAsync(1000);
    await flushAsyncWork();

    const messages = collectMessages(notify);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      content: '[User sent an image]',
      images: [
        {
          base64: UNKNOWN_BYTES.toString('base64'),
          mediaType: 'image/heic',
          fileName: 'cat.heic',
        },
      ],
    });
    expect(readCall(3).url).toBe(`${API_BASE}/getFile?file_id=f3`);
    expect(readCall(4).url).toBe(`${FILE_BASE}/docs/cat.heic`);
  });

  it('无文本的非图片 document：不派发消息，也不发起媒体请求', async () => {
    scriptChannelFetch([
      okGetMeResponse,
      okSetMyCommandsResponse,
      () =>
        updatesResponse([
          documentUpdate(105, {
            file_id: 'f4',
            file_name: 'report.pdf',
            mime_type: 'application/pdf',
            file_size: 2000,
          }),
        ]),
    ]);
    const notify = vi.fn<(event: ChannelEvent) => void>();
    await startService(notify);

    await vi.advanceTimersByTimeAsync(1000);
    await flushAsyncWork();

    expect(collectMessages(notify)).toHaveLength(0);
    expect(calledUrls().some((url) => url.includes('/getFile'))).toBe(false);
  });

  it('photo 已知大小超限：零网络短路（不发 getFile/下载），消息仍按占位符投递', async () => {
    scriptChannelFetch([
      okGetMeResponse,
      okSetMyCommandsResponse,
      () =>
        updatesResponse([
          buildMessage(106, {
            photo: [{ file_id: 'huge', file_size: 5 * 1024 * 1024 }],
          }),
        ]),
    ]);
    const notify = vi.fn<(event: ChannelEvent) => void>();
    await startService(notify);

    await vi.advanceTimersByTimeAsync(1000);
    await flushAsyncWork();

    const messages = collectMessages(notify);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe('[User sent an image]');
    expect(messages[0]).not.toHaveProperty('images');
    expect(calledUrls().some((url) => url.includes('/getFile'))).toBe(false);
    expect(calledUrls().some((url) => url.includes('/file/bot'))).toBe(false);
  });
});
