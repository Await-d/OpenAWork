import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearChannelMessageCache,
  listRecentChannelGroups,
  listRecentChannelMessages,
  recordChannelMessage,
} from '../../channels/channel-message-cache.js';
import type {
  ChannelEvent,
  ChannelInstance,
  MessagingChannelService,
} from '../../channels/types.js';

type SqliteGetMockRow = {
  readonly handoff_state?: string | null;
  readonly metadata_json?: string;
  readonly role_layer?: string | null;
  readonly team_parent_session_id?: string | null;
  readonly title?: string;
  readonly user_id?: string;
};

const mocks = vi.hoisted(() => ({
  metadataJson: JSON.stringify({
    source: 'channel',
    channelChatId: 'chat-1',
    channel: {
      id: 'channel-1',
      type: 'telegram',
      name: '测试通道',
      tools: {},
    },
  }),
  sendMessageMock: vi.fn(async () => ({ messageId: 'message-1' })),
  replyMessageMock: vi.fn(async (_messageId: string, _content: string) => ({
    messageId: 'reply-1',
  })),
  sqliteAllMock: vi.fn(() => []),
  sqliteGetMock: vi.fn((query: string): SqliteGetMockRow | undefined => {
    if (query.includes('SELECT user_id FROM sessions')) {
      return { user_id: 'user-1' };
    }
    if (query.includes('SELECT role_layer, team_parent_session_id, handoff_state')) {
      return { role_layer: null, team_parent_session_id: null, handoff_state: null };
    }
    if (query.includes('SELECT metadata_json, title FROM sessions')) {
      return { metadata_json: mocks.metadataJson, title: 'channel:channel-1:chat:chat-1' };
    }
    if (query.includes('SELECT metadata_json')) {
      return { metadata_json: mocks.metadataJson };
    }
    return undefined;
  }),
  sqliteRunMock: vi.fn(),
  sqliteRunWithRowIdMock: vi.fn(() => 1),
  transitionToolToRunningMock: vi.fn(),
}));

function makeChannelMetadata(): string {
  return JSON.stringify({
    source: 'channel',
    channelChatId: 'chat-1',
    channel: {
      id: 'channel-1',
      type: 'telegram',
      name: '测试通道',
      tools: {},
    },
  });
}

vi.mock('../../infra/db.js', () => ({
  WORKSPACE_ACCESS_RESTRICTED: false,
  WORKSPACE_ROOT: '/home/await/project/OpenAWork',
  WORKSPACE_ROOTS: ['/home/await/project/OpenAWork'],
  sqliteAll: mocks.sqliteAllMock,
  sqliteGet: mocks.sqliteGetMock,
  sqliteRun: mocks.sqliteRunMock,
  sqliteRunWithRowId: mocks.sqliteRunWithRowIdMock,
}));

vi.mock('../../message/message-store-v2.js', () => ({
  transitionToolToRunning: mocks.transitionToolToRunningMock,
}));

function makeChannel(): ChannelInstance {
  return {
    id: 'channel-1',
    type: 'telegram',
    name: '测试通道',
    enabled: true,
    config: {},
    ownerUserId: 'user-1',
    createdAt: 1_788_000_000_000,
    updatedAt: 1_788_000_000_000,
  };
}

function makeService(): MessagingChannelService {
  return {
    pluginId: 'channel-1',
    pluginType: 'telegram',
    async start() {
      return undefined;
    },
    async stop() {
      return undefined;
    },
    isRunning() {
      return true;
    },
    sendMessage: mocks.sendMessageMock,
    async replyMessage(messageId: string, content: string) {
      return mocks.replyMessageMock(messageId, content);
    },
    async getGroupMessages(chatId: string, count?: number) {
      return listRecentChannelMessages('channel-1', chatId, count);
    },
    async listGroups() {
      return listRecentChannelGroups('channel-1');
    },
  };
}

