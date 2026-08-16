import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ModelRouteConfig } from '../../provider/model-router.js';
import type { CompactionSettings } from '../../compaction/compaction-policy.js';
import { triggerOverflowCompaction } from '../../compaction/auto-compaction-trigger.js';
import { writeSessionMemoryContent } from '../../compaction/session-memory-store.js';
import { appendSessionMessageV2, listSessionMessagesV2 } from '../../message/message-v2-adapter.js';
import { listSessionRunEvents } from '../../session/session-run-events.js';
import * as db from '../../infra/db.js';

const USER_ID = 'task4-session-memory-idempotency-user';
const SESSION_ID = 'task4-session-memory-idempotency-session';
const REQUEST_ID = 'task4:"slash\\\\request';
const ROUND = 4;

const ROUTE: ModelRouteConfig = {
  model: 'task4-session-memory-model',
  apiBaseUrl: 'http://127.0.0.1:9',
  apiKey: 'task4-session-memory-key',
  contextWindow: 100_000,
  maxTokens: 2_000,
  temperature: 0,
  upstreamProtocol: 'chat_completions',
  requestOverrides: {},
  supportsThinking: false,
};

const SETTINGS: CompactionSettings = {
  auto: true,
  prune: true,
  recentMessagesKept: 2,
};

function seedSession(): void {
  db.sqliteRun('DELETE FROM sessions WHERE id = ?', [SESSION_ID]);
  db.sqliteRun('DELETE FROM users WHERE id = ?', [USER_ID]);
  db.sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
    USER_ID,
    `${USER_ID}@example.test`,
    'test',
  ]);
  db.sqliteRun('INSERT INTO sessions (id, user_id, title, metadata_json) VALUES (?, ?, ?, ?)', [
    SESSION_ID,
    USER_ID,
    'task 4 session memory idempotency',
    '{}',
  ]);
  for (let index = 0; index < 6; index += 1) {
    appendSessionMessageV2({
      sessionId: SESSION_ID,
      userId: USER_ID,
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: [{ type: 'text', text: `历史消息 ${index}: ${'内容 '.repeat(8_000)}` }],
      clientRequestId: `${REQUEST_ID}:seed:${index}`,
      messageId: `${SESSION_ID}:seed:${index}`,
      status: 'final',
    });
  }
  writeSessionMemoryContent(
    SESSION_ID,
    USER_ID,
    '已提取的会话记忆：保留当前任务、已完成步骤和后续约束。',
  );
}

function readMetadataJson(): string {
  return (
    db.sqliteGet<{ metadata_json: string }>(
      'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ?',
      [SESSION_ID, USER_ID],
    )?.metadata_json ?? '{}'
  );
}

async function overflow(metadataJson: string) {
  return triggerOverflowCompaction({
    clientRequestId: REQUEST_ID,
    compactionSettings: SETTINGS,
    metadataJson,
    route: ROUTE,
    round: ROUND,
    runId: 'task4-session-memory-run',
    sessionId: SESSION_ID,
    signal: new AbortController().signal,
    userId: USER_ID,
    roundResult: {
      overflow: true,
      stopReason: 'error',
      usage: {
        inputTokens: 99_000,
        outputTokens: 1,
        totalTokens: 99_001,
      },
    },
  });
}

beforeAll(async () => {
  await db.connectDb();
  await db.migrate();
});

beforeEach(() => {
  seedSession();
});

afterAll(() => {
  db.sqliteRun('DELETE FROM session_run_events WHERE session_id = ?', [SESSION_ID]);
  db.sqliteRun('DELETE FROM sessions WHERE id = ?', [SESSION_ID]);
  db.sqliteRun('DELETE FROM users WHERE id = ?', [USER_ID]);
});

describe('任务4 session-memory SQLite 幂等', () => {
  it('同一 request round reload 后仅保留一个 marker 和一个 completed', async () => {
    const first = await overflow(readMetadataJson());
    expect(first).toMatchObject({ triggered: true, recovered: true });

    const reloadedMetadataJson = readMetadataJson();
    expect(listSessionMessagesV2({ sessionId: SESSION_ID, userId: USER_ID })).not.toHaveLength(0);
    const concurrent = await Promise.all([
      overflow(reloadedMetadataJson),
      overflow(reloadedMetadataJson),
    ]);
    expect(concurrent).toHaveLength(2);
    expect(concurrent[0]).toMatchObject({ triggered: true, recovered: true });
    expect(concurrent[1]).toMatchObject({ triggered: true, recovered: true });

    const markerCount = db.sqliteGet<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM message_v2
       WHERE session_id = ?
         AND user_id = ?
         AND json_extract(data, '$.clientRequestId') LIKE ?`,
      [SESSION_ID, USER_ID, `compaction-marker:${REQUEST_ID}:${ROUND}:%`],
    )?.count;
    const completed = listSessionRunEvents(SESSION_ID).filter(
      (event) => event.type === 'compaction' && event.phase === 'completed',
    );

    expect(markerCount).toBe(1);
    expect(completed).toHaveLength(1);
  });
});
