import { randomUUID } from 'node:crypto';
import { closeDb, connectDb, migrate, sqliteAll, sqliteGet, sqliteRun } from '../db.js';
import {
  appendPatchPart,
  appendSessionMessageV2,
  appendSnapshotPart,
  emitSessionCreated,
  emitSessionDeleted,
  emitSessionUpdated,
  listSessionMessagesV2,
} from '../message-v2-adapter.js';
import type { MessageID } from '../message-v2-schema.js';
import { listMessagesWithParts } from '../message-store-v2.js';
import { replayEventsForAggregate } from '../sync-event.js';
import { assert, withTempEnv } from './task-verification-helpers.js';

function extractText(message: { content: Array<{ type: string; text?: string }> }): string {
  return message.content
    .filter((content) => content.type === 'text' && typeof content.text === 'string')
    .map((content) => content.text ?? '')
    .join('\n')
    .trim();
}

async function main(): Promise<void> {
  await withTempEnv({ DATABASE_URL: ':memory:' }, async () => {
    await connectDb();
    await migrate();

    try {
      const userId = randomUUID();
      const createdAt = Date.now();
      sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
        userId,
        `message-v2-event-${userId}@openawork.local`,
        'hash',
      ]);

      const sessionId = randomUUID();
      emitSessionCreated({
        sessionID: sessionId,
        info: {
          id: sessionId,
          userID: userId,
          title: 'Message V2 Event Projection',
          time: { created: createdAt, updated: createdAt },
        },
      });
      emitSessionUpdated({
        sessionID: sessionId,
        info: {
          title: 'Message V2 Event Projection Updated',
          time: { updated: createdAt + 1 },
        },
      });

      const userMessage = appendSessionMessageV2({
        sessionId,
        userId,
        role: 'user',
        content: [{ type: 'text', text: '请输出 hello world' }],
        createdAt: createdAt + 2,
        clientRequestId: 'req-message-v2-user',
      });
      const assistantMessage = appendSessionMessageV2({
        sessionId,
        userId,
        role: 'assistant',
        content: [{ type: 'text', text: 'hello world' }],
        createdAt: createdAt + 3,
        clientRequestId: 'req-message-v2-assistant',
      });

      appendSnapshotPart({
        sessionId,
        messageId: assistantMessage.id as MessageID,
        snapshotRef: 'req:req-message-v2-assistant',
      });
      appendPatchPart({
        sessionId,
        messageId: assistantMessage.id as MessageID,
        hash: 'req:req-message-v2-assistant',
        files: ['/src/message-v2.ts'],
      });

      const sessionRow = sqliteGet<{ title: string }>('SELECT title FROM sessions WHERE id = ?', [
        sessionId,
      ]);
      assert(
        sessionRow?.title === 'Message V2 Event Projection Updated',
        'session update should persist the latest title',
      );

      const transcript = listSessionMessagesV2({ sessionId, userId });
      assert(transcript.length === 2, 'V1 transcript projection should expose two messages');
      assert(
        extractText(transcript[0] ?? { content: [] }) === '请输出 hello world',
        'user text should persist',
      );
      assert(
        extractText(transcript[1] ?? { content: [] }) === 'hello world',
        'assistant text should persist',
      );

      const messageRows = sqliteAll<{ id: string }>(
        'SELECT id FROM message_v2 WHERE session_id = ? ORDER BY time_created ASC, id ASC',
        [sessionId],
      );
      assert(messageRows.length === 2, 'message_v2 should contain two projected messages');
      assert(
        messageRows[0]?.id === userMessage.id,
        'first V2 message should match the user message',
      );
      assert(
        messageRows[1]?.id === assistantMessage.id,
        'second V2 message should match the assistant message',
      );

      const partKinds = sqliteAll<{ data: string }>(
        'SELECT data FROM part_v2 WHERE session_id = ? ORDER BY time_created ASC, id ASC',
        [sessionId],
      ).map((row) => JSON.parse(row.data) as { type: string });
      assert(partKinds.length === 4, 'part_v2 should contain text + text + snapshot + patch');
      assert(
        partKinds.filter((part) => part.type === 'text').length === 2,
        'projected parts should retain exactly two text parts',
      );
      assert(
        partKinds.some((part) => part.type === 'snapshot') &&
          partKinds.some((part) => part.type === 'patch'),
        'projected parts should include both snapshot and patch metadata parts',
      );

      const messagesWithParts = listMessagesWithParts({ sessionId, userId });
      assert(messagesWithParts.length === 2, 'listMessagesWithParts should return two messages');
      assert(
        messagesWithParts[1]?.parts.some((part) => part.type === 'snapshot') === true,
        'assistant message should expose SnapshotPart',
      );
      assert(
        messagesWithParts[1]?.parts.some((part) => part.type === 'patch') === true,
        'assistant message should expose PatchPart',
      );

      const replayedTypes = replayEventsForAggregate(sessionId).map((event) => event.type);
      assert(
        JSON.stringify(replayedTypes) ===
          JSON.stringify([
            'session.created',
            'session.updated',
            'message.created',
            'message.part.created',
            'message.created',
            'message.part.created',
            'message.part.created',
            'message.part.created',
          ]),
        'event log should preserve session/message/part ordering',
      );

      const deletedSessionId = randomUUID();
      emitSessionCreated({
        sessionID: deletedSessionId,
        info: {
          id: deletedSessionId,
          userID: userId,
          title: 'Deleted Session',
          time: { created: createdAt + 4, updated: createdAt + 4 },
        },
      });
      emitSessionDeleted({
        sessionID: deletedSessionId,
        info: {
          id: deletedSessionId,
          userID: userId,
          title: 'Deleted Session',
          time: { created: createdAt + 4, updated: createdAt + 5 },
        },
      });

      const deletedRow = sqliteGet<{ id: string }>('SELECT id FROM sessions WHERE id = ?', [
        deletedSessionId,
      ]);
      assert(deletedRow === undefined, 'session.deleted should remove the session read model row');
      assert(
        JSON.stringify(replayEventsForAggregate(deletedSessionId).map((event) => event.type)) ===
          JSON.stringify(['session.created', 'session.deleted']),
        'deleted lifecycle session should retain create/delete events for audit',
      );

      console.log('verify-message-v2-event-projection: ok');
    } finally {
      await closeDb();
    }
  });
}

void main().catch((error) => {
  console.error('verify-message-v2-event-projection: failed');
  console.error(error);
  process.exitCode = 1;
});
