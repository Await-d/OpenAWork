import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Message } from '@openAwork/shared';
import type { CompactionLlmResult } from '../../compaction/compaction-llm.js';
import { closeDb, connectDb, migrate, sqliteGet, sqliteRun } from '../../infra/db.js';
import type { ModelRouteConfig } from '../../provider/model-router.js';

const callCompactionLlmMock = vi.hoisted(() => vi.fn());

vi.mock('../../compaction/compaction-llm.js', () => ({
  callCompactionLlm: callCompactionLlmMock,
}));

import {
  executeSessionCompaction,
  isAutoCompactCircuitBreakerTripped,
} from '../../session/session-compaction.js';
import { buildDurableCompactionSummary } from '../../session/session-message-store.js';

const SESSION_ID = 'session-compaction-reservation';
const USER_ID = 'user-compaction-reservation';
const ROUTE: ModelRouteConfig = {
  model: 'mock-model',
  apiBaseUrl: 'http://localhost:0',
  apiKey: 'mock',
  maxTokens: 1024,
  temperature: 0,
  upstreamProtocol: 'chat_completions',
  requestOverrides: {},
  supportsThinking: false,
};

let temporaryDatabaseDirectory = '';
let previousDatabasePath: string | undefined;

function messages(): Message[] {
  return [
    {
      id: 'message-user',
      role: 'user',
      content: [{ type: 'text', text: '请总结本轮会话' }],
      createdAt: 1,
    },
    {
      id: 'message-assistant',
      role: 'assistant',
      content: [{ type: 'text', text: '会话包含待办和执行结果。' }],
      createdAt: 2,
    },
  ];
}

function input(clientRequestId: string, round: number) {
  return {
    clientRequestId,
    metadataJson: '{}',
    messages: messages(),
    round,
    route: ROUTE,
    sessionId: SESSION_ID,
    trigger: 'automatic' as const,
    userId: USER_ID,
  };
}

function deferred<T>() {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return {
    promise,
    resolve(value: T): void {
      if (!resolve) {
        throw new Error('deferred resolver was not initialized');
      }
      resolve(value);
    },
  };
}

beforeAll(async () => {
  previousDatabasePath = process.env['OPENAWORK_DATABASE_PATH'];
  temporaryDatabaseDirectory = await mkdtemp(join(tmpdir(), 'openawork-task3-compaction-'));
  await closeDb();
  process.env['OPENAWORK_DATABASE_PATH'] = join(temporaryDatabaseDirectory, 'gateway.sqlite');
  await connectDb();
  await migrate();
});

