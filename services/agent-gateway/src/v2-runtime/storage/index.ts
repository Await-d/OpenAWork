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
import {
  type DrizzleHandle,
  createDrizzleHandle,
} from './db.js';
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

export {
  createDrizzleHandle,
  schema,
  type DrizzleHandle,
} from './db.js';
export {
  eventLog,
  eventSequences,
  messageV2,
  partV2,
  sessionEntry,
  sessions,
} from './schema.js';
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
    const conditions = [eq(messageV2.sessionId, input.sessionId), eq(messageV2.userId, input.userId)];
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
  async *streamMessagesNewestFirst(input: {
    sessionId: string;
    userId: string;
    pageSize?: number;
  }): AsyncGenerator<MessageV2Row, void, unknown> {
    const pageSize = input.pageSize ?? 50;
    let beforeTime: number | undefined;
    let beforeId: string | undefined;

    while (true) {
      const conditions = [
        eq(messageV2.sessionId, input.sessionId),
        eq(messageV2.userId, input.userId),
      ];
      if (beforeTime !== undefined && beforeId !== undefined) {
        conditions.push(lt(messageV2.timeCreated, beforeTime));
      }
      const page = await this.db
        .select()
        .from(messageV2)
        .where(and(...conditions))
        .orderBy(desc(messageV2.timeCreated), desc(messageV2.id))
        .limit(pageSize + 1);

      if (page.length === 0) return;

      const slice = page.length > pageSize ? page.slice(0, pageSize) : page;
      for (const row of slice) {
        yield row;
      }

      if (page.length <= pageSize) return;
      const tail = slice[slice.length - 1]!;
      beforeTime = tail.timeCreated;
      beforeId = tail.id;
    }
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
