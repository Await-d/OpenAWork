/**
 * Phase 3 storage façade — a drizzle-powered read/write API for the
 * V2 tables, intended to replace the raw SQL paths in `message-store-v2.ts`
 * and `session-entry-store.ts` once the V2 runtime is enabled.
 *
 * For now the API is offered as a parallel surface: callers that opt into
 * `v2-runtime/storage` get drizzle's typed queries, while everything else
 * keeps running on the legacy raw-SQL path. The `OPENAWORK_RUNTIME_STORAGE`
 * flag determines which path the gateway boot wires up.
 */

import { and, asc, desc, eq, gte, lt } from 'drizzle-orm';
import { Effect, Stream } from 'effect';
import { type DrizzleHandle, createDrizzleHandle } from './db.js';
import {
  eventLog,
  eventSequences,
  messageV2,
  partV2,
  sessionEntry,
  sessions,
  type EventLogRow,
  type MessageV2Row,
  type PartV2Row,
  type SessionEntryRow,
  type SessionRow,
} from './schema.js';

export { createDrizzleHandle, schema, type DrizzleHandle } from './db.js';
export { eventLog, eventSequences, messageV2, partV2, sessionEntry, sessions } from './schema.js';
export type {
  EventLogInsert,
  EventLogRow,
  MessageV2Insert,
  MessageV2Row,
  PartV2Insert,
  PartV2Row,
  SessionEntryInsert,
  SessionEntryRow,
  SessionInsert,
  SessionRow,
} from './schema.js';

// Structural alias — see `./db.ts` for the rationale.
interface NodeSqliteDatabase {
  prepare(sql: string): unknown;
}

// ─── Storage class (instantiable per connection) ─────────────────────

export class V2Storage {
  constructor(private readonly db: DrizzleHandle) {}

  static fromConnection(connection: NodeSqliteDatabase): V2Storage {
    return new V2Storage(createDrizzleHandle(connection));
  }

  static fromHandle(handle: DrizzleHandle): V2Storage {
    return new V2Storage(handle);
  }

  // ─── Sessions ────────────────────────────────────────────────────

  async getSession(sessionId: string): Promise<SessionRow | undefined> {
    const rows = await this.db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
    return rows[0];
  }

  // ─── Messages ────────────────────────────────────────────────────

  async getMessage(input: {
    sessionId: string;
    messageId: string;
  }): Promise<MessageV2Row | undefined> {
    const rows = await this.db
      .select()
      .from(messageV2)
      .where(and(eq(messageV2.id, input.messageId), eq(messageV2.sessionId, input.sessionId)))
      .limit(1);
    return rows[0];
  }

  async listMessages(input: {
    sessionId: string;
    userId: string;
    afterTime?: number;
    limit?: number;
  }): Promise<MessageV2Row[]> {
    const conditions = [
      eq(messageV2.sessionId, input.sessionId),
      eq(messageV2.userId, input.userId),
    ];
    if (typeof input.afterTime === 'number') {
      conditions.push(gte(messageV2.timeCreated, input.afterTime));
    }
    const query = this.db
      .select()
      .from(messageV2)
      .where(and(...conditions))
      .orderBy(asc(messageV2.timeCreated), asc(messageV2.id));
    return input.limit !== undefined ? query.limit(input.limit) : query;
  }

  /**
   * opencode-style reverse-paginated stream — yields newest messages first
   * so callers like `filterCompacted` can short-circuit at the latest
   * compaction boundary without buffering the full session history.
   */
  streamMessagesNewestFirst(input: {
    sessionId: string;
    userId: string;
    pageSize?: number;
  }): Stream.Stream<MessageV2Row> {
    const pageSize = input.pageSize ?? 50;
    type Cursor = {
      readonly rows: readonly MessageV2Row[];
      readonly beforeTime?: number;
      readonly beforeId?: string;
      readonly done: boolean;
    };

    const initial: Cursor = { rows: [], done: false };
    return Stream.unfold(initial, (cursor) =>
      Effect.promise(async () => {
        if (cursor.rows.length > 0) {
          const row = cursor.rows[0];
          if (!row) return undefined;
          const rows = cursor.rows.slice(1);
          return [row, { ...cursor, rows }] as const;
        }
        if (cursor.done) return undefined;

        const conditions = [
          eq(messageV2.sessionId, input.sessionId),
          eq(messageV2.userId, input.userId),
        ];
        if (cursor.beforeTime !== undefined && cursor.beforeId !== undefined) {
          conditions.push(lt(messageV2.timeCreated, cursor.beforeTime));
        }
        const page = await this.db
          .select()
          .from(messageV2)
          .where(and(...conditions))
          .orderBy(desc(messageV2.timeCreated), desc(messageV2.id))
          .limit(pageSize + 1);
        if (page.length === 0) return undefined;

        const rows = page.length > pageSize ? page.slice(0, pageSize) : page;
        const first = rows[0];
        const last = rows[rows.length - 1];
        if (!first) return undefined;
        return [
          first,
          {
            rows: rows.slice(1),
            done: page.length <= pageSize,
            ...(page.length > pageSize && last
              ? { beforeTime: last.timeCreated, beforeId: last.id }
              : {}),
          },
        ] as const;
      }),
    );
  }

  // ─── Parts ────────────────────────────────────────────────────────

  async listPartsForMessage(messageId: string): Promise<PartV2Row[]> {
    return this.db
      .select()
      .from(partV2)
      .where(eq(partV2.messageId, messageId))
      .orderBy(asc(partV2.id));
  }

  // ─── Session entries ─────────────────────────────────────────────

  async listSessionEntries(input: {
    sessionId: string;
    clientRequestId?: string;
    afterSeq?: number;
  }): Promise<SessionEntryRow[]> {
    const conditions = [eq(sessionEntry.sessionId, input.sessionId)];
    if (input.clientRequestId !== undefined) {
      conditions.push(eq(sessionEntry.clientRequestId, input.clientRequestId));
    }
    return this.db
      .select()
      .from(sessionEntry)
      .where(and(...conditions))
      .orderBy(asc(sessionEntry.seq), asc(sessionEntry.timestamp));
  }

  // ─── Event log ────────────────────────────────────────────────────

  async listEventLog(aggregateId: string): Promise<EventLogRow[]> {
    return this.db
      .select()
      .from(eventLog)
      .where(eq(eventLog.aggregateId, aggregateId))
      .orderBy(asc(eventLog.seq));
  }

  /**
   * Atomically advance the per-aggregate sequence counter and return the
   * new value. Used by the SyncEvent emit path when running on the V2
   * runtime to replace the legacy `INSERT ... ON CONFLICT DO UPDATE
   * RETURNING` round trip.
   */
  async allocateNextEventSeq(aggregateId: string): Promise<number> {
    const existing = await this.db
      .select()
      .from(eventSequences)
      .where(eq(eventSequences.aggregateId, aggregateId))
      .limit(1);
    if (existing.length === 0) {
      await this.db.insert(eventSequences).values({ aggregateId, seq: 1 });
      return 1;
    }
    const current = existing[0]!;
    const next = current.seq + 1;
    await this.db
      .update(eventSequences)
      .set({ seq: next })
      .where(eq(eventSequences.aggregateId, aggregateId));
    return next;
  }
}
