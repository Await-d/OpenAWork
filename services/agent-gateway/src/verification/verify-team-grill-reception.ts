import { randomUUID } from 'node:crypto';
import { closeDb, connectDb, migrate, sqliteAll, sqliteRun } from '../infra/db.js';
import { orchestrateReceptionInput } from '../handoff/runner/reception-orchestrator.js';
import { readReceptionGrill } from '../handoff/runner/reception-grill-runner.js';
import { assert, withTempEnv } from './task-verification-helpers.js';

const GRILL_INTENT = 'refactor the entire system architecture';
const GRILL_REPLIES = ['改单文件', '无约束', '代码变更', '测试通过'];

async function main(): Promise<void> {
  await withTempEnv({ DATABASE_URL: ':memory:' }, async () => {
    await connectDb();
    await migrate();

    const userId = randomUUID();
    const sessionId = randomUUID();

    sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
      userId,
      `grill-team-${userId}@openawork.local`,
      'hash',
    ]);
    sqliteRun(
      `INSERT INTO sessions (id, user_id, messages_json, metadata_json) VALUES (?, ?, '[]', '{}')`,
      [sessionId, userId],
    );

    try {
      const start = await orchestrateReceptionInput({
        userId,
        receptionSessionId: sessionId,
        userIntent: GRILL_INTENT,
        persistMessages: false,
      });
      assert(start.reason === 'grill-started', `expected grill-started, got ${start.reason}`);
      assert(start.triggered === false, 'grill start must not dispatch a handoff');

      const seeded = readReceptionGrill(sessionId);
      assert(seeded !== null, 'grill state should be persisted to reception session metadata');
      assert(seeded.state.nodes.length === 5, 'should seed 4 dimensions + 1 confirm node');
      assert(
        seeded.intent === GRILL_INTENT,
        'original intent should be persisted for post-confirm dispatch',
      );

      let lastReason = '';
      for (const reply of GRILL_REPLIES) {
        const turn = await orchestrateReceptionInput({
          userId,
          receptionSessionId: sessionId,
          userIntent: reply,
          persistMessages: false,
        });
        lastReason = turn.reason ?? '';
      }
      assert(
        lastReason === 'grill-awaiting-confirmation',
        `expected grill-awaiting-confirmation, got ${lastReason}`,
      );

      const afterAnswers = readReceptionGrill(sessionId);
      assert(afterAnswers !== null, 'grill state should still be persisted');
      assert(
        typeof afterAnswers.state.confirmedAt !== 'number',
        'must not be confirmed before explicit confirmation',
      );

      const handoffs = sqliteAll<{ id: string }>(
        'SELECT id FROM handoff_records WHERE from_session_id = ?',
        [sessionId],
      );
      assert(
        handoffs.length === 0,
        'no handoff may be created while confirmation is still pending',
      );

      const confirmTurn = await orchestrateReceptionInput({
        userId,
        receptionSessionId: sessionId,
        userIntent: '确认',
        persistMessages: false,
      });
      assert(
        confirmTurn.reason !== 'grill-started',
        'confirming must not restart the grill (would loop forever)',
      );
      assert(
        readReceptionGrill(sessionId) === null,
        'confirmed grill state should be cleared before dispatch',
      );

      console.log('verify-team-grill-reception: ok');
    } finally {
      await closeDb();
    }
  });
}

void main().catch((error) => {
  console.error('verify-team-grill-reception: failed');
  console.error(error);
  process.exitCode = 1;
});
