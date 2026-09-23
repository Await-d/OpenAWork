import { describe, expect, it, vi } from 'vitest';
import { sendSlackFile, type SlackUploadClient } from '../../channels/slack-media.js';
import { SlackChannelService } from '../../channels/slack.js';
import type { ChannelInstance } from '../../channels/types.js';

/** 仅作为可区分的二进制负载：上传客户端是 mock，不会发出任何真实请求。 */
const FILE_BYTES = Buffer.from('slack-file-bytes');

type UploadV2 = SlackUploadClient['files']['uploadV2'];

function makeUploadClient(uploadV2: UploadV2): SlackUploadClient {
  return { files: { uploadV2 } };
}

function makeSlackChannel(): ChannelInstance {
  return {
    id: 'slack-outbound-1',
    type: 'slack',
    name: 'Slack Outbound',
    enabled: true,
    config: { botToken: 'xoxb-test', signingSecret: 'secret', botUserId: 'bot-user-1' },
    createdAt: 1_788_000_000_000,
    updatedAt: 1_788_000_000_000,
  };
}

/**
 * 注入 mock 上传客户端：`sendFile` 只经私有 `client()` 读取 `app.client`，这里
 * 用结构化类型断言绕过 private 限制——不调用 `start()`，不启动 Bolt、不发任何
 * 真实请求。
 */
function injectSlackClient(service: SlackChannelService, client: SlackUploadClient): void {
  const internals = service as unknown as { app: { client: SlackUploadClient } | null };
  internals.app = { client };
}

describe('sendSlackFile', () => {
  it('成功：透传 channel_id / file / filename / initial_comment，并返回 files[0].id', async () => {
    const uploadV2 = vi.fn<UploadV2>(async () => ({ ok: true, files: [{ id: 'F123' }] }));

    const result = await sendSlackFile({
      client: makeUploadClient(uploadV2),
      channelId: 'C123',
      buffer: FILE_BYTES,
      fileName: 'report.pdf',
      text: '月度报告',
    });

    expect(result).toEqual({ messageId: 'F123' });
    expect(uploadV2).toHaveBeenCalledTimes(1);
    expect(uploadV2).toHaveBeenCalledWith({
      channel_id: 'C123',
      file: FILE_BYTES,
      filename: 'report.pdf',
      initial_comment: '月度报告',
    });
    // file 必须是原 Buffer 实例（不复制、不转 base64）。
    expect(uploadV2.mock.calls[0]?.[0].file).toBe(FILE_BYTES);
    expect(uploadV2.mock.calls[0]?.[0].file).toBeInstanceOf(Buffer);
  });

  it('无 text 或 text 为空串：请求里都不出现 initial_comment 键', async () => {
    const uploadV2 = vi.fn<UploadV2>(async () => ({ ok: true, files: [{ id: 'F124' }] }));
    const client = makeUploadClient(uploadV2);

    await sendSlackFile({ client, channelId: 'C123', buffer: FILE_BYTES, fileName: 'plain.txt' });
    await sendSlackFile({
      client,
      channelId: 'C123',
      buffer: FILE_BYTES,
      fileName: 'plain.txt',
      text: '',
    });

    const expected = { channel_id: 'C123', file: FILE_BYTES, filename: 'plain.txt' };
    expect(uploadV2).toHaveBeenNthCalledWith(1, expected);
    expect(uploadV2).toHaveBeenNthCalledWith(2, expected);
    expect(uploadV2.mock.calls[0]?.[0]).not.toHaveProperty('initial_comment');
    expect(uploadV2.mock.calls[1]?.[0]).not.toHaveProperty('initial_comment');
  });

  it('上游 ok:false 时 rejects，错误信息带上游 error', async () => {
    const uploadV2 = vi.fn<UploadV2>(async () => ({ ok: false, error: 'not_in_channel' }));

    await expect(
      sendSlackFile({
        client: makeUploadClient(uploadV2),
        channelId: 'C123',
        buffer: FILE_BYTES,
        fileName: 'report.pdf',
      }),
    ).rejects.toThrow('Slack sendFile failed: not_in_channel');
  });

  it('上游 ok:false 但缺 error 时 rejects，回退 unknown error', async () => {
    const uploadV2 = vi.fn<UploadV2>(async () => ({ ok: false }));

    await expect(
      sendSlackFile({
        client: makeUploadClient(uploadV2),
        channelId: 'C123',
        buffer: FILE_BYTES,
        fileName: 'report.pdf',
      }),
    ).rejects.toThrow('Slack sendFile failed: unknown error');
  });

  it('uploadV2 抛网络异常时直接向上抛（不吞错）', async () => {
    const uploadV2 = vi.fn<UploadV2>(async () => {
      throw new Error('socket hang up');
    });

    await expect(
      sendSlackFile({
        client: makeUploadClient(uploadV2),
        channelId: 'C123',
        buffer: FILE_BYTES,
        fileName: 'report.pdf',
      }),
    ).rejects.toThrow('socket hang up');
  });
});

describe('SlackChannelService.sendFile', () => {
  it('委托 sendSlackFile：channelId 取 chatId，text 作为 initial_comment', async () => {
    const uploadV2 = vi.fn<UploadV2>(async () => ({ ok: true, files: [{ id: 'F-svc' }] }));
    const service = new SlackChannelService(makeSlackChannel(), () => undefined);
    injectSlackClient(service, makeUploadClient(uploadV2));

    const result = await service.sendFile('C-service', {
      buffer: FILE_BYTES,
      fileName: 'svc.bin',
      fileType: 'stream',
      text: '服务层文件',
    });

    expect(result).toEqual({ messageId: 'F-svc' });
    expect(uploadV2).toHaveBeenCalledTimes(1);
    expect(uploadV2).toHaveBeenCalledWith({
      channel_id: 'C-service',
      file: FILE_BYTES,
      filename: 'svc.bin',
      initial_comment: '服务层文件',
    });
  });

  it('未注入 client（未 start）时抛 not started，且不发任何上传', async () => {
    const service = new SlackChannelService(makeSlackChannel(), () => undefined);

    await expect(
      service.sendFile('C-service', { buffer: FILE_BYTES, fileName: 'svc.bin' }),
    ).rejects.toThrow('SlackChannelService is not started');
  });
});
