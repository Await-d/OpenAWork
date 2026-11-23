/**
 * `session_read` 的来源标注：
 *   1. 通道会话在头部补一行 `Source:`——通道来源是**会话级**属性（消息上没有通道字段，
 *      `channelMessageId` 只存最新一条），所以只能说「这个会话来自哪个通道」；
 *   2. 合成通知（子代理 / 定时任务）在行头括号内追加来源限定词。
 *
 * 限定词放进**括号内**是刻意选的：客户端行头正则要求「角色 + 可选括号」收尾
 * （`apps/web/src/components/chat/tool-call/shared/session-read-view.ts` 的 `ENTRY_HEAD`），
 * 加在角色之后会让旧客户端整行失配、通知直接从 UI 消失。
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as MessageV2AdapterModule from '../../message/message-v2-adapter.js';
import type * as SessionManagerToolsModule from '../../session/session-manager-tools.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let appendSessionMessageV2: typeof MessageV2AdapterModule.appendSessionMessageV2;
let runSessionReadTool: typeof SessionManagerToolsModule.runSessionReadTool;

const USER_ID = 'u-session-read-provenance';
const SESSION_ID = 'sess-read-provenance';

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  appendSessionMessageV2 = (await import('../../message/message-v2-adapter.js'))
    .appendSessionMessageV2;
  runSessionReadTool = (await import('../../session/session-manager-tools.js')).runSessionReadTool;
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, messages_json, metadata_json, state_status, created_at, updated_at)
     VALUES (?, ?, 'provenance', '[]', '{}', 'idle', datetime('now'), datetime('now'))`,
    [SESSION_ID, USER_ID],
  );

  appendSessionMessageV2({
    sessionId: SESSION_ID,
    userId: USER_ID,
    role: 'user',
    content: [{ type: 'text', text: '在吗' }],
    clientRequestId: `${SESSION_ID}:seed:1`,
    messageId: `${SESSION_ID}:seed:1`,
    status: 'final',
  });
  appendSessionMessageV2({
    sessionId: SESSION_ID,
    userId: USER_ID,
    role: 'assistant',
    content: [{ type: 'text', text: '在' }],
    clientRequestId: `${SESSION_ID}:seed:2`,
    messageId: `${SESSION_ID}:seed:2`,
    status: 'final',
  });
});

afterAll(async () => {
  await dbModule.closeDb();
});

function read(): string {
  return runSessionReadTool(USER_ID, {
    session_id: SESSION_ID,
    include_todos: false,
    include_transcript: false,
    limit: 20,
    full: false,
  });
}

function setSessionMetadata(metadata: Record<string, unknown>): void {
  dbModule.sqliteRun('UPDATE sessions SET metadata_json = ? WHERE id = ?', [
    JSON.stringify(metadata),
    SESSION_ID,
  ]);
}

function appendSynthetic(metadata: Record<string, unknown>): void {
  appendSessionMessageV2({
    sessionId: SESSION_ID,
    userId: USER_ID,
    role: 'synthetic',
    content: [{ type: 'text', text: '子代理已完成' }],
    metadata,
    status: 'final',
  });
}

describe('runSessionReadTool · 通道来源行', () => {
  it('普通会话不出现 Source 行', () => {
    expect(read()).not.toContain('Source:');
  });

  it('通道会话补一行 Source（通道类型 + 会话 id），位置在 Session 之后', () => {
    setSessionMetadata({
      source: 'channel',
      channelChatId: 'wxid_abc123',
      channel: { id: 'wechat-personal', type: 'wechat', name: '微信个人号' },
    });

    const output = read();

    expect(output).toContain('Source: channel · wechat · wxid_abc123');
    expect(output.indexOf('Source:')).toBeGreaterThan(output.indexOf('Session: sess'));
    expect(output.indexOf('Source:')).toBeLessThan(output.indexOf('Messages:'));
  });

  it('元数据缺通道细节时只保留能拿到的部分，不输出空段', () => {
    setSessionMetadata({ source: 'channel' });

    const output = read();

    expect(output).toContain('Source: channel\n');
    expect(output).not.toContain('Source: channel ·');
  });
});

describe('runSessionReadTool · 合成通知限定词', () => {
  it('括号内带出来源与来源名，done 不占位', () => {
    appendSynthetic({ source: 'subagent', agent: 'scout', state: 'done' });

    const output = read();

    expect(output).toContain('synthetic (');
    expect(output).toContain('· subagent · scout)');
    expect(output).not.toContain('· done');
  });

  it('失败与取消状态标出来（来源名与状态用不同分段）', () => {
    appendSynthetic({ source: 'subagent', agent: 'scout', state: 'failed' });
    appendSynthetic({ source: 'cron', agent: '周报汇总', state: 'cancelled' });

    const output = read();

    expect(output).toContain('· subagent · scout · failed');
    expect(output).toContain('· cron · 周报汇总 · cancelled');
  });

  it('缺 agent 时只剩来源段', () => {
    appendSynthetic({ source: 'cron', state: 'failed' });

    const output = read();

    expect(output).toContain('· cron · failed');
  });

  it('非合成消息的括号里只有时间，不带任何限定词', () => {
    const output = read();

    expect(output).not.toMatch(/\[Message \d+\/\d+\] (?:user|assistant) \([^)]*·/);
    expect(output).toMatch(/\[Message \d+\/\d+\] user \([^)]+\)/);
  });
});
