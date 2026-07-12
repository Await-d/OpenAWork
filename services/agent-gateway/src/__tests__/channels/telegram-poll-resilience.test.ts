import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelEvent, ChannelInstance } from '../../channels/types.js';

// Mock the shared channel HTTP helpers so the long-poll loop is driven
// deterministically without real network access.
const channelFetchMock = vi.fn();
vi.mock('../../channels/channel-http.js', () => ({
  channelFetch: (...args: unknown[]) => channelFetchMock(...args),
  // Fixed backoff keeps the fake-timer cadence uniform (1000ms) regardless of
  // failure count, so the test can advance the loop predictably.
  computeChannelRetryDelayMs: () => 1000,
}));

const { TelegramChannelService } = await import('../../channels/telegram.js');

function buildInstance(replyLanguage: ChannelInstance['replyLanguage'] = 'zh-CN'): ChannelInstance {
  return {
    id: 'tg-1',
    type: 'telegram',
    name: 'tg',
    enabled: true,
    config: { token: 'bot-token' },
    replyLanguage,
    createdAt: 0,
    updatedAt: 0,
  };
}

function okUpdatesResponse(updates: unknown[]): Response {
  return new Response(JSON.stringify({ ok: true, result: updates }), { status: 200 });
}

function okGetMeResponse(): Response {
  return new Response(JSON.stringify({ ok: true, result: { id: 42, is_bot: true } }), {
    status: 200,
  });
}

function okSetMyCommandsResponse(): Response {
  return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
}

function messageUpdate(updateId: number): unknown {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      from: { id: 1, first_name: 'A' },
      chat: { id: 9, type: 'private' },
      text: 'hi',
      date: 1,
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  channelFetchMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('TelegramChannelService 长轮询循环健壮性', () => {
  it('消息回调抛错不会中断后续轮询，也不会误触发失败退避', async () => {
    // 第一拍返回一条消息（回调会抛错），之后返回空批次。
    channelFetchMock
      .mockResolvedValueOnce(okGetMeResponse())
      .mockResolvedValueOnce(okSetMyCommandsResponse())
      .mockResolvedValueOnce(okUpdatesResponse([messageUpdate(100)]))
      .mockResolvedValue(okUpdatesResponse([]));

    let messageEvents = 0;
    const notify = vi.fn((event: ChannelEvent) => {
      if (event.type === 'message') {
        messageEvents += 1;
        throw new Error('subscriber boom');
      }
    });

    const service = new TelegramChannelService(buildInstance(), notify);
    await service.start();

    // 第一拍：delay=1000（failureCount=0）。
    await vi.advanceTimersByTimeAsync(1000);
    expect(channelFetchMock).toHaveBeenCalledTimes(3);
    expect(messageEvents).toBe(1);

    // 若回调抛错误触发退避，本应仍是 1000（mock 固定），但更重要的是循环必须继续。
    // 第二拍：仍按 1000 再次轮询，证明 notify 抛错没有杀死循环。
    await vi.advanceTimersByTimeAsync(1000);
    expect(channelFetchMock).toHaveBeenCalledTimes(4);

    // 没有 error 事件被派发（消息回调抛错是订阅者问题，不是网络故障）。
    expect(notify.mock.calls.every(([event]) => event.type !== 'error')).toBe(true);

    await service.stop();
    const callsAfterStop = channelFetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(channelFetchMock).toHaveBeenCalledTimes(callsAfterStop);
  });

  it('错误回调抛错不会让轮询循环停摆（finally 重排兜底）', async () => {
    // 始终返回 HTTP 500 → 进入 catch → error 回调抛错。
    channelFetchMock
      .mockResolvedValueOnce(okGetMeResponse())
      .mockResolvedValueOnce(new Response('ok', { status: 500 }))
      .mockResolvedValue(new Response('upstream down', { status: 500 }));

    const notify = vi.fn((event: ChannelEvent) => {
      if (event.type === 'error') {
        throw new Error('error-subscriber boom');
      }
    });

    const service = new TelegramChannelService(buildInstance(), notify);
    await service.start();

    await vi.advanceTimersByTimeAsync(1000);
    expect(channelFetchMock).toHaveBeenCalledTimes(3);

    // 即便 error 回调抛错，finally 也必须重排下一拍。
    await vi.advanceTimersByTimeAsync(1000);
    expect(channelFetchMock).toHaveBeenCalledTimes(4);

    await service.stop();
    const callsAfterStop = channelFetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(channelFetchMock).toHaveBeenCalledTimes(callsAfterStop);
  });

  it('stop() 后不再发起新的长轮询', async () => {
    channelFetchMock
      .mockResolvedValueOnce(okGetMeResponse())
      .mockResolvedValueOnce(okSetMyCommandsResponse())
      .mockResolvedValue(okUpdatesResponse([]));
    const notify = vi.fn();
    const service = new TelegramChannelService(buildInstance(), notify);
    await service.start();

    await vi.advanceTimersByTimeAsync(1000);
    expect(channelFetchMock).toHaveBeenCalledTimes(3);

    await service.stop();
    await vi.advanceTimersByTimeAsync(10000);
    expect(channelFetchMock).toHaveBeenCalledTimes(3);
  });

  it('启动时先校验 bot token，避免保存后显示已运行但后台首次轮询才失败', async () => {
    channelFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: false, description: 'Unauthorized' }), { status: 401 }),
    );

    const service = new TelegramChannelService(buildInstance(), vi.fn());

    await expect(service.start()).rejects.toThrow('Telegram getMe failed: HTTP 401');
    expect(service.isRunning()).toBe(false);
    expect(channelFetchMock).toHaveBeenCalledTimes(1);
  });

  it('启动时会尽力注册 Telegram 原生命令菜单，但失败不会阻断启动', async () => {
    channelFetchMock
      .mockResolvedValueOnce(okGetMeResponse())
      .mockRejectedValueOnce(new Error('setMyCommands unavailable'))
      .mockResolvedValue(okUpdatesResponse([]));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const service = new TelegramChannelService(buildInstance(), vi.fn());

    await service.start();

    expect(service.isRunning()).toBe(true);
    expect(channelFetchMock.mock.calls[1]?.[0]).toContain('/setMyCommands');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('setMyCommands failed: setMyCommands unavailable'),
    );

    await service.stop();
  });

  it('英文回复语言下注册 Telegram 原生命令菜单时使用英文描述', async () => {
    channelFetchMock
      .mockResolvedValueOnce(okGetMeResponse())
      .mockResolvedValueOnce(okSetMyCommandsResponse())
      .mockResolvedValue(okUpdatesResponse([]));

    const service = new TelegramChannelService(buildInstance('en-US'), vi.fn());
    await service.start();

    const setMyCommandsOptions = channelFetchMock.mock.calls[1]?.[1];
    if (
      !setMyCommandsOptions ||
      typeof setMyCommandsOptions !== 'object' ||
      !('body' in setMyCommandsOptions)
    ) {
      throw new Error('Expected setMyCommands request options');
    }
    const body = String(setMyCommandsOptions.body);
    expect(body).toContain('"description":"Show commands"');
    expect(body).toContain('"description":"New session"');

    await service.stop();
  });
});
