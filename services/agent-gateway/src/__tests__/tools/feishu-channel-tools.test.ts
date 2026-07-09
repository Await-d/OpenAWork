import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  bitableTablesMock: vi.fn(async () => ({ items: [{ table_id: 'tbl-1', name: '任务表' }] })),
  fetchMock: vi.fn(async () => new Response(new Uint8Array([1, 2, 3]).buffer)),
  metadataJson: makeChannelMetadataForTest('feishu'),
  sendFileMock: vi.fn(async () => ({ messageId: 'file-message-1' })),
  sendMentionMock: vi.fn(async () => ({ messageId: 'mention-message-1' })),
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

function makeChannelMetadataForTest(type: ChannelInstance['type']): string {
  return JSON.stringify({
    source: 'channel',
    channelChatId: 'chat-1',
    channel: { id: 'channel-1', type, name: '测试通道', tools: {} },
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

function makeChannel(type: ChannelInstance['type']): ChannelInstance {
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

function makeFeishuService(): MessagingChannelService {
  return {
    pluginId: 'channel-1',
    pluginType: 'feishu',
    async start() {
      return undefined;
    },
    async stop() {
      return undefined;
    },
    isRunning() {
      return true;
    },
    async sendMessage() {
      return { messageId: 'message-1' };
    },
    async replyMessage() {
      return { messageId: 'reply-1' };
    },
    sendFile: mocks.sendFileMock,
    sendMention: mocks.sendMentionMock,
    listBitableTables: mocks.bitableTablesMock,
    async getGroupMessages() {
      return [];
    },
    async listGroups() {
      return [];
    },
  };
}

describe('Feishu channel tools', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    mocks.metadataJson = makeChannelMetadataForTest('feishu');
    mocks.bitableTablesMock.mockClear();
    mocks.fetchMock.mockClear();
    mocks.sendFileMock.mockClear();
    mocks.sendMentionMock.mockClear();
    mocks.sqliteAllMock.mockClear();
    mocks.sqliteGetMock.mockClear();
    mocks.sqliteRunMock.mockClear();
    mocks.transitionToolToRunningMock.mockClear();
    const { channelManager } = await import('../../channels/manager.js');
    channelManager.registerFactory('feishu', () => makeFeishuService());
    await channelManager.startPlugin(makeChannel('feishu'), (_event: ChannelEvent) => undefined);
  });

  afterEach(async () => {
    const { channelManager } = await import('../../channels/manager.js');
    await channelManager.stopAll();
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('Given Feishu session When FeishuSendFile executes Then it sends via current service with detected file type', async () => {
    globalThis.fetch = mocks.fetchMock;
    const { createDefaultSandbox } = await import('../../tools/tool-sandbox.js');

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-feishu-file',
        toolName: 'FeishuSendFile',
        rawInput: { file_path: 'https://example.com/report.xlsx' },
      },
      new AbortController().signal,
      'session-1',
    );

    expect(result.isError).toBe(false);
    expect(result.output).toBe(JSON.stringify({ messageId: 'file-message-1' }));
    expect(mocks.sendFileMock).toHaveBeenCalledWith(
      'chat-1',
      expect.objectContaining({
        buffer: Buffer.from([1, 2, 3]),
        fileName: 'report.xlsx',
        fileType: 'xls',
      }),
    );
  });

  it('Given Feishu session When FeishuAtMember executes Then it sends mention through current chat', async () => {
    const { createDefaultSandbox } = await import('../../tools/tool-sandbox.js');

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-feishu-mention',
        toolName: 'FeishuAtMember',
        rawInput: { user_ids: ['ou_1'], text: '请看一下' },
      },
      new AbortController().signal,
      'session-1',
    );

    expect(result.isError).toBe(false);
    expect(result.output).toBe(JSON.stringify({ messageId: 'mention-message-1' }));
    expect(mocks.sendMentionMock).toHaveBeenCalledWith(
      'chat-1',
      expect.objectContaining({ userIds: ['ou_1'], text: '请看一下' }),
    );
  });

  it('Given Telegram session When FeishuAtMember executes Then it is hidden before service call', async () => {
    mocks.metadataJson = makeChannelMetadataForTest('telegram');
    const { createDefaultSandbox } = await import('../../tools/tool-sandbox.js');

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-feishu-hidden',
        toolName: 'FeishuAtMember',
        rawInput: { text: '不会发送' },
      },
      new AbortController().signal,
      'session-1',
    );

    expect(result.isError).toBe(true);
    expect(String(result.output)).toContain('not enabled for this session');
    expect(mocks.sendMentionMock).not.toHaveBeenCalled();
  });

  it('Given Feishu session When FeishuBitableListTables executes Then it calls Bitable service with app token', async () => {
    const { createDefaultSandbox } = await import('../../tools/tool-sandbox.js');

    const result = await createDefaultSandbox().execute(
      {
        toolCallId: 'call-feishu-bitable-tables',
        toolName: 'FeishuBitableListTables',
        rawInput: { app_token: 'app-token-1' },
      },
      new AbortController().signal,
      'session-1',
    );

    expect(result.isError).toBe(false);
    expect(result.output).toBe(JSON.stringify({ items: [{ table_id: 'tbl-1', name: '任务表' }] }));
    expect(mocks.bitableTablesMock).toHaveBeenCalledWith(
      expect.objectContaining({ appToken: 'app-token-1' }),
    );
  });
});
