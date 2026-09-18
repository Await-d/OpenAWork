/**
 * 260914 · V-13：pm1（c 层）grill 多轮 + 确认门控端到端验收。
 *
 * 断言链（对齐 260914 文档 V-13）：
 *   1. 高影响意图触发 grill，决策树播种到 pm1 session metadata（4 维 + 1 确认节点）
 *   2. 回答整个 frontier 后进入 `awaiting_confirmation`，且**未**进入 drafting_plan、无 plan 产物
 *   3. `需修改` 不写 confirmedAt，确认题以新的轮次化 id 重提；`确认` 才写 confirmedAt 并推进
 *   4. 收口后 plan/tasks 产物与 handoff result 写入、session 未重启
 */

import { randomUUID } from 'node:crypto';
import { closeDb, connectDb, migrate, sqliteGet, sqliteRun } from '../infra/db.js';
import { runArtifactChain } from '../handoff/runner/artifact-chain.js';
import {
  confirmTransportQuestionId,
  readPm1GrillTask,
} from '../handoff/runner/pm1-grill-runner.js';
import { createHandoff } from '../handoff/store/handoff-store.js';
import { submitInboundMessage } from '../handoff/store/inbound-store.js';
import { assert, waitFor, withTempEnv } from './task-verification-helpers.js';

const HIGH_IMPACT_INTENT = '重构整个系统架构并把数据迁移到 Postgres';
const FRONTIER_NODE_IDS = ['goal', 'constraint', 'deliverable', 'acceptance'];
const CONFIRM_NODE_ID = '__grill_confirm__';

const PLANNING_REPLY_BY_STAGE = [
  {
    marker: '功能规格文档',
    content:
      '# 规格\n\n### 用户故事 1 — OAuth 登录\n\n作为用户我想登录\n\n**验收场景**：给定登录页，当输入有效凭据，则完成登录\n\n### 边界情况\n\n- 网络异常时显示错误\n\n## 验收场景覆盖矩阵\n\n| 用户故事 | 场景编号 | 场景摘要 | 对应需求 | 预期验证方式 | 预期证据 |\n|---|---|---|---|---|---|\n| US1 | AC-1 | 登录 | FR-001 | API 测试 | 响应 |\n\n## 需求\n\n- **FR-001**: 系统必须支持 OAuth\n\n## 成功标准\n\n- **SC-001**: 登录成功率达标',
  },
  {
    marker: '实施计划',
    content:
      '# 实施计划\n\n## 技术上下文\n\nTypeScript + React\n\n## 宪法对齐检查\n\n| 宪法条目 | 本计划是否符合 | 备注 |\n|---|---|---|\n| 禁止空 catch | ✅ | 所有 catch 有日志 |\n\n## 项目结构\n\n```text\nsrc/index.ts\n```\n\n## 复杂度评估\n\n| 维度 | 评估 |\n|---|---|\n| 影响文件数 | 1 |\n\n## 风险与缓解\n\n| 风险 | 缓解措施 |\n|---|---|\n| 网络失败 | 重试 |\n\n## 验收场景实施映射\n\n| 场景编号 | 实现模块/文件 | 分层路径 | 验证方式 | 交付证据 |\n|---|---|---|---|---|\n| AC-1 | src/index.ts | API | 测试 | 响应 |\n\n## 架构守卫\n\n- 保持分层',
  },
  {
    marker: '任务清单',
    content:
      '# 任务清单\n\n## Phase 1\n\n- [ ] T001 [KIND:feat] [SURFACE:gateway] [src/index.ts] 实现 OAuth 回调 - 登录成功\n\n**文件**：\n- Modify: `src/index.ts`\n\n**检查点**：\n- [ ] 测试通过',
  },
] as const;

function planningReply(system: string): string {
  return PLANNING_REPLY_BY_STAGE.find((stage) => system.includes(stage.marker))?.content ?? '# x';
}

function countArtifacts(sessionId: string, phase: string): number {
  return (
    sqliteGet<{ c: number }>(
      'SELECT COUNT(*) AS c FROM artifacts WHERE session_id = ? AND phase = ?',
      [sessionId, phase],
    )?.c ?? 0
  );
}

