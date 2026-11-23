import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import {
  CONFIRM_NODE_ID,
  needsConfirmation,
  parseGrillState,
  type GrillState,
} from '@openAwork/agent-core';
import authPlugin from '../infra/auth.js';
import { closeDb, connectDb, migrate, sqliteGet, sqliteRun } from '../infra/db.js';
import requestWorkflowPlugin from '../runtime/request-workflow.js';
import { questionsRoutes } from '../routes/questions.js';
import {
  buildExitPlanModeQuestionInput,
  EXIT_PLAN_MODE_APPROVE_LABEL,
} from '../tools/plan-mode-tools.js';
import { assert, withTempEnv } from './task-verification-helpers.js';

const GRILL_QUESTIONS = [
  {
    header: '目标',
    question: '目标是什么？',
    nodeId: 'goal',
    round: 0,
    options: [
      { label: '改单文件', description: '范围清晰', recommended: true },
      { label: '跨模块', description: '涉及多模块' },
    ],
  },
  {
    header: '约束',
    question: '有什么约束？',
    nodeId: 'constraint',
    round: 0,
    options: [
      { label: '无约束', description: '按最佳实践', recommended: true },
      { label: '必须兼容', description: '仅加法变更' },
    ],
  },
  {
    header: '交付物',
    question: '交付物形态？',
    nodeId: 'deliverable',
    round: 0,
    options: [
      { label: '代码变更', description: '可直接运行', recommended: true },
      { label: '仅方案', description: '先不写代码' },
    ],
  },
  {
    header: '验收',
    question: '如何判定正确？',
    nodeId: 'acceptance',
    round: 0,
    options: [
      { label: '测试通过', description: '用现有测试', recommended: true },
      { label: '需新测试', description: '补测试' },
    ],
  },
];

const CONFIRM_QUESTION = [
  {
    header: '制定方案',
    question: '是否将以上共识整理成实施方案？',
    nodeId: CONFIRM_NODE_ID,
    round: 1,
    options: [
      { label: '确认并制定方案', description: '确认当前共识并起草方案', recommended: true },
      { label: '暂不制定', description: '停在当前讨论结论' },
      { label: '继续讨论', description: '仍有未决项' },
    ],
  },
];

function insertPendingRequest(input: {
  sessionId: string;
  userId: string;
  questions: unknown[];
  toolName?: 'question' | 'ExitPlanMode';
}): string {
  const requestId = randomUUID();
  sqliteRun(
    `INSERT INTO question_requests (id, session_id, user_id, tool_name, title, questions_json, status)
     VALUES (?, ?, ?, ?, 'Question', ?, 'pending')`,
    [
      requestId,
      input.sessionId,
      input.userId,
      input.toolName ?? 'question',
      JSON.stringify(input.questions),
    ],
  );
  return requestId;
}

function readSessionMetadata(sessionId: string): {
  clarificationState?: string;
  dialogueMode?: string;
  dialogueModeSwitch?: { from?: string; reason?: string; to?: string };
  planMode?: boolean;
} {
  const row = sqliteGet<{ metadata_json: string }>(
    'SELECT metadata_json FROM sessions WHERE id = ? LIMIT 1',
    [sessionId],
  );
  assert(row !== undefined, 'session row should exist');
  return JSON.parse(row.metadata_json) as {
    clarificationState?: string;
    dialogueMode?: string;
    dialogueModeSwitch?: { from?: string; reason?: string; to?: string };
    planMode?: boolean;
  };
}

function readClarificationState(sessionId: string): GrillState {
  const metadata = readSessionMetadata(sessionId);
  assert(
    typeof metadata.clarificationState === 'string',
    'clarificationState should be persisted to session metadata',
  );
  const state = parseGrillState(metadata.clarificationState);
  assert(state !== null, 'clarificationState should parse as a valid GrillState');
  return state;
}

