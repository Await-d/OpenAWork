import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as ChannelSessionsModule from '../../channels/channel-sessions.js';
import type * as DbModule from '../../infra/db.js';
import type * as MessageAdapterModule from '../../message/message-v2-adapter.js';
import type { ChannelInstance } from '../../channels/types.js';
import { parseSessionMetadataJson } from '../../session/session-workspace-metadata.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';
process.env['AI_API_BASE_URL'] = '';
process.env['AI_API_KEY'] = '';
process.env['AI_DEFAULT_MODEL'] = '';

const USER_ID = 'u-channel-session-commands';
const CHANNEL_ID = 'channel-session-commands';
const CHAT_ID = 'chat-1';

let channelSessions: typeof ChannelSessionsModule;
let dbModule: typeof DbModule;
let messageAdapter: typeof MessageAdapterModule;

function makeChannel(): ChannelInstance {
  return {
    id: CHANNEL_ID,
    type: 'telegram',
    name: 'Telegram 工程群',
    enabled: true,
    config: { token: 'redacted' },
    features: { autoReply: true, streamingReply: false, autoStart: false },
    persona: {
      resourceId: 'resource-soul-balanced-collaborator',
      title: '稳健协作者',
    },
    ownerUserId: USER_ID,
    createdAt: 1_788_000_000_000,
    updatedAt: 1_788_000_000_000,
  };
}

function makeUserPersonaChannel(): ChannelInstance {
  return {
    ...makeChannel(),
    persona: {
      resourceId: 'user-resource-channel-persona',
      title: '客服人设',
    },
  };
}

function seedUser(): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
}

function currentSessionId(): string {
  const row = dbModule.sqliteGet<{ id: string }>(
    'SELECT id FROM sessions WHERE user_id = ? AND title = ?',
    [USER_ID, `channel:${CHANNEL_ID}:chat:${CHAT_ID}`],
  );
  if (!row) {
    throw new Error('expected seeded channel session');
  }
  return row.id;
}

function currentSessionMetadata(): Record<string, unknown> {
  const row = dbModule.sqliteGet<{ metadata_json: string }>(
    'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ?',
    [currentSessionId(), USER_ID],
  );
  if (!row) {
    throw new Error('expected seeded channel session metadata');
  }
  return parseSessionMetadataJson(row.metadata_json);
}

function appendUserMessage(index: number): void {
  messageAdapter.appendSessionMessageV2({
    sessionId: currentSessionId(),
    userId: USER_ID,
    role: 'user',
    content: [{ type: 'text', text: `用户消息 ${index}` }],
  });
}