async function main(): Promise<void> {
  await withTempEnv(
    {
      DATABASE_URL: ':memory:',
      OPENAWORK_APP_VERSION: '0.0.0-verify',
      OPENAWORK_TEAM_INBOUND_POLL_MS: '20',
      OPENAWORK_TEAM_CLARIFICATION_TIMEOUT_MS: '1500',
    },
    async () => {
      await connectDb();
      await migrate();

      const userId = randomUUID();
      const pm1SessionId = randomUUID();
      const receptionSessionId = randomUUID();

      sqliteRun("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
        userId,
        `grill-pm1-${userId}@openawork.local`,
      ]);
      sqliteRun(
        `INSERT INTO sessions (id, user_id, title, metadata_json, role_layer, state_status)
         VALUES (?, ?, 'pm1', '{}', 'pm1', 'idle')`,
        [pm1SessionId, userId],
      );
      sqliteRun(
        `INSERT INTO sessions (id, user_id, title, metadata_json, role_layer, state_status)
         VALUES (?, ?, 'reception', '{}', 'reception', 'idle')`,
        [receptionSessionId, userId],
      );

      const handoff = createHandoff({
        userId,
        fromSessionId: receptionSessionId,
        fromRoleLayer: 'reception',
        toRoleLayer: 'pm1',
        payload: { intent: HIGH_IMPACT_INTENT },
      });

      const answer = (questionId: string, text: string): void => {
        submitInboundMessage({
          userId,
          toSessionId: pm1SessionId,
          fromRoleLayer: 'reception',
          messageType: 'clarification_answer',
          payload: { questionId, answer: text, answeredAt: Date.now() },
        });
      };

      try {
        const runPromise = runArtifactChain({
          userId,
          sessionId: pm1SessionId,
          handoff,
          sourceIntent: HIGH_IMPACT_INTENT,
          rewrittenIntent: HIGH_IMPACT_INTENT,
          teamWorkspaceId: null,
          callLlm: async (system) => planningReply(system),
        });

        await waitFor(
          () => readPm1GrillTask(pm1SessionId) !== null,
          'grill state should be persisted',
        );
        const seeded = readPm1GrillTask(pm1SessionId)?.state ?? null;
        assert(seeded !== null, 'grill state should be readable');
        assert(
          seeded.nodes.length === FRONTIER_NODE_IDS.length + 1,
          `seed should be ${FRONTIER_NODE_IDS.length} dimensions + 1 confirm node, got ${seeded.nodes.length}`,
        );

        const readGrillState = () => readPm1GrillTask(pm1SessionId)?.state ?? null;

        for (const id of FRONTIER_NODE_IDS) answer(id, `已定：${id}`);

        await waitFor(() => {
          const state = readGrillState();
          if (!state) return false;
          return FRONTIER_NODE_IDS.every(
            (id) => state.nodes.find((node) => node.id === id)?.answer !== undefined,
          );
        }, 'all frontier nodes should be settled');
        await waitFor(
          () =>
            sqliteGet<{ substate: string | null }>('SELECT substate FROM sessions WHERE id = ?', [
              pm1SessionId,
            ])?.substate === 'awaiting_confirmation',
          'substate should become awaiting_confirmation once frontier is empty',
        );

        assert(
          countArtifacts(pm1SessionId, 'plan') === 0,
          'no plan artifact may be produced before explicit confirmation',
        );
        const beforeConfirm = readGrillState();
        assert(
          beforeConfirm !== null && beforeConfirm.confirmedAt === undefined,
          'confirmedAt must stay unset before explicit confirmation',
        );

        const firstConfirmQuestionId = confirmTransportQuestionId(beforeConfirm);
        assert(
          firstConfirmQuestionId !== CONFIRM_NODE_ID,
          'confirm question must carry a round-scoped transport id so the UI can re-ask it',
        );

        answer(firstConfirmQuestionId, '再改改');
        await waitFor(() => {
          const state = readGrillState();
          return state !== null && beforeConfirm !== null && state.round > beforeConfirm.round;
        }, 'rejection must advance the round');
        const afterReject = readGrillState();
        assert(
          afterReject !== null && afterReject.confirmedAt === undefined,
          'rejection must not set confirmedAt',
        );
        assert(
          countArtifacts(pm1SessionId, 'plan') === 0,
          'rejection must not unblock plan generation',
        );

        assert(afterReject !== null, 'grill state should still be readable after rejection');
        const secondConfirmQuestionId = confirmTransportQuestionId(afterReject);
        assert(
          secondConfirmQuestionId !== firstConfirmQuestionId,
          're-asked confirm question must use a fresh transport id',
        );
        answer(secondConfirmQuestionId, '确认');
        await runPromise;

        assert(countArtifacts(pm1SessionId, 'spec') === 1, 'spec artifact should exist');
        assert(
          countArtifacts(pm1SessionId, 'plan') === 1,
          'plan artifact should exist after confirm',
        );
        assert(
          countArtifacts(pm1SessionId, 'tasks') === 1,
          'tasks artifact should exist after confirm',
        );
        const finalGrill = readPm1GrillTask(pm1SessionId);
        assert(
          typeof finalGrill?.state.confirmedAt === 'number',
          'confirmed consensus must be retained for later revisions (G5)',
        );

        const finalSubstate = sqliteGet<{ substate: string | null }>(
          'SELECT substate FROM sessions WHERE id = ?',
          [pm1SessionId],
        );
        assert(
          finalSubstate?.substate === 'completed',
          `expected completed, got ${finalSubstate?.substate}`,
        );

        const handoffRow = sqliteGet<{ result_json: string | null }>(
          'SELECT result_json FROM handoff_records WHERE id = ?',
          [handoff.id],
        );
        assert(handoffRow?.result_json !== null, 'handoff result should be written');

        const sessionCount = sqliteGet<{ c: number }>('SELECT COUNT(*) AS c FROM sessions')?.c ?? 0;
        assert(
          sessionCount === 2,
          `grill must not restart the session (expected 2, got ${sessionCount})`,
        );

        console.log('verify-team-pm1-multiround: ok');
      } finally {
        await closeDb();
      }
    },
  );
}

void main().catch((error) => {
  console.error('verify-team-pm1-multiround: failed');
  console.error(error);
  process.exitCode = 1;
});
