/**
 * 回归测试：ToolSandbox 不得在「whitelist / clarify-mode」门控处拦下团队层内置指令。
 *
 * 背景 bug：reception 层 LLM 被注入了 reply_direct 工具（apply-team-layer-tools），
 * 调用时却命中 tool-sandbox 的 `Tool "reply_direct" is not allowed`（whitelist 门控）
 * 或 `is not enabled for this session`（reception 默认 dialogueMode=clarify 门控），
 * 在派发到 invokeInstruction 之前就被拒，导致直答能力完全不可用。
 *
 * 修复：tool-sandbox 像对待 flat MCP 工具那样隐式放行内置指令名，
 * 真正的「能不能调」由下游 invokeInstruction → assertInstructionOwnedByLayer 按层校验。
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as ToolSandboxModule from '../../tools/tool-sandbox.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let toolSandboxModule: typeof ToolSandboxModule;

const USER_ID = 'u-sandbox-gate';
const SESSION_ID = 's-sandbox-gate';

function seedUser(): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    'sandbox-gate@example.com',
  ]);
}

/**
 * 创建一条 reception 团队 session，metadata 带默认 dialogueMode=clarify，
 * 复现「直答指令 + clarify 模式」这组真实组合。
 */
function seedReceptionSession(): void {
  dbModule.sqliteRun(
    `INSERT OR REPLACE INTO sessions (id, user_id, title, metadata_json, role_layer)
     VALUES (?, ?, 'demo', ?, 'reception')`,
    [SESSION_ID, USER_ID, JSON.stringify({ dialogueMode: 'clarify' })],
  );
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  toolSandboxModule = await import('../../tools/tool-sandbox.js');
  // 确保内置指令已注册（registry 被填充）。
  await import('../../handoff/capability/builtin-instructions-impl.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM message_v2', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser();
  seedReceptionSession();
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('ToolSandbox 门控放行团队层内置指令', () => {
  it('reception 调 reply_direct → 不被门控拦下，派发执行成功', async () => {
    const sandbox = new toolSandboxModule.ToolSandbox();

    const result = await sandbox.execute(
      {
        toolCallId: 'call-reply-direct',
        toolName: 'reply_direct',
        rawInput: { text: '你好，这是直接回答。' },
      },
      new AbortController().signal,
      SESSION_ID,
    );

    // 不应再出现 whitelist / clarify-mode 门控拒绝。
    expect(result.output).not.toMatch(/is not allowed/);
    expect(result.output).not.toMatch(/is not enabled for this session/);
    expect(result.isError).toBe(false);

    // 指令实际执行：reply_direct 把回答写回消息流。
    const msgCount = dbModule.sqliteGet<{ c: number }>(
      `SELECT COUNT(*) AS c FROM message_v2 WHERE session_id = ?`,
      [SESSION_ID],
    );
    expect(msgCount?.c).toBeGreaterThanOrEqual(1);
  }, 15_000);

  it('未注册的工具名仍被 whitelist 门控拒绝（防回归过度放行）', async () => {
    const sandbox = new toolSandboxModule.ToolSandbox();

    const result = await sandbox.execute(
      {
        toolCallId: 'call-bogus',
        toolName: 'totally_unknown_tool_xyz',
        rawInput: {},
      },
      new AbortController().signal,
      SESSION_ID,
    );

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/is not allowed/);
  }, 15_000);
});
