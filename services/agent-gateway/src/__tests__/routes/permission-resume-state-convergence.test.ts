/**
 * 审批 resume 早期失败的会话状态收敛（"批准后卡住"修复）。
 *
 * 权限 reply 路由把会话置为 running 后以 fire-and-forget 触发 resume；当 resume 在
 * `continueFromApprovedToolResult` 的 execution 兜底（其 `.catch` 负责把状态置回
 * idle）之前抛错时——requestData 解析失败、被批准工具执行崩溃——旧代码没有任何
 * 路径收敛状态：路由的 `.catch` 只记日志。会话将永远停在 running 却没有活跃流，
 * 客户端 attach 重试全部落空、恢复轮询无限循环、发送键长期禁用。
 *
 * 触发点选在 `streamRequestSchema.parse`（`resumeApprovedPermissionRequest` try 内、
 * 工具执行之前）：`message` 给数字让 zod 抛错，从而走早期失败路径而不真正执行工具。
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as StreamModule from '../../routes/stream.js';
import type * as StreamRuntimeModule from '../../routes/stream-runtime.js';
import {
  clearInFlightStreamRequest,
  registerInFlightStreamRequest,
} from '../../routes/stream-cancellation.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let streamRuntime: typeof StreamRuntimeModule;

const USER_ID = 'u-resume-converge';
const SESSION_ID = 'sess-resume-converge';
const CLIENT_REQUEST_ID = 'turn-resume-converge';

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  streamRuntime = await import('../../routes/stream-runtime.js');
}, 60000);

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM message_v2', []);
  dbModule.sqliteRun('DELETE FROM permission_requests', []);
  dbModule.sqliteRun('DELETE FROM session_runtime_threads', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  dbModule.sqliteRun("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
  // 复现 reply 路由置位后的现场：running，但 resume 即将失败。
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'resume converge', '{}', 'running')`,
    [SESSION_ID, USER_ID],
  );
});

afterAll(async () => {
  await dbModule.closeDb();
});

function readStateStatus(): string | null {
  const row = dbModule.sqliteGet<{ state_status: string }>(
    'SELECT state_status FROM sessions WHERE id = ? LIMIT 1',
    [SESSION_ID],
  );
  return row?.state_status ?? null;
}

function buildFailingPayload(): StreamModule.ApprovedPermissionResumePayload {
  return {
    clientRequestId: CLIENT_REQUEST_ID,
    nextRound: 2,
    requestData: { clientRequestId: CLIENT_REQUEST_ID, message: 123 },
    toolCallId: 'call-converge',
    toolName: 'bash',
    rawInput: { command: 'ls -la' },
    blockedToolCalls: [
      { toolCallId: 'call-converge', toolName: 'bash', rawInput: { command: 'ls -la' } },
    ],
  };
}

function expectFailingResume(): Promise<unknown> {
  return streamRuntime.resumeApprovedPermissionRequest({
    payload: buildFailingPayload(),
    sessionId: SESSION_ID,
    userId: USER_ID,
  });
}

describe('resumeApprovedPermissionRequest 早期失败的状态收敛', () => {
  it('requestData 解析失败时把卡在 running 的会话收敛回 idle', async () => {
    await expect(expectFailingResume()).rejects.toThrow();

    expect(readStateStatus()).toBe('idle');
  });

  it('仍有 pending 权限请求时收敛为 paused 而非 idle', async () => {
    dbModule.sqliteRun(
      `INSERT INTO permission_requests
         (id, session_id, tool_name, scope, reason, risk_level, status, request_payload_json)
       VALUES ('req-sibling', ?, 'bash', 'ls -la', 'r', 'medium', 'pending', ?)`,
      [SESSION_ID, JSON.stringify({ clientRequestId: CLIENT_REQUEST_ID })],
    );

    await expect(expectFailingResume()).rejects.toThrow();

    expect(readStateStatus()).toBe('paused');
  });

  it('同会话存在他人在途请求时保持 running 不误收敛', async () => {
    // 覆盖的是 `convergeSessionStateAfterFailedResume` 的「他人在途」守卫：占用方的
    // execution 必须始终留在注册表里，中途摘掉守卫就会放行、状态被收敛成 idle。
    //
    // 它走的是 zod 解析失败路径（早于 `continueFromApprovedToolResult` 里的「等待执行权
    // 让出」逻辑），因此与 resume 排队行为无关。
    const otherExecution = Promise.resolve({ statusCode: 200 });
    registerInFlightStreamRequest({
      abortController: new AbortController(),
      clientRequestId: 'other-turn',
      execution: otherExecution,
      sessionId: SESSION_ID,
      userId: USER_ID,
    });

    try {
      await expect(expectFailingResume()).rejects.toThrow();

      expect(readStateStatus()).toBe('running');
    } finally {
      clearInFlightStreamRequest({
        clientRequestId: 'other-turn',
        execution: otherExecution,
        sessionId: SESSION_ID,
      });
    }
  });
});
