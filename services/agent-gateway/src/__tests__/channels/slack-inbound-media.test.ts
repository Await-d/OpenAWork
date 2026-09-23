import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelInstance, ChannelMessage } from '../../channels/types.js';

// channelFetch 是 slack-media 唯一的网络出口：mock 掉它即可在无网络条件下
// 覆盖入站下载的全部分支。
const channelFetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
vi.mock('../../channels/channel-http.js', () => ({
  channelFetch: (url: string, init?: RequestInit): Promise<Response> => channelFetchMock(url, init),
}));

const {
  SLACK_INBOUND_IMAGE_MAX_BYTES,
  SLACK_INBOUND_IMAGE_MAX_COUNT,
  attachSlackInboundImages,
  downloadSlackInboundImage,
  readSlackImageFiles,
} = await import('../../channels/slack-media.js');
const { parseSlackInboundMessage } = await import('../../channels/inbound-parsers/slack.js');

/** PNG 魔数（12 字节，满足 sniffImageMediaType 的最小长度要求）。 */
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

const DOWNLOAD_URL = 'https://files.slack.com/files-pri/T1-F1/download/cat.png';
const PRIVATE_URL = 'https://files.slack.com/files-pri/T1-F1/cat.png';

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

/** Slack 文件对象（字段名对齐 Slack Web API 的 file 结构）。 */
function slackFile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'F1',
    name: 'cat.png',
    mimetype: 'image/png',
    filetype: 'png',
    size: 2048,
    url_private_download: DOWNLOAD_URL,
    url_private: PRIVATE_URL,
    ...overrides,
  };
}

function makeChannel(
  type: ChannelInstance['type'],
  config: Record<string, string> = {},
): ChannelInstance {
  return {
    id: `${type}-channel`,
    type,
    name: `${type}-channel`,
    enabled: true,
    config,
    createdAt: 0,
    updatedAt: 0,
  };
}

function makeMessage(raw: unknown, overrides: Partial<ChannelMessage> = {}): ChannelMessage {
  return {
    id: 'm-slack',
    senderId: 'U123',
    senderName: 'Slack User',
    chatId: 'D123456',
    content: '[User sent an image]',
    timestamp: 1_788_000_000_000,
    raw,
    ...overrides,
  };
}

