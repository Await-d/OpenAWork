import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listBuiltinChannelCommands } from '../../channels/channel-command-experience.js';
import { SlackChannelService } from '../../channels/slack.js';
import type { ChannelEvent, ChannelInstance } from '../../channels/types.js';

type CapturedCommandPayload = {
  channel_id: string;
  user_id: string;
  text: string;
};

type CapturedCommandHandler = (params: {
  command: CapturedCommandPayload;
  ack: () => Promise<void>;
  say: (text: string) => Promise<{ ts: string; channel: string }>;
}) => Promise<void> | void;

const boltMock = vi.hoisted(() => {
  const commandHandlers = new Map<string, CapturedCommandHandler>();
  const messagePatterns: Array<string | RegExp> = [];
  const say = vi.fn(async () => ({ ts: 'ts-say', channel: 'channel-say' }));
  const start = vi.fn(async (_port?: number) => ({ ok: true }));
  const stop = vi.fn(async () => undefined);

  return { commandHandlers, messagePatterns, say, start, stop };
});

vi.mock('@slack/bolt', () => ({
  App: class MockSlackApp {
    readonly client = {
      auth: { test: vi.fn(async () => ({ user_id: 'bot-user-1' })) },
      chat: {
        postMessage: vi.fn(async () => ({ ts: 'ts-post' })),
        update: vi.fn(async () => ({ ok: true })),
      },
      conversations: {
        list: vi.fn(async () => ({ channels: [] })),
        history: vi.fn(async () => ({ messages: [] })),
      },
    };

    command(cmd: string, handler: CapturedCommandHandler): void {
      boltMock.commandHandlers.set(cmd, handler);
    }

    message(pattern: string | RegExp, _handler: unknown): void {
      boltMock.messagePatterns.push(pattern);
    }

    start(port?: number): Promise<unknown> {
      return boltMock.start(port);
    }

    stop(): Promise<void> {
      return boltMock.stop();
    }
  },
}));

function makeSlackChannel(): ChannelInstance {
  return {
    id: 'slack-command-1',
    type: 'slack',
    name: 'Slack Command',
    enabled: true,
    config: { botToken: 'xoxb-test', signingSecret: 'secret', botUserId: 'bot-user-1' },
    features: { autoReply: true, streamingReply: false, autoStart: false },
    ownerUserId: 'u-slack',
    createdAt: 1_788_000_000_000,
    updatedAt: 1_788_000_000_000,
  };
}

beforeEach(() => {
  boltMock.commandHandlers.clear();
  boltMock.messagePatterns.length = 0;
  boltMock.say.mockClear();
  boltMock.start.mockClear();
  boltMock.stop.mockClear();
});

describe('SlackChannelService 斜杠命令', () => {
  it('仅注册共享内置命令集，旧版 plan/approve/deny/history 不再出现', async () => {
    const service = new SlackChannelService(makeSlackChannel(), () => undefined);
    await service.start();

    const expected = listBuiltinChannelCommands()
      .map((command) => command.canonicalTrigger)
      .sort();
    expect([...boltMock.commandHandlers.keys()].sort()).toEqual(expected);

    for (const legacy of ['/plan', '/approve', '/deny', '/history']) {
      expect(boltMock.commandHandlers.has(legacy)).toBe(false);
    }

    await service.stop();
  });

  it('带参数命令合成标准 ChannelMessage 后只走 notify，ack 在前且不再 say', async () => {
    const calls: string[] = [];
    const events: ChannelEvent[] = [];
    const service = new SlackChannelService(makeSlackChannel(), (event) => {
      calls.push('notify');
      events.push(event);
    });
    await service.start();

    const handler = boltMock.commandHandlers.get('/init');
    if (!handler) throw new Error('未注册 /init 斜杠命令处理器');

    const payload: CapturedCommandPayload = {
      channel_id: 'C-init-1',
      user_id: 'U-init-1',
      text: '  foo bar  ',
    };
    const ack = vi.fn(async () => {
      calls.push('ack');
    });
    await handler({ ack, say: boltMock.say, command: payload });

    expect(calls).toEqual(['ack', 'notify']);
    expect(ack).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);

    const event = events[0];
    if (event?.type !== 'message') throw new Error('期望收到 message 类型事件');
    expect(event.pluginId).toBe('slack-command-1');
    expect(event.message.id).toBeTruthy();
    expect(event.message.timestamp).toBeGreaterThan(0);
    expect(event.message).toMatchObject({
      senderId: 'U-init-1',
      senderName: 'U-init-1',
      chatId: 'C-init-1',
      content: '/init foo bar',
    });
    expect(event.message.content.startsWith('/init')).toBe(true);
    expect(event.message.raw).toEqual(payload);
    expect(boltMock.say).not.toHaveBeenCalled();

    await service.stop();
  });

  it('无参数命令的 content 只包含规范触发词', async () => {
    const events: ChannelEvent[] = [];
    const service = new SlackChannelService(makeSlackChannel(), (event) => {
      events.push(event);
    });
    await service.start();

    const handler = boltMock.commandHandlers.get('/help');
    if (!handler) throw new Error('未注册 /help 斜杠命令处理器');

    await handler({
      ack: vi.fn(async () => undefined),
      say: boltMock.say,
      command: { channel_id: 'C-help-1', user_id: 'U-help-1', text: '   ' },
    });

    expect(events).toHaveLength(1);
    const event = events[0];
    if (event?.type !== 'message') throw new Error('期望收到 message 类型事件');
    expect(event.message).toMatchObject({
      chatId: 'C-help-1',
      senderId: 'U-help-1',
      content: '/help',
    });
    expect(boltMock.say).not.toHaveBeenCalled();

    await service.stop();
  });
});
