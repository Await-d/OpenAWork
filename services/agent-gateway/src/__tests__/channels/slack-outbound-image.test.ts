import { describe, expect, it, vi } from 'vitest';
import { sendSlackFile, type SlackUploadClient } from '../../channels/slack-media.js';
import { SlackChannelService } from '../../channels/slack.js';
import type { ChannelInstance } from '../../channels/types.js';

/** 仅作为可区分的二进制负载：上传客户端是 mock，不会发出任何真实请求。 */
const IMAGE_BYTES = Buffer.from('slack-image-bytes');

type UploadV2 = SlackUploadClient['files']['uploadV2'];

function makeUploadClient(uploadV2: UploadV2): SlackUploadClient {
  return { files: { uploadV2 } };
}

function makeSlackChannel(): ChannelInstance {
  return {
    id: 'slack-outbound-image-1',
    type: 'slack',
    name: 'Slack Outbound Image',
    enabled: true,
    config: { botToken: 'xoxb-test', signingSecret: 'secret', botUserId: 'bot-user-1' },
    createdAt: 1_788_000_000_000,
    updatedAt: 1_788_000_000_000,
  };
}

/**
 * 注入 mock 上传客户端：`sendImage` / `replyImage` 只经私有 `client()` 读取
 * `app.client`，这里用结构化类型断言绕过 private 限制——不调用 `start()`，
 * 不启动 Bolt、不发任何真实请求。
 */
function injectSlackClient(service: SlackChannelService, client: SlackUploadClient): void {
  const internals = service as unknown as { app: { client: SlackUploadClient } | null };
  internals.app = { client };
}

function makeSlackService(uploadV2: UploadV2): SlackChannelService {
  const service = new SlackChannelService(makeSlackChannel(), () => undefined);
  injectSlackClient(service, makeUploadClient(uploadV2));
  return service;
}

describe('SlackChannelService.sendImage', () => {
  it('默认文件名 image.png，text 作 initial_comment，请求不带 thread_ts', async () => {
    const uploadV2 = vi.fn<UploadV2>(async () => ({ ok: true, files: [{ id: 'F-img-1' }] }));
    const service = makeSlackService(uploadV2);

    const result = await service.sendImage('C-image', {
      buffer: IMAGE_BYTES,
      text: '看图',
      sourceUrl: 'https://example.test/ignored.png',
    });

    expect(result).toEqual({ messageId: 'F-img-1' });
    expect(uploadV2).toHaveBeenCalledTimes(1);
    expect(uploadV2).toHaveBeenCalledWith({
      channel_id: 'C-image',
      file: IMAGE_BYTES,
      filename: 'image.png',
      initial_comment: '看图',
    });
    // file 必须是原 Buffer 实例（不复制、不转 base64），且顶层消息不挂线程。
    expect(uploadV2.mock.calls[0]?.[0].file).toBe(IMAGE_BYTES);
    expect(uploadV2.mock.calls[0]?.[0]).not.toHaveProperty('thread_ts');
  });

  it('自定义文件名原样透传；无 text 时请求里不出现 initial_comment', async () => {
    const uploadV2 = vi.fn<UploadV2>(async () => ({ ok: true, files: [{ id: 'F-img-2' }] }));
    const service = makeSlackService(uploadV2);

    await service.sendImage('C-image', { buffer: IMAGE_BYTES, fileName: 'cat.png' });

    expect(uploadV2).toHaveBeenCalledTimes(1);
    expect(uploadV2).toHaveBeenCalledWith({
      channel_id: 'C-image',
      file: IMAGE_BYTES,
      filename: 'cat.png',
    });
    expect(uploadV2.mock.calls[0]?.[0]).not.toHaveProperty('initial_comment');
  });
});

describe('SlackChannelService.replyImage', () => {
  it('解析 <channelId>:<ts>：channel_id 取频道，ts 作为 thread_ts 挂线程', async () => {
    const uploadV2 = vi.fn<UploadV2>(async () => ({ ok: true, files: [{ id: 'F-img-reply' }] }));
    const service = makeSlackService(uploadV2);

    const result = await service.replyImage('C123:1700000000.000100', {
      buffer: IMAGE_BYTES,
      fileName: 'reply.png',
      text: '线程回复图',
    });

    expect(result).toEqual({ messageId: 'F-img-reply' });
    expect(uploadV2).toHaveBeenCalledTimes(1);
    expect(uploadV2).toHaveBeenCalledWith({
      channel_id: 'C123',
      file: IMAGE_BYTES,
      filename: 'reply.png',
      initial_comment: '线程回复图',
      thread_ts: '1700000000.000100',
    });
    const args = uploadV2.mock.calls[0]?.[0];
    expect(args?.channel_id).toBe('C123');
    expect(args?.thread_ts).toBe('1700000000.000100');
  });

  it.each(['bad-ref', 'C123:'])(
    '引用格式非法（%s）时 rejects，且不发任何上传',
    async (reference) => {
      const uploadV2 = vi.fn<UploadV2>(async () => ({ ok: true, files: [{ id: 'never' }] }));
      const service = makeSlackService(uploadV2);

      await expect(service.replyImage(reference, { buffer: IMAGE_BYTES })).rejects.toThrow(
        'Slack image reply requires "<channelId>:<ts>" reference',
      );
      expect(uploadV2).not.toHaveBeenCalled();
    },
  );
});

describe('sendSlackFile threadTs', () => {
  it('threadTs 非空时透传为 thread_ts（契约回归）', async () => {
    const uploadV2 = vi.fn<UploadV2>(async () => ({ ok: true, files: [{ id: 'F-thread' }] }));

    const result = await sendSlackFile({
      client: makeUploadClient(uploadV2),
      channelId: 'C123',
      buffer: IMAGE_BYTES,
      fileName: 'thread.png',
      text: '挂线程',
      threadTs: '1700000000.000200',
    });

    expect(result).toEqual({ messageId: 'F-thread' });
    expect(uploadV2).toHaveBeenCalledWith({
      channel_id: 'C123',
      file: IMAGE_BYTES,
      filename: 'thread.png',
      initial_comment: '挂线程',
      thread_ts: '1700000000.000200',
    });
  });

  it('threadTs 缺省或空串时请求里都不出现 thread_ts 键', async () => {
    const uploadV2 = vi.fn<UploadV2>(async () => ({ ok: true, files: [{ id: 'F-top' }] }));
    const client = makeUploadClient(uploadV2);

    await sendSlackFile({ client, channelId: 'C123', buffer: IMAGE_BYTES, fileName: 'top.png' });
    await sendSlackFile({
      client,
      channelId: 'C123',
      buffer: IMAGE_BYTES,
      fileName: 'top.png',
      threadTs: '',
    });

    const expected = { channel_id: 'C123', file: IMAGE_BYTES, filename: 'top.png' };
    expect(uploadV2).toHaveBeenNthCalledWith(1, expected);
    expect(uploadV2).toHaveBeenNthCalledWith(2, expected);
    expect(uploadV2.mock.calls[0]?.[0]).not.toHaveProperty('thread_ts');
    expect(uploadV2.mock.calls[1]?.[0]).not.toHaveProperty('thread_ts');
  });
});
