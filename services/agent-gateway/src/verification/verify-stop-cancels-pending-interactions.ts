/**
 * 停止 = 整段断掉：`/stream/stop` 与 `/stream/stop-active` 必须连带作废
 * 该回合 / 该会话的待审批、待回答交互，并把会话状态收敛回 idle。
 *
 * 背景：权限暂停会以 `done(tool_permission)` 结束当前流并把 pending 交互留在库里；
 * `reconcileSessionStateStatus` 只要看到 pending 交互就会把会话保持为 `paused`。
 * 若「停止」只 abort 在途流、不清理 pending，用户点停止后审批卡仍挂着，
 * 会话永远停在等待审批——停止与审批互相卡住。
 *
 * 本脚本断言：
 *   1. `/stream/stop`：pending 权限 → rejected、pending 提问 → dismissed、
 *      对应未读通知 → read、发布 permission_replied / question_replied 运行事件、
 *      会话状态 → idle；
 *   2. `/stream/stop-active`：会话级清扫同样成立（含无在途流的场景）。
 */
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import authPlugin from '../infra/auth.js';
import { closeDb, connectDb, migrate, sqliteGet, sqliteRun } from '../infra/db.js';
import requestWorkflowPlugin from '../runtime/request-workflow.js';
import { permissionsRoutes } from '../routes/permissions.js';
import { questionsRoutes } from '../routes/questions.js';
import { streamRoutes } from '../routes/stream-routes-plugin.js';
import { assert, withTempEnv } from './task-verification-helpers.js';

const CLIENT_REQUEST_ID = 'stop-cancel-req-1';

interface PendingFixture {
  notificationId: string;
  permissionId: string;
  questionId: string;
}

function insertPendingInteractions(input: {
  sessionId: string;
  userId: string;
  clientRequestId: string;
}): PendingFixture {
  const permissionId = randomUUID();
  sqliteRun(
    `INSERT INTO permission_requests
     (id, session_id, tool_name, scope, reason, risk_level, preview_action, request_payload_json, status)
     VALUES (?, ?, 'bash', 'echo hi', '需要执行命令', 'medium', 'run echo hi', ?, 'pending')`,
    [permissionId, input.sessionId, JSON.stringify({ clientRequestId: input.clientRequestId })],
  );

  const questionId = randomUUID();
  sqliteRun(
    `INSERT INTO question_requests
     (id, session_id, user_id, tool_name, title, questions_json, request_payload_json, status)
     VALUES (?, ?, ?, 'question', '请选择继续方式', '[]', ?, 'pending')`,
    [
      questionId,
      input.sessionId,
      input.userId,
      JSON.stringify({ clientRequestId: input.clientRequestId }),
    ],
  );

  const notificationId = randomUUID();
  sqliteRun(
    `INSERT INTO notifications (id, user_id, session_id, event_type, title, body, status)
     VALUES (?, ?, ?, 'permission_asked', '权限申请', ?, 'unread')`,
    [notificationId, input.userId, input.sessionId, `requestId=${permissionId}\n请审批`],
  );

  return { notificationId, permissionId, questionId };
}

function assertInteractionsCleared(input: { fixture: PendingFixture; sessionId: string }): void {
  const permissionRow = sqliteGet<{ status: string; decision: string | null }>(
    'SELECT status, decision FROM permission_requests WHERE id = ?',
    [input.fixture.permissionId],
  );
  assert(
    permissionRow?.status === 'rejected' && permissionRow.decision === 'reject',
    `pending permission must be rejected after stop, got ${JSON.stringify(permissionRow)}`,
  );

  const questionRow = sqliteGet<{ status: string }>(
    'SELECT status FROM question_requests WHERE id = ?',
    [input.fixture.questionId],
  );
  assert(
    questionRow?.status === 'dismissed',
    `pending question must be dismissed after stop, got ${JSON.stringify(questionRow)}`,
  );

  const notificationRow = sqliteGet<{ status: string }>(
    'SELECT status FROM notifications WHERE id = ?',
    [input.fixture.notificationId],
  );
  assert(
    notificationRow?.status === 'read',
    `permission notification must be marked read after stop, got ${JSON.stringify(notificationRow)}`,
  );

  const permissionReplied = sqliteGet<{ id: number }>(
    `SELECT id FROM session_run_events
     WHERE session_id = ? AND event_type = 'permission_replied' LIMIT 1`,
    [input.sessionId],
  );
  assert(
    permissionReplied !== null,
    'permission_replied run event must be published for the cancelled permission',
  );

  const questionReplied = sqliteGet<{ id: number }>(
    `SELECT id FROM session_run_events
     WHERE session_id = ? AND event_type = 'question_replied' LIMIT 1`,
    [input.sessionId],
  );
  assert(
    questionReplied !== null,
    'question_replied run event must be published for the dismissed question',
  );
}

