/**
 * `session_read` 默认摘要视图回归：
 *   1. 默认只回最近 20 条（此前是整段历史 + 未折叠文本，单次曾达 80 万字符）；
 *   2. 长消息默认折叠到约 600 字符，`full: true` 才返回完整文本；
 *   3. `limit` 取最近 N 条（而不是最早的 N 条）。
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

const USER_ID = 'u-session-read-defaults';
const SESSION_ID = 'sess-read-defaults';
const MESSAGE_COUNT = 25;
const LONG_BODY = 'y'.repeat(1000);

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
     VALUES (?, ?, 'read defaults', '[]', '{}', 'idle', datetime('now'), datetime('now'))`,
    [SESSION_ID, USER_ID],
  );
  for (let index = 1; index <= MESSAGE_COUNT; index += 1) {
    appendSessionMessageV2({
      sessionId: SESSION_ID,
      userId: USER_ID,
      role: index % 2 === 0 ? 'assistant' : 'user',
      content: [{ type: 'text', text: `[msg-${index}] ${LONG_BODY}` }],
      clientRequestId: `${SESSION_ID}:seed:${index}`,
      messageId: `${SESSION_ID}:seed:${index}`,
      status: 'final',
    });
  }
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('runSessionReadTool 默认摘要视图', () => {
  it('默认只回最近 20 条并折叠长文本', () => {
    const output = runSessionReadTool(USER_ID, {
      session_id: SESSION_ID,
      include_todos: false,
      include_transcript: false,
      limit: 20,
      full: false,
    });

    expect(output).toContain(`Messages: ${MESSAGE_COUNT}（仅显示最近 20 条`);
    expect(output).toContain(`[Message ${MESSAGE_COUNT}/${MESSAGE_COUNT}]`);
    expect(output).toContain(`[Message ${MESSAGE_COUNT - 19}/${MESSAGE_COUNT}]`);
    expect(output).not.toContain(`[Message 1/${MESSAGE_COUNT}]`);
    // 默认折叠：600 字符以上的正文不会整段出现。
    expect(output).not.toContain('y'.repeat(601));
    expect(output).toContain('full: true');
  });

  it('full: true 时返回完整文本', () => {
    const output = runSessionReadTool(USER_ID, {
      session_id: SESSION_ID,
      include_todos: false,
      include_transcript: false,
      limit: 20,
      full: true,
    });

    expect(output).toContain(LONG_BODY);
    expect(output).not.toContain('full: true');
  });

  it('limit 取最近 N 条而不是最早的 N 条', () => {
    const output = runSessionReadTool(USER_ID, {
      session_id: SESSION_ID,
      include_todos: false,
      include_transcript: false,
      limit: 5,
      full: false,
    });

    expect(output).toContain(`（仅显示最近 5 条`);
    expect(output).toContain(`[Message ${MESSAGE_COUNT - 4}/${MESSAGE_COUNT}]`);
    expect(output).toContain(`[Message ${MESSAGE_COUNT}/${MESSAGE_COUNT}]`);
    expect(output).not.toContain(`[Message ${MESSAGE_COUNT - 5}/${MESSAGE_COUNT}]`);
  });
});
