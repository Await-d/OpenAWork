import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dirname, resolve } from 'node:path';
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

type SendImageMock = NonNullable<MessagingChannelService['sendImage']>;
type ReplyImageMock = NonNullable<MessagingChannelService['replyImage']>;

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, '../../../../../');
const WORKSPACE_PACKAGE_JSON = resolve(REPO_ROOT, 'package.json');

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
  sendImageMock: vi.fn<SendImageMock>(async () => ({ messageId: 'image-1' })),
  replyMessageMock: vi.fn(async (_messageId: string, _content: string) => ({
    messageId: 'reply-1',
  })),
  replyImageMock: vi.fn<ReplyImageMock>(async (_messageId: string) => ({
    messageId: 'reply-image-1',
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

function makeChannelMetadata(
  type: ChannelInstance['type'] = 'telegram',
  currentMessageId?: string,
  chatId = 'chat-1',
): string {
  return JSON.stringify({
    source: 'channel',
    channelChatId: chatId,
    ...(currentMessageId ? { channelMessageId: currentMessageId } : {}),
    channel: {
      id: 'channel-1',
      type,
      name: '测试通道',
      tools: {},
    },
  });
}

vi.mock('../../infra/db.js', () => ({
  WORKSPACE_ACCESS_RESTRICTED: false,
  WORKSPACE_ROOT: REPO_ROOT,
  WORKSPACE_ROOTS: [REPO_ROOT],
  sqliteAll: mocks.sqliteAllMock,
  sqliteGet: mocks.sqliteGetMock,
  sqliteRun: mocks.sqliteRunMock,
  sqliteRunWithRowId: mocks.sqliteRunWithRowIdMock,
}));

vi.mock('../../message/message-store-v2.js', () => ({
  transitionToolToRunning: mocks.transitionToolToRunningMock,
}));

function makeChannel(type: ChannelInstance['type'] = 'telegram'): ChannelInstance {
  return {
    id: 'channel-1',
    type,
    name: '测试通道',
    enabled: true,
    config: {},
    ownerUserId: 'user-1',
    createdAt: 1_788_000_000_000,
    updatedAt: 1_788_000_000_000,
  };
}

function makeService(pluginType: ChannelInstance['type'] = 'telegram'): MessagingChannelService {
  return {
    pluginId: 'channel-1',
    pluginType,
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
    sendImage: mocks.sendImageMock,
    async replyMessage(messageId: string, content: string) {
      return mocks.replyMessageMock(messageId, content);
    },
    replyImage: mocks.replyImageMock,
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
    mocks.sendImageMock.mockClear();
    mocks.replyMessageMock.mockClear();
    mocks.replyImageMock.mockClear();
    mocks.sqliteAllMock.mockClear();
    mocks.sqliteGetMock.mockClear();
    mocks.sqliteRunMock.mockClear();
    mocks.transitionToolToRunningMock.mockClear();
    const { channelManager } = await import('../../channels/manager.js');
    channelManager.registerFactory('telegram', () => makeService('telegram'));
    channelManager.registerFactory('qq', () => makeService('qq'));
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

  it('Given channel session When PluginReplyMessage gets a cross-chat message id Then it rejects before replying', async () => {
    const { createDefaultSandbox } = await import('../../tools/tool-sandbox.js');

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-channel-reply-cross-chat',
        toolName: 'PluginReplyMessage',
        rawInput: { message_id: 'other-chat:message-42', content: '不要发送' },
      },
      new AbortController().signal,
      'session-1',
    );

    expect(result.isError).toBe(true);
    expect(String(result.output)).toContain(
      'Reply message_id must belong to the current channel chat.',
    );
    expect(mocks.replyMessageMock).not.toHaveBeenCalled();
  });

  it('Given channel session When PluginSendImage executes Then it sends an image through current channel service', async () => {
    const { createDefaultSandbox } = await import('../../tools/tool-sandbox.js');

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-channel-image',
        toolName: 'PluginSendImage',
        rawInput: {
          file_path: WORKSPACE_PACKAGE_JSON,
          content: '图片说明',
        },
      },
      new AbortController().signal,
      'session-1',
    );

    expect(result.isError).toBe(false);
    expect(result.output).toBe(JSON.stringify({ messageId: 'image-1' }));
    expect(mocks.sendImageMock).toHaveBeenCalledTimes(1);
    const sendImageCall = mocks.sendImageMock.mock.calls[0];
    if (!sendImageCall) {
      throw new Error('sendImage was not called');
    }
    expect(sendImageCall[0]).toBe('chat-1');
    expect(sendImageCall[1]).toMatchObject({
      fileName: 'package.json',
      text: '图片说明',
    });
    expect(Buffer.isBuffer(sendImageCall[1].buffer)).toBe(true);
  }, 15_000);

  it('Given channel session When PluginSendImage receives an explicit reply message id Then it replies to that message', async () => {
    const { createDefaultSandbox } = await import('../../tools/tool-sandbox.js');

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-channel-image-explicit-reply',
        toolName: 'PluginSendImage',
        rawInput: {
          file_path: WORKSPACE_PACKAGE_JSON,
          message_id: 'chat-1:message-42',
          content: '图片说明',
        },
      },
      new AbortController().signal,
      'session-1',
    );

    expect(result.isError).toBe(false);
    expect(result.output).toBe(JSON.stringify({ messageId: 'reply-image-1' }));
    expect(mocks.replyImageMock).toHaveBeenCalledWith(
      'chat-1:message-42',
      expect.objectContaining({
        fileName: 'package.json',
      }),
    );
    expect(mocks.sendImageMock).not.toHaveBeenCalled();
  }, 15_000);

  it('Given channel session When PluginSendImage receives a cross-chat reply message id Then it rejects before replying', async () => {
    const { createDefaultSandbox } = await import('../../tools/tool-sandbox.js');

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-channel-image-cross-chat-reply',
        toolName: 'PluginSendImage',
        rawInput: {
          file_path: WORKSPACE_PACKAGE_JSON,
          message_id: 'other-chat:message-42',
        },
      },
      new AbortController().signal,
      'session-1',
    );

    expect(result.isError).toBe(true);
    expect(String(result.output)).toContain(
      'Reply message_id must belong to the current channel chat.',
    );
    expect(mocks.replyImageMock).not.toHaveBeenCalled();
    expect(mocks.sendImageMock).not.toHaveBeenCalled();
  }, 15_000);

  it('Given QQ channel session with current message When PluginSendImage executes Then it replies with image to that message', async () => {
    const { channelManager } = await import('../../channels/manager.js');
    await channelManager.stopAll();
    mocks.metadataJson = makeChannelMetadata(
      'qq',
      'c2c:user-open-id|incoming-msg-id',
      'c2c:user-open-id',
    );
    await channelManager.startPlugin(makeChannel('qq'), (_event: ChannelEvent) => undefined);
    const { createDefaultSandbox } = await import('../../tools/tool-sandbox.js');

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-qq-channel-image',
        toolName: 'PluginSendImage',
        rawInput: {
          file_path: WORKSPACE_PACKAGE_JSON,
        },
      },
      new AbortController().signal,
      'session-1',
    );

    expect(result.isError).toBe(false);
    expect(result.output).toBe(JSON.stringify({ messageId: 'reply-image-1' }));
    expect(mocks.replyImageMock).toHaveBeenCalledWith(
      'c2c:user-open-id|incoming-msg-id',
      expect.objectContaining({
        fileName: 'package.json',
      }),
    );
    expect(mocks.sendImageMock).not.toHaveBeenCalled();
  }, 15_000);

  it('Given QQ channel session When PluginSendImage receives an explicit QQ reply id Then it replies with image to that QQ message', async () => {
    const { channelManager } = await import('../../channels/manager.js');
    await channelManager.stopAll();
    mocks.metadataJson = makeChannelMetadata('qq', undefined, 'c2c:user-open-id');
    await channelManager.startPlugin(makeChannel('qq'), (_event: ChannelEvent) => undefined);
    const { createDefaultSandbox } = await import('../../tools/tool-sandbox.js');

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-qq-channel-image-explicit-reply',
        toolName: 'PluginSendImage',
        rawInput: {
          file_path: WORKSPACE_PACKAGE_JSON,
          message_id: 'c2c:user-open-id|history-msg-id',
        },
      },
      new AbortController().signal,
      'session-1',
    );

    expect(result.isError).toBe(false);
    expect(result.output).toBe(JSON.stringify({ messageId: 'reply-image-1' }));
    expect(mocks.replyImageMock).toHaveBeenCalledWith(
      'c2c:user-open-id|history-msg-id',
      expect.objectContaining({
        fileName: 'package.json',
      }),
    );
    expect(mocks.sendImageMock).not.toHaveBeenCalled();
  }, 15_000);

  it('Given QQ channel session When PluginSendImage receives a cross-chat QQ reply id Then it rejects before replying', async () => {
    const { channelManager } = await import('../../channels/manager.js');
    await channelManager.stopAll();
    mocks.metadataJson = makeChannelMetadata('qq', undefined, 'c2c:user-open-id');
    await channelManager.startPlugin(makeChannel('qq'), (_event: ChannelEvent) => undefined);
    const { createDefaultSandbox } = await import('../../tools/tool-sandbox.js');

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-qq-channel-image-cross-chat-reply',
        toolName: 'PluginSendImage',
        rawInput: {
          file_path: WORKSPACE_PACKAGE_JSON,
          message_id: 'c2c:other-user|history-msg-id',
        },
      },
      new AbortController().signal,
      'session-1',
    );

    expect(result.isError).toBe(true);
    expect(String(result.output)).toContain(
      'Reply message_id must belong to the current channel chat.',
    );
    expect(mocks.replyImageMock).not.toHaveBeenCalled();
    expect(mocks.sendImageMock).not.toHaveBeenCalled();
  }, 15_000);

  it('Given channel session When PluginSendImage receives blank ids Then it still uses the current channel context', async () => {
    const { createDefaultSandbox } = await import('../../tools/tool-sandbox.js');

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-channel-image-blank-ids',
        toolName: 'PluginSendImage',
        rawInput: {
          plugin_id: '',
          chat_id: '',
          file_path: WORKSPACE_PACKAGE_JSON,
          content: '',
        },
      },
      new AbortController().signal,
      'session-1',
    );

    expect(result.isError).toBe(false);
    expect(result.output).toBe(JSON.stringify({ messageId: 'image-1' }));
    expect(mocks.sendImageMock).toHaveBeenCalledTimes(1);
    const sendImageCall = mocks.sendImageMock.mock.calls[0];
    if (!sendImageCall) {
      throw new Error('sendImage was not called');
    }
    expect(sendImageCall[0]).toBe('chat-1');
    expect(sendImageCall[1]).not.toHaveProperty('text');
  }, 15_000);

  it.each([
    { chatId: 'default', pluginId: 'current' },
    { chatId: '__default__', pluginId: '__CURRENT_CHANNEL__' },
  ])(
    'Given channel session When PluginSendImage receives placeholder ids %j Then it still uses the current channel context',
    async (rawIds) => {
      const { createDefaultSandbox } = await import('../../tools/tool-sandbox.js');

      const result = await createDefaultSandbox().execute(
        {
          toolCallId: `call-channel-image-placeholder-${rawIds.pluginId}`,
          toolName: 'PluginSendImage',
          rawInput: {
            plugin_id: rawIds.pluginId,
            chat_id: rawIds.chatId,
            file_path: WORKSPACE_PACKAGE_JSON,
          },
        },
        new AbortController().signal,
        'session-1',
      );

      expect(result.isError).toBe(false);
      expect(result.output).toBe(JSON.stringify({ messageId: 'image-1' }));
      expect(mocks.sendImageMock).toHaveBeenCalledTimes(1);
      const sendImageCall = mocks.sendImageMock.mock.calls[0];
      if (!sendImageCall) {
        throw new Error('sendImage was not called');
      }
      expect(sendImageCall[0]).toBe('chat-1');
    },
    15_000,
  );

  it('Given channel session When PluginSendImage receives mismatched explicit ids Then it rejects before sending', async () => {
    const { createDefaultSandbox } = await import('../../tools/tool-sandbox.js');

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-channel-image-wrong-ids',
        toolName: 'PluginSendImage',
        rawInput: {
          plugin_id: 'other-channel',
          chat_id: 'other-chat',
          file_path: WORKSPACE_PACKAGE_JSON,
        },
      },
      new AbortController().signal,
      'session-1',
    );

    expect(result.isError).toBe(true);
    expect(String(result.output)).toContain(
      'Requested plugin_id does not match the current channel session.',
    );
    expect(mocks.sendImageMock).not.toHaveBeenCalled();
  }, 15_000);

  it('Given channel session When PluginSendImage receives mismatched explicit chat id Then it rejects before sending', async () => {
    const { createDefaultSandbox } = await import('../../tools/tool-sandbox.js');

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-channel-image-wrong-chat-id',
        toolName: 'PluginSendImage',
        rawInput: {
          plugin_id: 'channel-1',
          chat_id: 'other-chat',
          file_path: WORKSPACE_PACKAGE_JSON,
        },
      },
      new AbortController().signal,
      'session-1',
    );

    expect(result.isError).toBe(true);
    expect(String(result.output)).toContain(
      'Requested chat_id does not match the current channel session.',
    );
    expect(mocks.sendImageMock).not.toHaveBeenCalled();
  }, 15_000);

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
