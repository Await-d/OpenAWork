/**
 * verify-v2-runtime — end-to-end smoke test for the v2-runtime stack.
 *
 * Run with:
 *   pnpm --filter @openAwork/agent-gateway exec tsx src/verification/verify-v2-runtime.ts
 *
 * Mirrors the existing `verification/verify-*.ts` scripts: spins up an
 * in-memory SQLite, runs the legacy `migrate()` to install the V2
 * tables, boots the v2-runtime, and exercises every public surface
 * (drizzle reads, replaySessionEntries, EffectBridge.runWithStorage).
 *
 * Exit code 0 means every assertion passed; non-zero means the v2
 * stack diverged from the legacy schema and needs investigation.
 */

import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { connectDb, db, migrate, sqliteRun } from '../db.js';
import { insertMessage, insertPart, transitionToolToRunning } from '../message-store-v2.js';
import {
  appendSessionEvent,
  listSessionEvents,
  replaySessionEntries,
} from '../session-entry-store.js';
import { makeSessionEventId } from '../session-event.js';
import {
  makeMessageId,
  makePartId,
  type AssistantMessage,
  type ToolPart,
  type ToolStatePending,
} from '../message-v2-schema.js';
import {
  bootV2Runtime,
  getDrizzleHandle,
  getV2Storage,
  resetV2RuntimeForTesting,
} from '../v2-runtime/index.js';
import { EffectBridge, StorageService } from '../v2-runtime/services/index.js';
import { withTempEnv, assert } from './task-verification-helpers.js';

