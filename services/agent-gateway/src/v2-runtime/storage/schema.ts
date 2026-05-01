/**
 * Drizzle ORM schema for the V2 storage layer.
 *
 * Mirrors opencode's `session/session.sql.ts` while preserving OpenAWork's
 * existing column names so we can run drizzle queries directly against the
 * legacy `node:sqlite` tables created in `db.ts`. No new migrations are
 * issued from this file: it is a schema-only declaration that lets the
 * Phase 4 / Phase 5 work emit type-safe queries without rewriting CREATE
 * TABLE statements.
 *
 * The column types are kept loose (`text` / `integer`) on purpose — drizzle
 * gives us compile-time guarantees, but the runtime is still classic raw
 * SQLite, so we want the schema to match the actual storage layout 1:1.
 */

import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// ─── Sessions (subset of columns Phase 3+ needs) ──────────────────────
//
// The legacy `sessions` table in `db.ts` carries many more columns
// (messages_json / metadata_json / share / summary_* / etc.). Phase 3
// only needs the columns the V2 stack reads / writes through projectors,
// so we declare just those here and treat the rest as legacy V1 surface.
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  title: text('title'),
  parentId: text('parent_id'),
  workspaceId: text('workspace_id'),
  timeCreated: text('time_created'),
  timeUpdated: text('time_updated'),
  timeCompacting: text('time_compacting'),
  timeArchived: text('time_archived'),
  summaryAdditions: integer('summary_additions'),
  summaryDeletions: integer('summary_deletions'),
  summaryFiles: integer('summary_files'),
  summaryDiffs: text('summary_diffs'),
  revert: text('revert'),
  permission: text('permission'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
});

// ─── message_v2 ───────────────────────────────────────────────────────
export const messageV2 = sqliteTable(
  'message_v2',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    timeCreated: integer('time_created').notNull(),
    data: text('data').notNull(),
    createdAt: text('created_at').default(sql`(datetime('now'))`),
    updatedAt: text('updated_at').default(sql`(datetime('now'))`),
  },
  (table) => ({
    sessionTimeIdx: index('idx_message_v2_session_time').on(
      table.sessionId,
      table.timeCreated,
      table.id,
    ),
  }),
);

// ─── part_v2 ──────────────────────────────────────────────────────────
export const partV2 = sqliteTable(
  'part_v2',
  {
    id: text('id').primaryKey(),
    messageId: text('message_id')
      .notNull()
      .references(() => messageV2.id, { onDelete: 'cascade' }),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    timeCreated: integer('time_created').notNull(),
    data: text('data').notNull(),
    createdAt: text('created_at').default(sql`(datetime('now'))`),
    updatedAt: text('updated_at').default(sql`(datetime('now'))`),
  },
  (table) => ({
    messageIdx: index('idx_part_v2_message').on(table.messageId, table.id),
    sessionIdx: index('idx_part_v2_session').on(table.sessionId),
  }),
);

// ─── event_log (SyncEvent persistence) ────────────────────────────────
// Legacy `migrateSyncEventTables()` in `db.ts` enforces a unique index
// on `(aggregate_id, seq)` so the SyncEvent journal cannot duplicate a
// sequence within an aggregate. We declare the same constraint here so
// drizzle introspection / future migrations stay in lockstep with the
// runtime contract.
export const eventLog = sqliteTable(
  'event_log',
  {
    id: text('id').primaryKey(),
    aggregateId: text('aggregate_id').notNull(),
    seq: integer('seq').notNull(),
    type: text('type').notNull(),
    version: integer('version').notNull(),
    data: text('data').notNull(),
    timestamp: integer('timestamp').notNull(),
    createdAt: text('created_at').default(sql`(datetime('now'))`),
  },
  (table) => ({
    aggregateSeqUq: uniqueIndex('uq_event_log_aggregate_seq').on(table.aggregateId, table.seq),
  }),
);

export const eventSequences = sqliteTable('event_sequences', {
  aggregateId: text('aggregate_id').primaryKey(),
  seq: integer('seq').notNull().default(0),
});

// ─── session_entry (typed stream events — Phase 2.2) ──────────────────
export const sessionEntry = sqliteTable(
  'session_entry',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    clientRequestId: text('client_request_id'),
    seq: integer('seq').notNull(),
    type: text('type').notNull(),
    timestamp: integer('timestamp').notNull(),
    data: text('data').notNull(),
    createdAt: text('created_at').default(sql`(datetime('now'))`),
  },
  (table) => ({
    sessionSeqIdx: index('idx_session_entry_session_seq').on(
      table.sessionId,
      table.seq,
      table.timestamp,
    ),
    sessionRequestIdx: index('idx_session_entry_session_request').on(
      table.sessionId,
      table.clientRequestId,
      table.seq,
    ),
  }),
);

// ─── Convenience: row inference exports for the storage API ──────────

export type SessionRow = typeof sessions.$inferSelect;
export type MessageV2Row = typeof messageV2.$inferSelect;
export type PartV2Row = typeof partV2.$inferSelect;
export type EventLogRow = typeof eventLog.$inferSelect;
export type SessionEntryRow = typeof sessionEntry.$inferSelect;

export type SessionInsert = typeof sessions.$inferInsert;
export type MessageV2Insert = typeof messageV2.$inferInsert;
export type PartV2Insert = typeof partV2.$inferInsert;
export type EventLogInsert = typeof eventLog.$inferInsert;
export type SessionEntryInsert = typeof sessionEntry.$inferInsert;