beforeEach(() => {
  channelFetchMock.mockReset();
  // 失败路径会 warn，测试里静音以免污染输出；用例本身不依赖 warn 内容。
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('readSlackImageFiles', () => {
  it('图片文件映射为引用：优先 url_private_download，并携带 mimeType / fileName / fileSize', () => {
    const refs = readSlackImageFiles({ files: [slackFile()] }, SLACK_INBOUND_IMAGE_MAX_COUNT);

    expect(refs).toEqual([
      {
        url: DOWNLOAD_URL,
        mimeType: 'image/png',
        fileName: 'cat.png',
        fileSize: 2048,
      },
    ]);
  });

  it('非图片文件（application/pdf）被跳过', () => {
    const refs = readSlackImageFiles(
      { files: [slackFile({ mimetype: 'application/pdf', filetype: 'pdf' })] },
      SLACK_INBOUND_IMAGE_MAX_COUNT,
    );

    expect(refs).toEqual([]);
  });

  it('url_private_download 缺失时回退 url_private', () => {
    const refs = readSlackImageFiles(
      { files: [slackFile({ url_private_download: undefined })] },
      SLACK_INBOUND_IMAGE_MAX_COUNT,
    );

    expect(refs[0]?.url).toBe(PRIVATE_URL);
  });

  it('mimetype 缺失时按 filetype 映射 MIME', () => {
    const refs = readSlackImageFiles(
      { files: [slackFile({ mimetype: undefined, filetype: 'jpg' })] },
      SLACK_INBOUND_IMAGE_MAX_COUNT,
    );

    expect(refs[0]?.mimeType).toBe('image/jpeg');
  });

  it('超过上限时只取前 4 张', () => {
    const files = Array.from({ length: 5 }, (_, index) =>
      slackFile({
        id: `F${index + 1}`,
        url_private_download: `https://files.slack.com/download/F${index + 1}`,
      }),
    );

    const refs = readSlackImageFiles({ files }, SLACK_INBOUND_IMAGE_MAX_COUNT);

    expect(refs).toHaveLength(SLACK_INBOUND_IMAGE_MAX_COUNT);
    expect(refs.map((ref) => ref.url)).toEqual([
      'https://files.slack.com/download/F1',
      'https://files.slack.com/download/F2',
      'https://files.slack.com/download/F3',
      'https://files.slack.com/download/F4',
    ]);
  });
});

describe('downloadSlackInboundImage', () => {
  it('带 Bearer 头下载并转 base64，按魔数判定 mediaType', async () => {
    channelFetchMock.mockResolvedValueOnce(binaryResponse(PNG_BYTES));

    const attachment = await downloadSlackInboundImage({
      token: 'xoxb-test',
      url: DOWNLOAD_URL,
      mimeType: 'image/png',
      fileName: 'cat.png',
    });

    expect(attachment).toEqual({
      base64: PNG_BYTES.toString('base64'),
      mediaType: 'image/png',
      fileName: 'cat.png',
    });
    expect(channelFetchMock).toHaveBeenCalledTimes(1);

    const call = readCall(0);
    expect(call.url).toBe(DOWNLOAD_URL);
    expect(call.init.headers).toEqual({ Authorization: 'Bearer xoxb-test' });
    expect(call.init).toMatchObject({ timeoutMs: 30_000 });
  });

  it('入参 fileSize 超限时直接返回 null，且零网络请求', async () => {
    const attachment = await downloadSlackInboundImage({
      token: 'xoxb-test',
      url: DOWNLOAD_URL,
      fileSize: SLACK_INBOUND_IMAGE_MAX_BYTES + 1,
    });

    expect(attachment).toBeNull();
    expect(channelFetchMock).not.toHaveBeenCalled();
  });

  it('HTTP 401 时返回 null 并提示 files:read scope', async () => {
    channelFetchMock.mockResolvedValueOnce(new Response('unauthorized', { status: 401 }));

    const attachment = await downloadSlackInboundImage({
      token: 'xoxb-test',
      url: DOWNLOAD_URL,
    });

    expect(attachment).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      '[slack] 入站图片下载失败',
      expect.objectContaining({
        reason: 'download-http-error',
        status: 401,
        hint: '请确认 bot token 具备 files:read scope',
      }),
    );
  });

  it('魔数与 mimeType 都无法确定 mediaType 时返回 null（不猜测）', async () => {
    channelFetchMock.mockResolvedValueOnce(binaryResponse(Buffer.from('not-an-image')));

    const attachment = await downloadSlackInboundImage({
      token: 'xoxb-test',
      url: DOWNLOAD_URL,
    });

    expect(attachment).toBeNull();
  });

  it('网络异常不向调用方抛出，而是 warn 后返回 null', async () => {
    channelFetchMock.mockRejectedValueOnce(new Error('socket hang up'));

    await expect(
      downloadSlackInboundImage({ token: 'xoxb-test', url: DOWNLOAD_URL }),
    ).resolves.toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      '[slack] 入站图片下载失败',
      expect.objectContaining({ url: DOWNLOAD_URL, error: 'socket hang up' }),
    );
  });
});

