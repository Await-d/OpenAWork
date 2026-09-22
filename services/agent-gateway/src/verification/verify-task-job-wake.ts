/**
 * T-24（先行验收）：唤醒原语 —— 从既有历史继续执行，不新增用户轮。
 *
 * 锁定「单通道交付」的两条核心不变量：
 *   G1  唤醒**不得**持久化用户轮（现状 `task-auto-resume` 伪造用户请求的替代物）
 *   G2  已落库的合成通知**必须**被模型看到（下发上游时降级为 user）
 * 另覆盖：通知不被重复写入、唤醒真实发起上游请求、产生 assistant 响应。
 */
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import {
  assert,
  createProtocolAwareStream,
  readFetchBody,
  readLastUserMessage,
  TASK_TOOL_TEST_ENV,
  withMockFetch,
  withTempEnv,
} from './task-verification-helpers.js';

const NOTICE_TEXT = '子代理已完成 · 审计会话唤醒原语';
const NOTICE_DESCRIPTION = '审计会话唤醒原语';
const ASSISTANT_REPLY = '收到子代理结果，继续推进。';

async function main(): Promise<void> {
  const workspaceRoot = `/tmp/openawork-task-job-wake-${randomUUID()}`;
  let upstreamRequestCount = 0;
  let lastUserMessageSeenByModel = '';

  await withTempEnv({ ...TASK_TOOL_TEST_ENV, WORKSPACE_ROOT: workspaceRoot }, async () => {
    await withMockFetch(
      async (input, init) => {
        upstreamRequestCount += 1;
        const body = await readFetchBody(input, init);
        lastUserMessageSeenByModel = readLastUserMessage(body);
        return createProtocolAwareStream(input, ASSISTANT_REPLY);
      },
      async () => {
        const [dbModule, injectionModule, streamRuntime, adapter] = await Promise.all([
          import('../infra/db.js'),
          import('../message/synthetic-message-injection.js'),
          import('../routes/stream-runtime.js'),
          import('../message/message-v2-adapter.js'),
        ]);

        await dbModule.connectDb();
        await dbModule.migrate();

        const userId = randomUUID();
        const sessionId = randomUUID();
        dbModule.sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
          userId,
          `task-job-wake-${userId}@openawork.local`,
          'hash',
        ]);
        dbModule.sqliteRun(
          `INSERT INTO sessions (id, user_id, messages_json, metadata_json, state_status)
           VALUES (?, ?, '[]', '{}', 'idle')`,
          [sessionId, userId],
        );

        const notificationId = `task-job:${randomUUID()}`;
        injectionModule.injectSyntheticSessionMessage({
          sessionId,
          userId,
          notificationId,
          text: NOTICE_TEXT,
          description: NOTICE_DESCRIPTION,
          metadata: { source: 'subagent', childID: 'child-1', agent: 'explore', state: 'done' },
        });

        const before = adapter.listSessionMessagesV2({ sessionId, userId });
        const userBefore = before.filter((message) => message.role === 'user').length;
        assert(before.length === 1, `通知入库后应恰好 1 条消息，实际 ${before.length}`);
        assert(before[0]?.role === 'synthetic', '入库消息应为 synthetic 角色');

        // ── 唤醒：从既有历史继续 ───────────────────────────────────────
        const result = await streamRuntime.continueSessionFromHistory({
          clientRequestId: notificationId,
          sessionId,
          userId,
        });

        assert(result.statusCode === 200, `唤醒应成功，实际 statusCode=${result.statusCode}`);

        const after = adapter.listSessionMessagesV2({ sessionId, userId });
        const userAfter = after.filter((message) => message.role === 'user').length;

        // G1：不得新增用户轮
        assert(
          userAfter === userBefore,
          `唤醒不得新增用户轮（前 ${userBefore} → 后 ${userAfter}）`,
        );
        // 通知不得被重复写入
        assert(
          after.filter((message) => message.role === 'synthetic').length === 1,
          '唤醒不得重复写入 synthetic 通知',
        );
        // 唤醒确实产生了 assistant 响应
        assert(
          after.some((message) => message.role === 'assistant'),
          '唤醒应产生 assistant 响应',
        );
        // 真实发起上游请求
        assert(upstreamRequestCount >= 1, '唤醒应真实发起上游请求');
        // G2：模型请求里能看到通知正文（合成通知降级为 user 后进入上下文）
        assert(
          lastUserMessageSeenByModel.includes('子代理已完成'),
          `模型请求应能看到通知正文，实际最后一条 user 消息=${lastUserMessageSeenByModel.slice(0, 160)}`,
        );

        // 幂等：同一通知身份重复唤醒不得再新增用户轮或重复通知
        const second = await streamRuntime.continueSessionFromHistory({
          clientRequestId: notificationId,
          sessionId,
          userId,
        });
        assert(second.statusCode === 200, `重复唤醒应正常返回，实际 ${second.statusCode}`);

        const finalMessages = adapter.listSessionMessagesV2({ sessionId, userId });
        assert(
          finalMessages.filter((message) => message.role === 'user').length === userBefore,
          '重复唤醒仍不得新增用户轮',
        );
        assert(
          finalMessages.filter((message) => message.role === 'synthetic').length === 1,
          '重复唤醒仍不得重复写入通知',
        );

        console.log('verify-task-job-wake: ok');

        await dbModule.closeDb();
        rmSync(workspaceRoot, { recursive: true, force: true });
      },
    );
  });
}

void main().catch((error) => {
  console.error('verify-task-job-wake: failed');
  console.error(error);
  process.exitCode = 1;
});
