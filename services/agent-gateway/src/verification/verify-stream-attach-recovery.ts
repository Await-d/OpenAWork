import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import authPlugin from '../infra/auth.js';
import { closeDb, connectDb, migrate, sqliteRun } from '../infra/db.js';
import requestWorkflowPlugin from '../runtime/request-workflow.js';
import { streamRoutes } from '../routes/stream-routes-plugin.js';
import { sessionsRoutes } from '../routes/sessions.js';
import {
  persistSessionRunEventForRequest,
  publishSessionRunEvent,
} from '../session/session-run-events.js';
import { upsertSessionRuntimeThread } from '../session/session-runtime-thread-store.js';
import { assert, withTempEnv } from './task-verification-helpers.js';

function parseSseEnvelopes(body: string): Array<Record<string, unknown>> {
  return body
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter((line) => line.length > 0 && line !== '[DONE]')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function main(): Promise<void> {
  await withTempEnv({ DATABASE_URL: ':memory:' }, async () => {
    await connectDb();
    await migrate();

    const app = Fastify();
    await app.register(websocket);
    await app.register(requestWorkflowPlugin);
    await app.register(authPlugin);
    await app.register(sessionsRoutes);
    await app.register(streamRoutes);
    await app.ready();

    try {
      const userId = randomUUID();
      const email = `attach-${userId}@openawork.local`;
      const sessionId = randomUUID();
      const clientRequestId = 'req-attach-verify-1';
      const startedAtMs = Date.now() - 50;
      const accessToken = app.jwt.sign({ sub: userId, email });

      sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
        userId,
        email,
        'hash',
      ]);
      sqliteRun(
        `INSERT INTO sessions (id, user_id, messages_json, metadata_json, state_status)
         VALUES (?, ?, '[]', '{}', 'running')`,
        [sessionId, userId],
      );

      upsertSessionRuntimeThread({
        clientRequestId,
        heartbeatAtMs: Date.now(),
        sessionId,
        startedAtMs,
        userId,
      });
      persistSessionRunEventForRequest(
        sessionId,
        {
          type: 'thinking_delta',
          delta: '先恢复上下文',
          eventId: 'run-attach-verify:evt:4',
          occurredAt: startedAtMs + 10,
        },
        { clientRequestId, seq: 4 },
      );

      const activeResponse = await app.inject({
        method: 'GET',
        url: `/sessions/${sessionId}/stream/active`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      assert(activeResponse.statusCode === 200, 'active stream route should succeed');
      const activePayload = JSON.parse(activeResponse.body) as {
        active: {
          clientRequestId: string;
          lastSeq: number;
          sessionId: string;
          startedAtMs: number;
        };
      };
      assert(
        activePayload.active.clientRequestId === clientRequestId,
        'active stream should expose request id',
      );
      assert(activePayload.active.lastSeq === 4, 'active stream should expose latest durable seq');

      const attachPromise = app.inject({
        method: 'GET',
        url:
          `/sessions/${sessionId}/stream/attach?token=${encodeURIComponent(accessToken)}` +
          `&clientRequestId=${encodeURIComponent(clientRequestId)}&afterSeq=3`,
      });

      setTimeout(() => {
        publishSessionRunEvent(
          sessionId,
          {
            type: 'tool_result',
            toolCallId: 'call-attach-verify-1',
            toolName: 'write',
            clientRequestId,
            output: { ok: true },
            isError: false,
            fileDiffs: [
              {
                file: '/repo/a.ts',
                before: 'a',
                after: 'b',
                additions: 1,
                deletions: 1,
                status: 'modified',
                clientRequestId,
                toolCallId: 'call-attach-verify-1',
                toolName: 'write',
              },
            ],
            observability: {
              presentedToolName: 'Write',
              canonicalToolName: 'write',
            },
            eventId: 'run-attach-verify:evt:5',
            occurredAt: Date.now(),
          },
          { clientRequestId, seq: 5 },
        );
        publishSessionRunEvent(
          sessionId,
          {
            type: 'done',
            stopReason: 'end_turn',
            eventId: 'run-attach-verify:evt:6',
            occurredAt: Date.now(),
          },
          { clientRequestId, seq: 6 },
        );
      }, 20);

      const attachResponse = await attachPromise;
      assert(attachResponse.statusCode === 200, 'attach route should succeed');
      const envelopes = parseSseEnvelopes(attachResponse.body);
      const seqs = envelopes.map((envelope) => envelope['seq']);
      assert(
        JSON.stringify(seqs) === JSON.stringify([4, 5, 6]),
        'attach should replay then continue live in order',
      );

      const events = envelopes.map((envelope) => {
        const payload = envelope['payload'] as Record<string, unknown> | undefined;
        return (payload?.['event'] as Record<string, unknown> | undefined) ?? {};
      });
      assert(
        JSON.stringify(events.map((event) => event['type'])) ===
          JSON.stringify(['thinking_delta', 'tool_result', 'done']),
        'attach should replay richer events before the live terminal event',
      );
      const toolResultEvent = events[1] as Record<string, unknown>;
      assert(
        toolResultEvent['toolCallId'] === 'call-attach-verify-1',
        'attach should preserve tool_result call id',
      );
      assert(toolResultEvent['toolName'] === 'write', 'attach should preserve tool_result name');
      assert(
        Array.isArray(toolResultEvent['fileDiffs']) && toolResultEvent['fileDiffs'].length === 1,
        'attach should preserve tool_result file diffs',
      );
      const observability = toolResultEvent['observability'] as Record<string, unknown> | undefined;
      assert(
        observability?.['canonicalToolName'] === 'write',
        'attach should preserve tool_result observability',
      );

      const completedRequestId = 'req-attach-paged';
      for (let seq = 1; seq <= 600; seq += 1) {
        sqliteRun(
          `INSERT INTO session_run_events (session_id, user_id, client_request_id, seq, event_type, occurred_at_ms, payload_json)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            sessionId,
            userId,
            completedRequestId,
            seq,
            seq === 600 ? 'done' : 'text_delta',
            seq,
            JSON.stringify(
              seq === 600
                ? { type: 'done', stopReason: 'end_turn' }
                : { type: 'text_delta', delta: String(seq) },
            ),
          ],
        );
      }
      const completed = await app.inject({
        method: 'GET',
        url: `/sessions/${sessionId}/stream/attach?token=${encodeURIComponent(accessToken)}&clientRequestId=${completedRequestId}&afterSeq=129`,
      });
      const completedEnvelopes = parseSseEnvelopes(completed.body).filter(
        (row) => typeof row['seq'] === 'number',
      );
      assert(completed.statusCode === 200, 'completed request replay should succeed');
      assert(
        completedEnvelopes.length === 471,
        'completed replay must span every page after the exclusive cursor',
      );
      assert(
        completedEnvelopes[0]?.['seq'] === 130 && completedEnvelopes.at(-1)?.['seq'] === 600,
        'completed replay must preserve cursor order',
      );
      assert(
        completed.body.includes('event: attach-replay-end'),
        'completed replay must retain its clean EOF marker',
      );
      const address = await app.listen({ host: '127.0.0.1', port: 0 });
      const controller = new AbortController();
      const multi = await fetch(
        `${address}/sessions/${sessionId}/stream/multi-attach?token=${encodeURIComponent(accessToken)}&afterSeq=0`,
        {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
        },
      );
      assert(multi.status === 200, 'multi-attach route should succeed');
      const reader = multi.body!.getReader();
      const decoder = new TextDecoder();
      let multiBody = '';
      let multiCount = 0;
      try {
        while (multiCount < 603) {
          const chunk = await reader.read();
          assert(!chunk.done, 'multi-attach must not end at an old request terminal event');
          multiBody += decoder.decode(chunk.value, { stream: true });
          const lastCompleteFrame = multiBody.lastIndexOf('\n\n');
          const completeBody = multiBody.slice(0, lastCompleteFrame + 2);
          multiCount = parseSseEnvelopes(completeBody).filter(
            (row) => typeof row['seq'] === 'number',
          ).length;
        }
        assert(multiCount === 603, 'multi-attach must not truncate replay at 500 rows');
      } finally {
        controller.abort();
        await reader.cancel().catch(() => undefined);
      }
      console.log('verify-stream-attach-recovery: ok');
    } finally {
      await app.close();
      await closeDb();
    }
  });
}

void main().catch((error) => {
  console.error('verify-stream-attach-recovery: failed');
  console.error(error);
  process.exitCode = 1;
});