async function main(): Promise<void> {
  await withTempEnv({ DATABASE_URL: ':memory:' }, async () => {
    await connectDb();
    await migrate();

    const app = Fastify();
    await app.register(requestWorkflowPlugin);
    await app.register(authPlugin);
    await app.register(websocket);
    await app.register(permissionsRoutes);
    await app.register(questionsRoutes);
    await app.register(streamRoutes);
    await app.ready();

    try {
      const userId = randomUUID();
      const sessionId = randomUUID();
      const email = `stop-cancel-${userId}@openawork.local`;
      sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
        userId,
        email,
        'hash',
      ]);
      sqliteRun(
        `INSERT INTO sessions (id, user_id, messages_json, metadata_json, state_status)
         VALUES (?, ?, '[]', '{}', 'paused')`,
        [sessionId, userId],
      );
      const accessToken = app.jwt.sign({ sub: userId, email });

      // ── 1. 回合级停止：/stream/stop ───────────────────────────────
      const turnFixture = insertPendingInteractions({
        clientRequestId: CLIENT_REQUEST_ID,
        sessionId,
        userId,
      });

      const turnStopRes = await app.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/stream/stop`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { clientRequestId: CLIENT_REQUEST_ID },
      });
      assert(turnStopRes.statusCode === 200, 'stream stop route should succeed');
      const turnStopBody = JSON.parse(turnStopRes.body) as {
        cancelledPermissions: number;
        cancelledQuestions: number;
        stopped: boolean;
      };
      assert(
        turnStopBody.stopped === false,
        'fixture has no in-flight stream — stop must report stopped=false but still clean up',
      );
      assert(
        turnStopBody.cancelledPermissions === 1,
        `stream stop must cancel the turn permission, got ${turnStopBody.cancelledPermissions}`,
      );
      assert(
        turnStopBody.cancelledQuestions === 1,
        `stream stop must cancel the turn question, got ${turnStopBody.cancelledQuestions}`,
      );
      assertInteractionsCleared({ fixture: turnFixture, sessionId });

      const sessionAfterTurnStop = sqliteGet<{ state_status: string }>(
        'SELECT state_status FROM sessions WHERE id = ?',
        [sessionId],
      );
      assert(
        sessionAfterTurnStop?.state_status === 'idle',
        `session must reconcile to idle after turn stop, got ${sessionAfterTurnStop?.state_status}`,
      );

      // ── 2. 会话级停止：/stream/stop-active ────────────────────────
      // 重置回 paused 并再挂一组 pending，验证会话级清扫独立成立。
      sqliteRun('UPDATE sessions SET state_status = ? WHERE id = ?', ['paused', sessionId]);
      const sessionFixture = insertPendingInteractions({
        clientRequestId: 'stop-cancel-req-2',
        sessionId,
        userId,
      });

      const sessionStopRes = await app.inject({
        method: 'POST',
        url: `/sessions/${sessionId}/stream/stop-active`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      assert(sessionStopRes.statusCode === 200, 'stream stop-active route should succeed');
      const sessionStopBody = JSON.parse(sessionStopRes.body) as {
        cancelledPermissions: number;
        cancelledQuestions: number;
        stopped: boolean;
      };
      assert(sessionStopBody.stopped === false, 'fixture has no in-flight stream to abort');
      assert(
        sessionStopBody.cancelledPermissions === 1 && sessionStopBody.cancelledQuestions === 1,
        `stop-active must cancel all pending interactions, got ${JSON.stringify(sessionStopBody)}`,
      );
      assertInteractionsCleared({ fixture: sessionFixture, sessionId });

      const sessionAfterStopActive = sqliteGet<{ state_status: string }>(
        'SELECT state_status FROM sessions WHERE id = ?',
        [sessionId],
      );
      assert(
        sessionAfterStopActive?.state_status === 'idle',
        `session must reconcile to idle after stop-active, got ${sessionAfterStopActive?.state_status}`,
      );

      console.log('verify-stop-cancels-pending-interactions: ok');
    } finally {
      await closeDb();
    }
  });
}

void main();