async function main(): Promise<void> {
  await withTempEnv({ DATABASE_URL: ':memory:' }, async () => {
    await connectDb();
    await migrate();

    const userId = randomUUID();
    const sessionId = randomUUID();
    const email = `grill-${userId}@openawork.local`;

    sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
      userId,
      email,
      'hash',
    ]);
    sqliteRun(
      `INSERT INTO sessions (id, user_id, messages_json, metadata_json) VALUES (?, ?, '[]', ?)`,
      [sessionId, userId, JSON.stringify({ dialogueMode: 'clarify', planMode: true })],
    );

    const app = Fastify();
    await app.register(requestWorkflowPlugin);
    await app.register(authPlugin);
    await app.register(questionsRoutes);
    await app.ready();

    try {
      const token = app.jwt.sign({ sub: userId, email });
      const reply = (requestId: string, answers: string[][]) =>
        app.inject({
          method: 'POST',
          url: `/sessions/${sessionId}/questions/reply`,
          headers: { authorization: `Bearer ${token}` },
          payload: { requestId, status: 'answered', answers },
        });

      const round0 = insertPendingRequest({ sessionId, userId, questions: GRILL_QUESTIONS });

      // V-06 的「pending 列表」判定项：一轮返回整个 frontier（≥2 张卡片），
      // 且每题恰好可被用户"确认"——即至少一个 recommended 选项 + 稳定的 nodeId。
      const pendingRes = await app.inject({
        method: 'GET',
        url: `/sessions/${sessionId}/questions/pending`,
        headers: { authorization: `Bearer ${token}` },
      });
      assert(pendingRes.statusCode === 200, 'pending questions route should succeed');
      const pendingBody: {
        requests: Array<{
          questions: Array<{
            nodeId?: string;
            options?: Array<{ recommended?: boolean }>;
          }>;
        }>;
      } = pendingRes.json();
      const pendingQuestions = pendingBody.requests.flatMap((entry) => entry.questions);
      assert(
        pendingQuestions.length >= 2,
        `frontier batch should expose >=2 question cards, got ${pendingQuestions.length}`,
      );
      for (const question of pendingQuestions) {
        assert(
          question.options?.some((option) => option.recommended === true) === true,
          'every frontier question must carry at least one recommended option',
        );
        assert(
          typeof question.nodeId === 'string' && question.nodeId.length > 0,
          'every frontier question must carry a nodeId for round bookkeeping',
        );
      }

      const round0Res = await reply(round0, [['改单文件'], ['无约束'], ['代码变更'], ['测试通过']]);
      assert(round0Res.statusCode === 200, 'round 0 reply should succeed');

      const afterRound0 = readClarificationState(sessionId);
      for (const nodeId of ['goal', 'constraint', 'deliverable', 'acceptance']) {
        assert(
          afterRound0.nodes.find((node) => node.id === nodeId)?.answer !== undefined,
          `node ${nodeId} should be settled after round 0`,
        );
      }
      assert(
        afterRound0.nodes.some((node) => node.id === CONFIRM_NODE_ID),
        'confirm node should exist after seeding',
      );
      assert(afterRound0.confirmedAt === undefined, 'should not be confirmed before confirmation');
      assert(
        needsConfirmation(afterRound0),
        'frontier should be the confirm node only → confirmation required',
      );

      const rejectRequest = insertPendingRequest({
        sessionId,
        userId,
        questions: CONFIRM_QUESTION,
      });
      const rejectRes = await reply(rejectRequest, [['暂不制定']]);
      assert(rejectRes.statusCode === 200, 'rejection reply should succeed');

      const afterReject = readClarificationState(sessionId);
      assert(afterReject.confirmedAt === undefined, 'rejection must not set confirmedAt');
      assert(
        readSessionMetadata(sessionId).dialogueMode === 'clarify',
        'rejection must not auto-switch the dialogue mode',
      );
      assert(
        afterReject.nodes.find((node) => node.id === CONFIRM_NODE_ID)?.answer === undefined,
        'rejection must not settle the confirm node',
      );
      assert(
        needsConfirmation(afterReject),
        'confirmation should still be required after rejection',
      );

      const confirmRequest = insertPendingRequest({
        sessionId,
        userId,
        questions: CONFIRM_QUESTION,
      });
      const confirmRes = await reply(confirmRequest, [['确认并制定方案']]);
      assert(confirmRes.statusCode === 200, 'confirmation reply should succeed');

      const afterConfirm = readClarificationState(sessionId);
      assert(
        typeof afterConfirm.confirmedAt === 'number',
        'confirmation via the recommended option label must set confirmedAt',
      );
      assert(
        afterConfirm.nodes.find((node) => node.id === CONFIRM_NODE_ID)?.answer === '确认并制定方案',
        'confirm node should record the chosen label',
      );
      assert(
        !needsConfirmation(afterConfirm),
        'confirmation must clear the needsConfirmation gate',
      );

      const confirmBody: { dialogueMode?: string } = confirmRes.json();
      assert(
        confirmBody.dialogueMode === undefined,
        'consensus confirmation should not return a dialogue mode switch',
      );
      const afterConfirmMetadata = readSessionMetadata(sessionId);
      assert(
        afterConfirmMetadata.dialogueMode === 'clarify',
        'session should stay in clarify after consensus confirmation',
      );
      assert(afterConfirmMetadata.planMode === true, 'plan mode should still be active');

      const exitPlanRequest = insertPendingRequest({
        sessionId,
        userId,
        toolName: 'ExitPlanMode',
        questions: buildExitPlanModeQuestionInput({ plan: '改单文件并运行现有测试' }).questions,
      });
      const exitPlanRes = await reply(exitPlanRequest, [[EXIT_PLAN_MODE_APPROVE_LABEL]]);
      assert(exitPlanRes.statusCode === 200, 'ExitPlanMode approval reply should succeed');
      const exitPlanBody: { dialogueMode?: string } = exitPlanRes.json();
      assert(exitPlanBody.dialogueMode === 'coding', 'approval reply should return coding mode');

      const afterApprovalMetadata = readSessionMetadata(sessionId);
      assert(
        afterApprovalMetadata.dialogueMode === 'coding',
        'session should switch to coding after ExitPlanMode approval',
      );
      assert(afterApprovalMetadata.planMode === false, 'approval should clear plan mode');
      assert(
        afterApprovalMetadata.dialogueModeSwitch?.reason === 'plan_approved',
        'mode switch should record plan approval as its reason',
      );

      console.log('verify-grill-end-to-end: ok');
    } finally {
      await app.close();
      await closeDb();
    }
  });
}

void main().catch((error) => {
  console.error('verify-grill-end-to-end: failed');
  console.error(error);
  process.exitCode = 1;
});