describe('attachSlackInboundImages', () => {
  it('token 为空时原样返回，且零网络请求', async () => {
    const message = makeMessage({ files: [slackFile()] });

    const result = await attachSlackInboundImages({ token: '   ', message, raw: {} });

    expect(result).toBe(message);
    expect(channelFetchMock).not.toHaveBeenCalled();
  });

  it('多张图中单张下载失败时，其余仍产出 images', async () => {
    channelFetchMock
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      .mockResolvedValueOnce(binaryResponse(PNG_BYTES));

    const raw = {
      files: [
        slackFile({ id: 'F1', url_private_download: 'https://files.slack.com/download/F1' }),
        slackFile({ id: 'F2', url_private_download: 'https://files.slack.com/download/F2' }),
      ],
    };
    const message = makeMessage(raw);

    const result = await attachSlackInboundImages({ token: 'xoxb-test', message, raw });

    expect(result).not.toBe(message);
    expect(result.images).toEqual([
      {
        base64: PNG_BYTES.toString('base64'),
        mediaType: 'image/png',
        fileName: 'cat.png',
      },
    ]);
    expect(channelFetchMock).toHaveBeenCalledTimes(2);
  });

  it('无图片文件时原样返回同一对象', async () => {
    const raw = { files: [slackFile({ mimetype: 'application/pdf', filetype: 'pdf' })] };
    const message = makeMessage(raw);

    const result = await attachSlackInboundImages({ token: 'xoxb-test', message, raw });

    expect(result).toBe(message);
    expect(channelFetchMock).not.toHaveBeenCalled();
  });

  it('优先读取 message.raw（parser 放入的 Bolt 消息），raw 参数仅作回退', async () => {
    channelFetchMock.mockResolvedValueOnce(binaryResponse(PNG_BYTES));
    const message = makeMessage({
      files: [slackFile({ url_private_download: 'https://files.slack.com/download/from-raw' })],
    });

    await attachSlackInboundImages({ token: 'xoxb-test', message, raw: { files: [] } });

    expect(channelFetchMock).toHaveBeenCalledTimes(1);
    expect(readCall(0).url).toBe('https://files.slack.com/download/from-raw');
  });
});

describe('Slack 入站图片 parser', () => {
  it('无文本 + 图片文件 → 返回消息并使用占位文本（不产出 images）', () => {
    const parsed = parseSlackInboundMessage({
      ts: '1788000000.001',
      channel: 'D123456',
      channel_type: 'im',
      user: 'U123',
      username: 'Slack User',
      files: [slackFile()],
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.content).toBe('[User sent an image]');
    expect(parsed?.images).toBeUndefined();
  });

  it('无文本 + 非图片文件（pdf）→ 仍返回 null（回归）', () => {
    const parsed = parseSlackInboundMessage({
      ts: '1788000000.002',
      channel: 'D123456',
      channel_type: 'im',
      user: 'U123',
      files: [slackFile({ mimetype: 'application/pdf', filetype: 'pdf' })],
    });

    expect(parsed).toBeNull();
  });

  it('文本消息回归：保留原文，且不产出 images', () => {
    const parsed = parseSlackInboundMessage({
      ts: '1788000000.003',
      channel: 'D123456',
      channel_type: 'im',
      user: 'U123',
      username: 'Slack User',
      text: '看看这张图',
      files: [slackFile()],
    });

    expect(parsed).toMatchObject({
      chatId: 'D123456',
      senderId: 'U123',
      content: '看看这张图',
    });
    expect(parsed?.images).toBeUndefined();
  });

  it('群频道要求 @ 机器人时，纯图片消息未提及机器人仍被丢弃', () => {
    const parsed = parseSlackInboundMessage(
      {
        ts: '1788000000.004',
        channel: 'C123456',
        channel_type: 'channel',
        user: 'U123',
        files: [slackFile()],
      },
      { channel: makeChannel('slack', { requireMentionInGroup: 'true' }), botId: 'U-BOT-1' },
    );

    expect(parsed).toBeNull();
  });

  it('群频道 @ 机器人 + 纯图片 → 剥掉提及后使用占位文本', () => {
    const parsed = parseSlackInboundMessage(
      {
        ts: '1788000000.005',
        channel: 'C123456',
        channel_type: 'channel',
        user: 'U123',
        text: '<@U-BOT-1>',
        files: [slackFile()],
      },
      { channel: makeChannel('slack', { requireMentionInGroup: 'true' }), botId: 'U-BOT-1' },
    );

    expect(parsed?.content).toBe('[User sent an image]');
  });
});
