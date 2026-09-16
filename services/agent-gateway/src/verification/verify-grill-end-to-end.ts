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
    header: '确认',
    question: '以上共识是否确认？',
    nodeId: CONFIRM_NODE_ID,
    round: 1,
    options: [
      { label: '确认', description: '共识达成，进入执行', recommended: true },
      { label: '需修改', description: '仍有未决项' },
    ],
  },
];

function insertPendingRequest(input: {
  sessionId: string;
  userId: string;
  questions: unknown[];
}): string {
  const requestId = randomUUID();
  sqliteRun(
    `INSERT INTO question_requests (id, session_id, user_id, tool_name, title, questions_json, status)
     VALUES (?, ?, ?, 'question', 'Question', ?, 'pending')`,
    [requestId, input.sessionId, input.userId, JSON.stringify(input.questions)],
  );
  return requestId;
}

function readSessionMetadata(sessionId: string): {
  clarificationState?: string;
  dialogueMode?: string;
  dialogueModeSwitch?: { from?: string; reason?: string; to?: string };
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
      [sessionId, userId, JSON.stringify({ dialogueMode: 'clarify' })],
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
      const rejectRes = await reply(rejectRequest, [['需修改']]);
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
      const confirmRes = await reply(confirmRequest, [['确认']]);
      assert(confirmRes.statusCode === 200, 'confirmation reply should succeed');

      const afterConfirm = readClarificationState(sessionId);
      assert(
        typeof afterConfirm.confirmedAt === 'number',
        'confirmation via the recommended option label must set confirmedAt',
      );
      assert(
        afterConfirm.nodes.find((node) => node.id === CONFIRM_NODE_ID)?.answer === '确认',
        'confirm node should record the chosen label',
      );
      assert(
        !needsConfirmation(afterConfirm),
        'confirmation must clear the needsConfirmation gate',
      );

      // 设计已完成（共识确认）→ 会话自动切换到编程模式，并在响应里回传新模式，
      // 让前端无需额外拉取就能同步模式选择器。
      const confirmBody: { dialogueMode?: string } = confirmRes.json();
      assert(
        confirmBody.dialogueMode === 'coding',
        'confirm reply should return the auto-switched dialogue mode',
      );
      const afterConfirmMetadata = readSessionMetadata(sessionId);
      assert(
        afterConfirmMetadata.dialogueMode === 'coding',
        'session metadata dialogueMode should be switched to coding after confirmation',
      );
      assert(
        afterConfirmMetadata.dialogueModeSwitch?.reason === 'clarification_confirmed',
        'auto-switch should record its reason for observability',
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