beforeEach(() => {
  callCompactionLlmMock.mockReset();
  sqliteRun('DROP TRIGGER IF EXISTS fail_compaction_marker');
  sqliteRun('DELETE FROM sessions');
  sqliteRun('DELETE FROM users');
  sqliteRun("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
  sqliteRun(
    `INSERT INTO sessions (id, user_id, messages_json, metadata_json, state_status)
     VALUES (?, ?, '[]', '{}', 'idle')`,
    [SESSION_ID, USER_ID],
  );
});

afterAll(async () => {
  await closeDb();
  if (previousDatabasePath === undefined) {
    delete process.env['OPENAWORK_DATABASE_PATH'];
  } else {
    process.env['OPENAWORK_DATABASE_PATH'] = previousDatabasePath;
  }
  await rm(temporaryDatabaseDirectory, { recursive: true, force: true });
  await connectDb();
});

describe('compaction request reservation', () => {
  it('preserves concurrent settings on success and rejects a concurrently moved boundary', async () => {
    callCompactionLlmMock.mockImplementationOnce(async () => {
      sqliteRun('UPDATE sessions SET metadata_json = ? WHERE id = ?', [
        '{"concurrentSetting":"retained"}',
        SESSION_ID,
      ]);
      return { summary: 'committed', inputTokens: 0, outputTokens: 0 };
    });
    const first = await executeSessionCompaction(input('settings', 1));
    expect(first).toMatchObject({ committed: true, metadata: { concurrentSetting: 'retained' } });
    callCompactionLlmMock.mockImplementationOnce(async () => {
      sqliteRun('UPDATE sessions SET metadata_json = ? WHERE id = ?', [
        JSON.stringify({ ...first.metadata, lastCompactionSignature: 'newer-marker' }),
        SESSION_ID,
      ]);
      return { summary: 'stale', inputTokens: 0, outputTokens: 0 };
    });
    const stale = await executeSessionCompaction({
      ...input('boundary', 2),
      metadataJson: first.metadataJson,
      messages: [...messages(), { ...messages()[0]!, id: 'new-message' }],
    });
    expect(stale).toMatchObject({
      committed: false,
      metadata: { lastCompactionSignature: 'newer-marker' },
    });
    expect(stale.summary).toBeUndefined();
    expect(sqliteGet<{ count: number }>('SELECT COUNT(*) AS count FROM message_v2')?.count).toBe(1);
  });

  it('preserves diagnostics when there is no new work and permits manual fallback', async () => {
    const metadataJson = '{"lastCompactionLlmSummary":"anchor","consecutiveCompactionFailures":3}';
    const empty = await executeSessionCompaction({
      ...input('empty', 1),
      metadataJson,
      messages: [],
    });
    expect(empty).toMatchObject({ committed: false, metadataJson });
    expect(callCompactionLlmMock).not.toHaveBeenCalled();
    const fallback = await executeSessionCompaction({
      ...input('manual', 1),
      trigger: 'manual',
      route: null,
    });
    expect(fallback.committed).toBe(true);
    expect(fallback.summary).toContain('Durable session compaction');
    const noop = await executeSessionCompaction({
      ...input('noop', 2),
      metadataJson: fallback.metadataJson,
    });
    expect(noop).toMatchObject({ committed: false, metadataJson: fallback.metadataJson });
    expect(noop.summary).toBeUndefined();
  });

  it.each(['upstream 503', 'compaction LLM timeout', 'empty', 'null route'])(
    'preserves the anchor and boundary on automatic failure: %s',
    async (failure) => {
      const prior = { lastCompactionLlmSummary: 'anchor', lastCompactionSignature: 'old' };
      sqliteRun('UPDATE sessions SET metadata_json = ? WHERE id = ?', [
        JSON.stringify(prior),
        SESSION_ID,
      ]);
      callCompactionLlmMock.mockImplementation(async () => {
        sqliteRun('UPDATE sessions SET metadata_json = ? WHERE id = ?', [
          JSON.stringify({ ...prior, concurrentSetting: true }),
          SESSION_ID,
        ]);
        if (failure === 'empty') return { summary: '  ', inputTokens: 0, outputTokens: 0 };
        throw new Error(failure);
      });
      const result = await executeSessionCompaction({
        ...input('failure', 1),
        metadataJson: JSON.stringify(prior),
        route: failure === 'null route' ? null : ROUTE,
      });
      expect(result).toMatchObject({ committed: false, metadata: prior });
      expect(result.llmErrorMessage).toBeTruthy();
      expect(result.summary).toBeUndefined();
      expect(result.metadata['consecutiveCompactionFailures']).toBe(1);
      expect(result.metadata['nextAutoCompactionAt']).toBeTypeOf('number');
      if (failure !== 'null route') expect(result.metadata['concurrentSetting']).toBe(true);
      expect(sqliteGet<{ count: number }>('SELECT COUNT(*) AS count FROM message_v2')?.count).toBe(
        0,
      );
      expect(sqliteGet('SELECT * FROM compaction_requests')).toBeUndefined();
    },
  );

  it.each(['resolve', 'reject'])(
    'throws caller cancellation after LLM %s without writing failure or marker',
    async (settle) => {
      const controller = new AbortController();
      callCompactionLlmMock.mockImplementation(async () => {
        controller.abort();
        if (settle === 'reject') throw new DOMException('cancelled', 'AbortError');
        return { summary: 'too late', inputTokens: 0, outputTokens: 0 };
      });
      await expect(
        executeSessionCompaction({ ...input('abort', 1), signal: controller.signal }),
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect(sqliteGet('SELECT * FROM compaction_requests')).toBeUndefined();
      expect(
        sqliteGet<{ metadata_json: string }>('SELECT metadata_json FROM sessions')?.metadata_json,
      ).toBe('{}');
      expect(sqliteGet<{ count: number }>('SELECT COUNT(*) AS count FROM message_v2')?.count).toBe(
        0,
      );
    },
  );

  it.each([
    { trigger: 'manual', withSignal: false },
    { trigger: 'manual', withSignal: true },
    { trigger: 'automatic', withSignal: false },
    { trigger: 'automatic', withSignal: true },
  ] as const)(
    'rethrows upstream cancellation for $trigger with live signal: $withSignal',
    async ({ trigger, withSignal }) => {
      const controller = new AbortController();
      const cancellation = Object.assign(new Error('upstream cancelled'), { name: 'AbortError' });
      const metadataJson = '{"consecutiveCompactionFailures":2,"concurrentSetting":"retained"}';
      sqliteRun('UPDATE sessions SET metadata_json = ? WHERE id = ?', [metadataJson, SESSION_ID]);
      callCompactionLlmMock.mockRejectedValueOnce(cancellation);

      await expect(
        executeSessionCompaction({
          ...input('upstream-abort', 1),
          metadataJson,
          trigger,
          ...(withSignal ? { signal: controller.signal } : {}),
        }),
      ).rejects.toBe(cancellation);

      expect(controller.signal.aborted).toBe(false);
      expect(callCompactionLlmMock).toHaveBeenCalledTimes(1);
      expect(sqliteGet('SELECT * FROM compaction_requests')).toBeUndefined();
      expect(
        sqliteGet<{ metadata_json: string }>('SELECT metadata_json FROM sessions')?.metadata_json,
      ).toBe(metadataJson);
      expect(sqliteGet<{ count: number }>('SELECT COUNT(*) AS count FROM message_v2')?.count).toBe(
        0,
      );
    },
  );

  it.each(['success', 'manual fallback'] as const)(
    'replays %s with fresh settings while retaining the completed summary',
    async (completion) => {
      const request = {
        ...input('replay-settings', 1),
        trigger: 'manual' as const,
      };
      if (completion === 'success') {
        callCompactionLlmMock.mockResolvedValueOnce({ summary: 'stored summary' });
      } else {
        callCompactionLlmMock.mockRejectedValueOnce(new Error('old upstream failure'));
      }
      const first = await executeSessionCompaction(request);
      const metadata = { ...first.metadata, concurrentSetting: 'fresh' };
      const metadataJson = JSON.stringify(metadata);
      sqliteRun('UPDATE sessions SET metadata_json = ? WHERE id = ?', [metadataJson, SESSION_ID]);

      const replay = await executeSessionCompaction(request);

      expect(replay).toMatchObject({
        committed: true,
        metadata,
        metadataJson,
        summary: first.summary,
      });
      expect(replay.durableSummary).not.toBeNull();
      expect(replay.llmSummary).toBe(first.llmSummary);
      expect(replay.llmErrorMessage).toBe(first.llmErrorMessage);
      expect(callCompactionLlmMock).toHaveBeenCalledTimes(1);
      expect(sqliteGet<{ count: number }>('SELECT COUNT(*) AS count FROM message_v2')?.count).toBe(
        1,
      );
      expect(
        sqliteGet<{ metadata_json: string }>('SELECT metadata_json FROM sessions')?.metadata_json,
      ).toBe(metadataJson);
    },
  );

  it.each(['success', 'manual fallback'] as const)(
    'does not replay %s after a later compaction moves the boundary',
    async (completion) => {
      const request = { ...input('replay-boundary', 1), trigger: 'manual' as const };
      if (completion === 'success') {
        callCompactionLlmMock.mockResolvedValueOnce({ summary: 'old summary' });
      } else {
        callCompactionLlmMock.mockRejectedValueOnce(new Error('old upstream failure'));
      }
      const first = await executeSessionCompaction(request);
      callCompactionLlmMock.mockResolvedValueOnce({ summary: 'new boundary summary' });
      const later = await executeSessionCompaction({
        ...input('later-compaction', 2),
        metadataJson: first.metadataJson,
        messages: [...messages(), { ...messages()[0]!, id: 'later-message' }],
      });
      expect(later.committed).toBe(true);
      expect(later.metadata['lastCompactionSignature']).not.toBe(
        first.metadata['lastCompactionSignature'],
      );

      const replay = await executeSessionCompaction(request);

      expect(replay).toMatchObject({
        committed: false,
        durableSummary: null,
        metadata: later.metadata,
        metadataJson: later.metadataJson,
      });
      expect(replay).not.toHaveProperty('summary');
      expect(replay).not.toHaveProperty('llmSummary');
      expect(replay).not.toHaveProperty('llmErrorMessage');
      expect(callCompactionLlmMock).toHaveBeenCalledTimes(2);
      expect(sqliteGet<{ count: number }>('SELECT COUNT(*) AS count FROM message_v2')?.count).toBe(
        2,
      );
      expect(
        sqliteGet<{ metadata_json: string }>('SELECT metadata_json FROM sessions')?.metadata_json,
      ).toBe(later.metadataJson);
    },
  );

  it('recovers legacy failure metadata with a real successful probe', async () => {
    const metadataJson =
      '{"consecutiveCompactionFailures":3,"lastCompactionLlmSummary":"legacy anchor"}';
    sqliteRun('UPDATE sessions SET metadata_json = ? WHERE id = ?', [metadataJson, SESSION_ID]);
    callCompactionLlmMock.mockResolvedValue({
      summary: 'probe recovered',
      inputTokens: 0,
      outputTokens: 0,
    });
    const result = await executeSessionCompaction({ ...input('legacy', 1), metadataJson });
    expect(result).toMatchObject({
      committed: true,
      summary: 'probe recovered',
      metadata: { consecutiveCompactionFailures: 0 },
    });
    expect(callCompactionLlmMock).toHaveBeenCalledWith(
      expect.objectContaining({ previousSummary: 'legacy anchor' }),
    );
  });

  it('fences an expired worker before it can commit or release its replacement', async () => {
    const result = deferred<CompactionLlmResult>();
    callCompactionLlmMock.mockReturnValueOnce(result.promise);
    const first = executeSessionCompaction(input('fenced', 1));
    sqliteRun("UPDATE compaction_requests SET created_at = datetime('now', '-1 hour')");
    const replacement = deferred<CompactionLlmResult>();
    callCompactionLlmMock.mockReturnValueOnce(replacement.promise);
    const second = executeSessionCompaction(input('fenced', 1));
    result.resolve({ summary: 'stale', inputTokens: 0, outputTokens: 0 });
    expect(await first).toMatchObject({ committed: false, retryable: true });
    expect(sqliteGet<{ status: string }>('SELECT status FROM compaction_requests')?.status).toBe(
      'reserved',
    );
    replacement.resolve({ summary: 'fresh', inputTokens: 0, outputTokens: 0 });
    expect(await second).toMatchObject({ summary: 'fresh', committed: true });
  });

  it('allows legacy failures to probe and clamps corrupt cooldowns to five minutes', () => {
    const now = Date.now();
    expect(isAutoCompactCircuitBreakerTripped('{"consecutiveCompactionFailures":3}')).toBe(false);
    expect(
      isAutoCompactCircuitBreakerTripped(
        JSON.stringify({
          consecutiveCompactionFailures: 3,
          lastCompactionFailureAt: now - 300_001,
          nextAutoCompactionAt: now + 999_999_999,
        }),
      ),
    ).toBe(false);
  });

  it('persists one completion for concurrent retries and reuses it after a database reload', async () => {
    const llmStarted = deferred<void>();
    const llmResult = deferred<CompactionLlmResult>();
    callCompactionLlmMock.mockImplementation(async () => {
      llmStarted.resolve();
      return llmResult.promise;
    });

    const request = input('request-1', 2);
    const first = executeSessionCompaction(request);
    await llmStarted.promise;
    const concurrentRetry = executeSessionCompaction(request);
    let llmReleased = false;

    try {
      expect(callCompactionLlmMock).toHaveBeenCalledTimes(1);
      llmResult.resolve({ summary: 'durable LLM summary', inputTokens: 10, outputTokens: 5 });
      llmReleased = true;
      const [firstResult, concurrentResult] = await Promise.all([first, concurrentRetry]);

      expect(concurrentResult).toMatchObject({
        llmErrorMessage: 'compaction request is in progress; retry this request',
        metadataJson: '{}',
        retryable: true,
      });
      expect(concurrentResult).not.toHaveProperty('summary');

      const replay = await executeSessionCompaction(request);
      expect(callCompactionLlmMock).toHaveBeenCalledTimes(1);
      expect(replay.metadataJson).toBe(firstResult.metadataJson);

      await closeDb();
      await connectDb();
      await migrate();

      const reloadedReplay = await executeSessionCompaction(request);
      const storedSession = sqliteGet<{ metadata_json: string }>(
        'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ?',
        [SESSION_ID, USER_ID],
      );
      const requestRecord = sqliteGet<{ metadata_json: string; status: string; summary: string }>(
        `SELECT metadata_json, status, summary FROM compaction_requests
         WHERE session_id = ? AND user_id = ? AND client_request_id = ? AND round = ?`,
        [SESSION_ID, USER_ID, 'request-1', 2],
      );
      const markerCount = sqliteGet<{ count: number }>(
        'SELECT COUNT(*) AS count FROM message_v2 WHERE session_id = ? AND user_id = ?',
        [SESSION_ID, USER_ID],
      );

      expect(callCompactionLlmMock).toHaveBeenCalledTimes(1);
      expect(reloadedReplay.metadataJson).toBe(firstResult.metadataJson);
      expect(storedSession?.metadata_json).toBe(firstResult.metadataJson);
      expect(requestRecord).toEqual(
        expect.objectContaining({
          metadata_json: firstResult.metadataJson,
          status: 'completed',
          summary: 'durable LLM summary',
        }),
      );
      expect(markerCount?.count).toBe(1);
    } finally {
      if (!llmReleased) {
        llmResult.resolve({ summary: 'cleanup summary', inputTokens: 0, outputTokens: 0 });
        await Promise.all([first, concurrentRetry]);
      }
    }
  });

  it('persists the third automatic failure and rejects the fourth request after a database reload', async () => {
    callCompactionLlmMock.mockRejectedValue(new Error('upstream 503'));
    let metadataJson = '{}';
    let now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);

    for (const round of [1, 2, 3]) {
      now += 300_001;
      const result = await executeSessionCompaction({
        ...input('request-breaker', round),
        metadataJson,
      });
      metadataJson = result.metadataJson;
    }

    expect(callCompactionLlmMock).toHaveBeenCalledTimes(3);
    expect(metadataJson).toContain('"consecutiveCompactionFailures":3');

    await closeDb();
    await connectDb();
    await migrate();

    const storedSession = sqliteGet<{ metadata_json: string }>(
      'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ?',
      [SESSION_ID, USER_ID],
    );
    const fourth = await executeSessionCompaction({
      ...input('request-breaker', 4),
      metadataJson,
    });

    expect(storedSession?.metadata_json).toContain('"consecutiveCompactionFailures":3');
    expect(callCompactionLlmMock).toHaveBeenCalledTimes(3);
    expect(fourth.llmErrorMessage).toContain('circuit breaker');
    expect(fourth.metadata['consecutiveCompactionFailures']).toBe(3);
    now += 300_001;
    callCompactionLlmMock.mockResolvedValue({
      summary: 'recovered',
      inputTokens: 0,
      outputTokens: 0,
    });
    const recovered = await executeSessionCompaction({
      ...input('request-breaker', 5),
      metadataJson,
    });
    expect(recovered).toMatchObject({ committed: true, summary: 'recovered' });
    expect(recovered.metadata['nextAutoCompactionAt']).toBeUndefined();
    clock.mockRestore();
  });

  it('releases a failed reservation so the same identity retries after a marker write failure', async () => {
    callCompactionLlmMock
      .mockResolvedValueOnce({
        summary: 'will not persist',
        inputTokens: 10,
        outputTokens: 5,
      })
      .mockResolvedValueOnce({
        summary: 'retry persisted',
        inputTokens: 10,
        outputTokens: 5,
      });
    sqliteRun(`
      CREATE TRIGGER fail_compaction_marker
      BEFORE INSERT ON message_v2
      WHEN NEW.session_id = '${SESSION_ID}'
      BEGIN
        SELECT RAISE(ABORT, 'forced compaction marker failure');
      END
    `);

    const request = input('request-rollback', 1);
    await expect(executeSessionCompaction(request)).rejects.toThrow(
      'forced compaction marker failure',
    );

    const storedSession = sqliteGet<{ metadata_json: string }>(
      'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ?',
      [SESSION_ID, USER_ID],
    );
    const markerCount = sqliteGet<{ count: number }>(
      'SELECT COUNT(*) AS count FROM message_v2 WHERE session_id = ? AND user_id = ?',
      [SESSION_ID, USER_ID],
    );
    const failedReservation = sqliteGet<{ status: string }>(
      `SELECT status FROM compaction_requests
       WHERE session_id = ? AND user_id = ? AND client_request_id = ? AND round = ?`,
      [SESSION_ID, USER_ID, 'request-rollback', 1],
    );

    expect(storedSession?.metadata_json).toBe('{}');
    expect(markerCount?.count).toBe(0);
    expect(failedReservation).toBeUndefined();

    sqliteRun('DROP TRIGGER fail_compaction_marker');
    const retried = await executeSessionCompaction(request);
    const completedReservation = sqliteGet<{ status: string; summary: string }>(
      `SELECT status, summary FROM compaction_requests
       WHERE session_id = ? AND user_id = ? AND client_request_id = ? AND round = ?`,
      [SESSION_ID, USER_ID, 'request-rollback', 1],
    );

    expect(callCompactionLlmMock).toHaveBeenCalledTimes(2);
    expect(retried.summary).toBe('retry persisted');
    expect(completedReservation).toEqual({ status: 'completed', summary: 'retry persisted' });

    await closeDb();
    await connectDb();
    await migrate();

    const reloadedRetry = await executeSessionCompaction(request);
    expect(callCompactionLlmMock).toHaveBeenCalledTimes(2);
    expect(reloadedRetry.metadataJson).toBe(retried.metadataJson);
  });

  it('reclaims an expired reservation left by a crashed process after a database reload', async () => {
    callCompactionLlmMock.mockResolvedValue({
      summary: 'recovered summary',
      inputTokens: 10,
      outputTokens: 5,
    });
    const request = input('request-crashed', 1);
    const signature = buildDurableCompactionSummary({
      messages: messages(),
      recentMessagesKept: 0,
      trigger: 'automatic',
    })?.signature;
    if (!signature) {
      throw new Error('expected compaction signature');
    }

    sqliteRun(
      `INSERT INTO compaction_requests
       (session_id, user_id, client_request_id, round, signature, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'reserved', datetime('now', '-1 hour'))`,
      [SESSION_ID, USER_ID, 'request-crashed', 1, signature],
    );

    await closeDb();
    await connectDb();
    await migrate();

    const result = await executeSessionCompaction(request);
    const reservation = sqliteGet<{ status: string; summary: string }>(
      `SELECT status, summary FROM compaction_requests
       WHERE session_id = ? AND user_id = ? AND client_request_id = ? AND round = ?`,
      [SESSION_ID, USER_ID, 'request-crashed', 1],
    );
    const markerCount = sqliteGet<{ count: number }>(
      'SELECT COUNT(*) AS count FROM message_v2 WHERE session_id = ? AND user_id = ?',
      [SESSION_ID, USER_ID],
    );

    expect(result.summary).toBe('recovered summary');
    expect(reservation).toEqual({ status: 'completed', summary: 'recovered summary' });
    expect(markerCount?.count).toBe(1);
    expect(callCompactionLlmMock).toHaveBeenCalledTimes(1);
  });
});