function appendAssistantMessage(index: number): void {
  messageAdapter.appendSessionMessageV2({
    sessionId: currentSessionId(),
    userId: USER_ID,
    role: 'assistant',
    content: [{ type: 'text', text: `助手回复 ${index}` }],
    usage: {
      inputTokens: 100,
      outputTokens: 40,
      reasoningTokens: 5,
      cacheReadTokens: 3,
      cacheWriteTokens: 2,
    },
  });
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  messageAdapter = await import('../../message/message-v2-adapter.js');
  channelSessions = await import('../../channels/channel-sessions.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM part_v2', []);
  dbModule.sqliteRun('DELETE FROM message_v2', []);
  dbModule.sqliteRun('DELETE FROM user_settings', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser();
  channelSessions.getChannelUsageStats({ channel: makeChannel(), chatId: CHAT_ID });
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('channel session commands', () => {
  it('新建 channel session 默认不启用 LLM tool declarations', () => {
    const metadata = currentSessionMetadata();

    expect(metadata['source']).toBe('channel');
    expect(metadata['channelLlmToolsEnabled']).toBe(false);
  });

  it('重新保存 channel session 时保留显式 LLM tool opt-in', () => {
    const sessionId = currentSessionId();
    dbModule.sqliteRun('UPDATE sessions SET metadata_json = ? WHERE id = ? AND user_id = ?', [
      JSON.stringify({ ...currentSessionMetadata(), channelLlmToolsEnabled: true }),
      sessionId,
      USER_ID,
    ]);

    channelSessions.getChannelUsageStats({ channel: makeChannel(), chatId: CHAT_ID });

    expect(currentSessionMetadata()['channelLlmToolsEnabled']).toBe(true);
  });

  it('Given channel 配置显式允许模型工具 When 写入 channel session Then metadata 打开 LLM tool declarations', () => {
    channelSessions.getChannelUsageStats({
      channel: { ...makeChannel(), channelLlmToolsEnabled: true },
      chatId: CHAT_ID,
    });

    expect(currentSessionMetadata()['channelLlmToolsEnabled']).toBe(true);
  });

  it('Given 旧 channel 配置已勾选模型工具但缺少总开关 When 写入 channel session Then 兼容打开 LLM tool declarations', () => {
    channelSessions.getChannelUsageStats({
      channel: {
        ...makeChannel(),
        tools: {
          web_search: true,
          read: true,
          PluginReplyMessage: true,
        },
      },
      chatId: CHAT_ID,
    });

    expect(currentSessionMetadata()['channelLlmToolsEnabled']).toBe(true);
  });

  it('Given 旧 session 开过模型工具 When channel 配置显式关闭 Then metadata 同步关闭', () => {
    const sessionId = currentSessionId();
    dbModule.sqliteRun('UPDATE sessions SET metadata_json = ? WHERE id = ? AND user_id = ?', [
      JSON.stringify({ ...currentSessionMetadata(), channelLlmToolsEnabled: true }),
      sessionId,
      USER_ID,
    ]);

    channelSessions.getChannelUsageStats({
      channel: { ...makeChannel(), channelLlmToolsEnabled: false },
      chatId: CHAT_ID,
    });

    expect(currentSessionMetadata()['channelLlmToolsEnabled']).toBe(false);
  });

  it('通道绑定 souls persona 时写入 channel session metadata', () => {
    const row = dbModule.sqliteGet<{ metadata_json: string }>(
      'SELECT metadata_json FROM sessions WHERE user_id = ? AND title = ?',
      [USER_ID, `channel:${CHANNEL_ID}:chat:${CHAT_ID}`],
    );
    if (!row) {
      throw new Error('expected seeded channel session');
    }

    const metadata = JSON.parse(row.metadata_json) as {
      channelPersona?: { resourceId?: string; title?: string; content?: string };
    };
    expect(metadata.channelPersona?.resourceId).toBe('resource-soul-balanced-collaborator');
    expect(metadata.channelPersona?.title).toBe('稳健协作者');
    expect(metadata.channelPersona?.content).toContain(
      'You are the balanced professional collaborator',
    );
  });

  it('通道绑定用户上传 souls persona 时按用户隔离写入 metadata', () => {
    dbModule.sqliteRun(
      `INSERT INTO user_resources
        (id, user_id, area, name, title, description, content, metadata_json)
       VALUES (?, ?, 'souls', ?, ?, ?, ?, '{}')`,
      [
        'user-resource-channel-persona',
        USER_ID,
        'support-persona',
        '客服人设',
        '用户上传通道人设',
        '# 客服人设\n保持简洁、礼貌。',
      ],
    );

    channelSessions.getChannelUsageStats({
      channel: makeUserPersonaChannel(),
      chatId: 'chat-user-persona',
    });

    const row = dbModule.sqliteGet<{ metadata_json: string }>(
      'SELECT metadata_json FROM sessions WHERE user_id = ? AND title = ?',
      [USER_ID, `channel:${CHANNEL_ID}:chat:chat-user-persona`],
    );
    if (!row) {
      throw new Error('expected channel session with user persona');
    }

    const metadata = JSON.parse(row.metadata_json) as {
      channelPersona?: { resourceId?: string; title?: string; content?: string };
    };
    expect(metadata.channelPersona).toEqual({
      resourceId: 'user-resource-channel-persona',
      title: '客服人设',
      content: '# 客服人设\n保持简洁、礼貌。',
    });
  });

  it('统计当前 channel conversation 的 token 使用量', () => {
    appendUserMessage(1);
    appendAssistantMessage(1);
    appendAssistantMessage(2);

    const result = channelSessions.getChannelUsageStats({
      channel: makeChannel(),
      chatId: CHAT_ID,
    });

    expect(result.content).toContain('Total: 280 tokens');
    expect(result.content).toContain('Input: 200');
    expect(result.content).toContain('Output: 80');
    expect(result.content).toContain('Assistant replies: 2');
  });

  it('/new 清空当前 channel conversation 的消息历史', () => {
    appendUserMessage(1);
    appendAssistantMessage(1);

    const result = channelSessions.resetChannelConversation({
      channel: makeChannel(),
      chatId: CHAT_ID,
    });

    const messages = messageAdapter.listSessionMessagesV2({
      sessionId: currentSessionId(),
      userId: USER_ID,
    });
    expect(result.content).toContain('Session cleared');
    expect(messages).toHaveLength(0);
  });

  it('/compress 为当前 channel conversation 写入压缩标记', async () => {
    for (let index = 1; index <= 4; index += 1) {
      appendUserMessage(index);
      appendAssistantMessage(index);
    }

    const result = await channelSessions.compactChannelConversation({
      channel: makeChannel(),
      chatId: CHAT_ID,
    });

    const messages = messageAdapter.listSessionMessagesV2({
      sessionId: currentSessionId(),
      userId: USER_ID,
    });
    expect(result.content).toContain('Context compressed');
    expect(messages.length).toBeGreaterThan(8);
  });
});
