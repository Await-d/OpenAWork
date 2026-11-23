import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as GitHubRouterModule from '../../github/router.js';
import type * as MessageAdapterModule from '../../message/message-v2-adapter.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';
process.env['AI_API_BASE_URL'] = '';
process.env['AI_API_KEY'] = '';
process.env['AI_DEFAULT_MODEL'] = '';

// GitHub 回写路径是在后台执行里 fire-and-forget 的；这里只测文本提取，桩掉后台执行
// 即可避免加载真实 Agent 运行时（与 `github-octokit-timeout.test.ts` 同策略）。
vi.mock('../../routes/stream-runtime.js', () => ({
  runSessionInBackground: vi.fn(() => new Promise(() => undefined)),
}));

const USER_ID = 'u-github-writeback';
const SESSION_ID = 'session-github-writeback';

let dbModule: typeof DbModule;
let messageAdapter: typeof MessageAdapterModule;
let extractFinalAssistantText: typeof GitHubRouterModule.extractFinalAssistantText;

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  messageAdapter = await import('../../message/message-v2-adapter.js');
  const githubRouter = await import('../../github/router.js');
  extractFinalAssistantText = githubRouter.extractFinalAssistantText;
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM message_v2', []);
  dbModule.sqliteRun('DELETE FROM session_messages', []);
  dbModule.sqliteRun('DELETE FROM session_entry', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  dbModule.sqliteRun("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
  dbModule.sqliteRun(
    `INSERT INTO sessions
      (id, user_id, title, messages_json, state_status, metadata_json, created_at, updated_at)
     VALUES (?, ?, 'github:owner/repo', '[]', 'idle', '{}', ?, ?)`,
    [SESSION_ID, USER_ID, '2026-11-04 10:00:00', '2026-11-04 10:00:00'],
  );
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('extractFinalAssistantText（GitHub 回写正文）', () => {
  it('只取正文，丢弃 reasoning 与工具调用输出', () => {
    messageAdapter.appendSessionMessageV2({
      sessionId: SESSION_ID,
      userId: USER_ID,
      role: 'assistant',
      content: [
        { type: 'reasoning', text: '先看一下改动涉及的接口，再决定怎么回复。' },
        {
          type: 'tool_call',
          toolCallId: 'call-1',
          toolName: 'read_file',
          input: { path: 'src/index.ts' },
        },
        {
          type: 'tool_result',
          toolCallId: 'call-1',
          output: 'export const x = 1;',
          isError: false,
        },
        { type: 'text', text: '已修复接口签名，CI 应已恢复。' },
      ],
    });

    expect(extractFinalAssistantText(SESSION_ID, USER_ID)).toBe('已修复接口签名，CI 应已恢复。');
  });

  it('只有 reasoning 时返回空串（回写方据此跳过外发）', () => {
    messageAdapter.appendSessionMessageV2({
      sessionId: SESSION_ID,
      userId: USER_ID,
      role: 'assistant',
      content: [{ type: 'reasoning', text: '分析了一圈，最后决定不改动。' }],
    });

    expect(extractFinalAssistantText(SESSION_ID, USER_ID)).toBe('');
  });

  it('跳过无正文的末条，回退到更早一条有正文的 assistant', () => {
    messageAdapter.appendSessionMessageV2({
      sessionId: SESSION_ID,
      userId: USER_ID,
      role: 'assistant',
      content: [{ type: 'text', text: '第一轮的结论。' }],
    });
    messageAdapter.appendSessionMessageV2({
      sessionId: SESSION_ID,
      userId: USER_ID,
      role: 'assistant',
      content: [{ type: 'reasoning', text: '第二轮只想了没说话。' }],
    });

    expect(extractFinalAssistantText(SESSION_ID, USER_ID)).toBe('第一轮的结论。');
  });
});
