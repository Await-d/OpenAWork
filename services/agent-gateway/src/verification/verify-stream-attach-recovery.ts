import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import authPlugin from '../auth.js';
import { closeDb, connectDb, migrate, sqliteRun } from '../db.js';
import requestWorkflowPlugin from '../request-workflow.js';
import { streamRoutes } from '../routes/stream-routes-plugin.js';
import { sessionsRoutes } from '../routes/sessions.js';
import { persistSessionRunEventForRequest, publishSessionRunEvent } from '../session-run-events.js';
import { upsertSessionRuntimeThread } from '../session-runtime-thread-store.js';
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
          type: 'text_delta',
          delta: '已恢复',
          eventId: 'run-attach-verify:evt:4',
          runId: 'run-attach-verify',
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
            type: 'done',
            stopReason: 'end_turn',
            eventId: 'run-attach-verify:evt:5',
            runId: 'run-attach-verify',
            occurredAt: Date.now(),
          },
          { clientRequestId, seq: 5 },
        );
      }, 20);

      const attachResponse = await attachPromise;
      assert(attachResponse.statusCode === 200, 'attach route should succeed');
      const envelopes = parseSseEnvelopes(attachResponse.body);
      const seqs = envelopes.map((envelope) => envelope['seq']);
      assert(
        JSON.stringify(seqs) === JSON.stringify([4, 5]),
        'attach should replay then continue live in order',
      );

      const outputs = envelopes.map((envelope) => {
        const payload = envelope['payload'] as Record<string, unknown> | undefined;
        const event = payload?.['event'] as Record<string, unknown> | undefined;
        return event?.['type'] === 'text_delta' ? event['delta'] : event?.['stopReason'];
      });
      assert(
        JSON.stringify(outputs) === JSON.stringify(['已恢复', 'end_turn']),
        'attach should emit the replayed text delta followed by the live terminal event',
      );

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