describe('channel tools', () => {
  beforeEach(async () => {
    mocks.metadataJson = makeChannelMetadata();
    mocks.sendMessageMock.mockClear();
    mocks.replyMessageMock.mockClear();
    mocks.sqliteAllMock.mockClear();
    mocks.sqliteGetMock.mockClear();
    mocks.sqliteRunMock.mockClear();
    mocks.transitionToolToRunningMock.mockClear();
    const { channelManager } = await import('../../channels/manager.js');
    channelManager.registerFactory('telegram', () => makeService());
    await channelManager.startPlugin(makeChannel(), (_event: ChannelEvent) => undefined);
  });

  afterEach(async () => {
    const { channelManager } = await import('../../channels/manager.js');
    await channelManager.stopAll();
    clearChannelMessageCache();
    vi.clearAllMocks();
  });

  it('Given channel session When PluginSendMessage executes Then it sends through current channel service', async () => {
    const { createDefaultSandbox } = await import('../../tools/tool-sandbox.js');

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-channel-send',
        toolName: 'PluginSendMessage',
        rawInput: { content: '你好' },
      },
      new AbortController().signal,
      'session-1',
      {
        clientRequestId: 'req-channel-send',
        nextRound: 1,
        requestData: { clientRequestId: 'req-channel-send' },
      },
    );

    expect(result.isError).toBe(false);
    expect(result.output).toBe(JSON.stringify({ messageId: 'message-1' }));
    expect(mocks.sendMessageMock).toHaveBeenCalledWith('chat-1', '你好');
  }, 15_000);

  it('Given normal session When PluginSendMessage executes Then it is rejected before sending', async () => {
    mocks.metadataJson = JSON.stringify({ source: 'desktop' });
    const { createDefaultSandbox } = await import('../../tools/tool-sandbox.js');

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-channel-normal-session',
        toolName: 'PluginSendMessage',
        rawInput: { content: '不要发送' },
      },
      new AbortController().signal,
      'session-1',
    );

    expect(result.isError).toBe(true);
    expect(String(result.output)).toContain('not enabled for this session');
    expect(mocks.sendMessageMock).not.toHaveBeenCalled();
  });

  it('Given channel session When PluginReplyMessage gets a raw message id Then it prefixes the current chat for Telegram replies', async () => {
    const { createDefaultSandbox } = await import('../../tools/tool-sandbox.js');

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-channel-reply',
        toolName: 'PluginReplyMessage',
        rawInput: { message_id: 'message-42', content: '收到' },
      },
      new AbortController().signal,
      'session-1',
    );

    expect(result.isError).toBe(false);
    expect(result.output).toBe(JSON.stringify({ messageId: 'reply-1' }));
    expect(mocks.replyMessageMock).toHaveBeenCalledWith('chat-1:message-42', '收到');
  });

  it('Given cached current chat messages When PluginGetCurrentChatMessages executes Then it returns the active channel history', async () => {
    recordChannelMessage('channel-1', {
      id: 'incoming-1',
      chatId: 'chat-1',
      chatName: '当前群聊',
      content: '第一条消息',
      senderId: 'sender-1',
      senderName: '用户一',
      timestamp: 1_788_000_000_001,
    });
    recordChannelMessage('channel-1', {
      id: 'incoming-2',
      chatId: 'chat-1',
      chatName: '当前群聊',
      content: '第二条消息',
      senderId: 'sender-2',
      senderName: '用户二',
      timestamp: 1_788_000_000_002,
    });
    const { createDefaultSandbox } = await import('../../tools/tool-sandbox.js');

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-channel-history',
        toolName: 'PluginGetCurrentChatMessages',
        rawInput: { count: 1 },
      },
      new AbortController().signal,
      'session-1',
    );

    expect(result.isError).toBe(false);
    expect(result.output).toBe(
      JSON.stringify([
        {
          id: 'incoming-2',
          replyMessageId: 'chat-1:incoming-2',
          senderId: 'sender-2',
          senderName: '用户二',
          chatId: 'chat-1',
          content: '第二条消息',
          timestamp: 1_788_000_000_002,
        },
      ]),
    );
  });
});