async function main(): Promise<void> {
  await withTempEnv({ DATABASE_URL: ':memory:' }, async () => {
    await connectDb();
    await migrate();
    resetV2RuntimeForTesting();

    // ── seed legacy schema ───────────────────────────────────────
    const userId = randomUUID();
    const sessionId = randomUUID();
    const messageId = `msg_${randomUUID()}`;

    sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
      userId,
      `verify-v2-${userId}@openawork.local`,
      'hash',
    ]);
    sqliteRun(
      `INSERT INTO sessions (id, user_id, title, time_created, time_updated)
       VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
      [sessionId, userId, 'verify-v2-runtime'],
    );
    sqliteRun(
      `INSERT INTO message_v2 (id, session_id, user_id, time_created, data)
       VALUES (?, ?, ?, ?, ?)`,
      [
        messageId,
        sessionId,
        userId,
        1000,
        JSON.stringify({ role: 'user', time: { created: 1000 } }),
      ],
    );

    // ── boot v2-runtime ─────────────────────────────────────────
    const booted = bootV2Runtime({ connection: db, force: true });
    assert(booted !== null, 'bootV2Runtime should succeed when force=true');
    assert(getDrizzleHandle() !== null, 'getDrizzleHandle() should expose the booted handle');
    const storage = getV2Storage();
    assert(storage !== null, 'getV2Storage() should expose the booted storage façade');

    // ── drizzle reads must surface the legacy rows ──────────────
    const sessionRow = await storage.getSession(sessionId);
    assert(sessionRow?.id === sessionId, 'V2Storage.getSession should round-trip via drizzle');
    assert(sessionRow.userId === userId, 'session.user_id should match the seeded user');

    const messages = await storage.listMessages({ sessionId, userId });
    assert(messages.length === 1, `expected 1 message, got ${messages.length}`);
    assert(messages[0]!.id === messageId, 'listMessages should yield the seeded message');

    // ── SessionEvent persistence + replay round-trip ────────────
    const promptEvent = appendSessionEvent({
      sessionId,
      userId,
      clientRequestId: 'verify-req',
      event: {
        id: makeSessionEventId(1100),
        type: 'prompt',
        timestamp: 1100,
        text: 'verify replay path',
      },
    });
    assert(promptEvent !== null, 'appendSessionEvent should persist the prompt');

    const stepStarted = appendSessionEvent({
      sessionId,
      userId,
      clientRequestId: 'verify-req',
      event: {
        id: makeSessionEventId(1200),
        type: 'step.started',
        timestamp: 1200,
        model: { id: 'verify-model', providerID: 'verify' },
      },
    });
    assert(stepStarted !== null, 'appendSessionEvent should persist step.started');

    appendSessionEvent({
      sessionId,
      userId,
      clientRequestId: 'verify-req',
      event: {
        id: makeSessionEventId(1300),
        type: 'text.delta',
        timestamp: 1300,
        delta: 'verified',
      },
    });
    appendSessionEvent({
      sessionId,
      userId,
      clientRequestId: 'verify-req',
      event: {
        id: makeSessionEventId(1400),
        type: 'step.ended',
        timestamp: 1400,
        reason: 'end_turn',
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      },
    });

    const entries = replaySessionEntries(sessionId);
    const types = entries.map((entry) => entry.type);
    assert(
      types.length === 2 && types[0] === 'user' && types[1] === 'assistant',
      `replaySessionEntries should yield [user, assistant], got ${types.join(',')}`,
    );

    // ── EffectBridge.runWithStorage must use the booted layer ───
    const allocResult = await EffectBridge.runWithStorage(
      Effect.gen(function* () {
        const service = yield* StorageService;
        const seq = yield* service.allocateNextEventSeq(sessionId);
        return seq;
      }),
    );
    assert(
      typeof allocResult === 'number' && allocResult >= 1,
      'allocateNextEventSeq should yield a positive sequence',
    );

    const listed = await EffectBridge.runWithStorage(
      Effect.gen(function* () {
        const service = yield* StorageService;
        return yield* service.listSessionEntries({ sessionId });
      }),
    );
    assert(
      listed.length >= 4,
      `Effect-driven listSessionEntries should yield ≥ 4 rows, got ${listed.length}`,
    );

    // ── runWithStorageOption must swallow failures ──────────────
    const softFailure = await EffectBridge.runWithStorageOption(
      Effect.fail(new Error('intentional failure')),
    );
    assert(softFailure === null, 'runWithStorageOption should resolve with null on failure');

    // ── Phase 2.2 follow-up: tool.called must be persisted when a
    // ToolPart transitions from pending → running. Without this hook
    // replaySessionEntries would show the tool stuck in 'pending'.
    const assistantMessageId = makeMessageId();
    const assistantInfo: AssistantMessage = {
      id: assistantMessageId,
      role: 'assistant',
      sessionID: sessionId,
      time: { created: 1500 },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      path: { cwd: '', root: '' },
    };
    insertMessage({ sessionId, userId, info: assistantInfo });

    const toolCallId = `call_${randomUUID()}`;
    const pendingToolState: ToolStatePending = {
      status: 'pending',
      input: { path: '/tmp/example.txt' },
      raw: '{"path":"/tmp/example.txt"}',
    };
    const toolPart: ToolPart = {
      id: makePartId(),
      sessionID: sessionId,
      messageID: assistantMessageId,
      type: 'tool',
      callID: toolCallId,
      tool: 'read',
      state: pendingToolState,
    };
    insertPart({ sessionId, userId, part: toolPart });

    const transitioned = transitionToolToRunning({
      sessionId,
      userId,
      callID: toolCallId,
      title: 'read /tmp/example.txt',
    });
    assert(
      transitioned !== undefined,
      'transitionToolToRunning should locate and transition the part',
    );
    assert(
      transitioned.state.status === 'running',
      `expected tool state running, got ${transitioned.state.status}`,
    );

    const allEvents = listSessionEvents({ sessionId });
    const toolCalledEvents = allEvents.filter((e) => e.type === 'tool.called');
    assert(
      toolCalledEvents.length === 1,
      `expected exactly one tool.called event, got ${toolCalledEvents.length}`,
    );
    const toolCalled = toolCalledEvents[0]!;
    assert(
      toolCalled.type === 'tool.called' && toolCalled.callID === toolCallId,
      `tool.called event mismatch: ${JSON.stringify(toolCalled)}`,
    );

    console.log(
      JSON.stringify(
        {
          status: 'ok',
          sessionId,
          userId,
          messageCount: messages.length,
          entryTypes: types,
          allocSeq: allocResult,
          entryRowCount: listed.length,
          toolCalledEventCount: toolCalledEvents.length,
          toolCalledTool: toolCalled.type === 'tool.called' ? toolCalled.tool : null,
        },
        null,
        2,
      ),
    );
  });
}

main().catch((err) => {
  console.error('verify-v2-runtime failed:', err);
  process.exitCode = 1;
});
