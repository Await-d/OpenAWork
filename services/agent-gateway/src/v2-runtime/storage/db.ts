/**
 * Drizzle adapter over `node:sqlite`.
 *
 * `drizzle-orm@0.36.x` ships with drivers for `bun-sqlite`, `better-sqlite3`,
 * `expo-sqlite`, etc. — but not `node:sqlite` (added in Node 22). The
 * generic `sqlite-proxy` driver lets us keep using the gateway's existing
 * `node:sqlite` connection while gaining drizzle's typed query API.
 *
 * Today this module is purely additive: legacy code keeps issuing raw SQL
 * via `db.ts`. The drizzle handle exposed here is consumed by future
 * v2-runtime modules (Phase 4 / 5) and by the storage tests under
 * `__tests__/`.
 */

// Avoid a static `import type { DatabaseSync } from 'node:sqlite'` —
// vitest's vite bundler trips on the `node:` protocol even for
// type-only imports. We declare a structural alias instead so the file
// stays bundler-agnostic; the runtime always sees a real
// `node:sqlite.DatabaseSync` because production callers use the
// gateway's existing connection.
interface NodeSqliteDatabase {
  prepare(sql: string): unknown;
}

import { drizzle, type SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy';
import * as schema from './schema.js';
import { normalizeUnknownSqliteBindParams } from '../../infra/sqlite-bind-params.js';

export type DrizzleHandle = SqliteRemoteDatabase<typeof schema>;

interface SqliteRow {
  [column: string]: unknown;
}

interface SqliteStatementLike {
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): unknown;
}

/**
 * Wrap a `DatabaseSync` instance into a drizzle-compatible proxy.
 *
 * The proxy implementation is intentionally tiny and lives entirely in
 * userspace — that way we sidestep any incompatibility between
 * `drizzle-orm` and the optional native modules we'd otherwise pull in
 * (`better-sqlite3` etc.) and keep the desktop sidecar's `bun build
 * --compile` output lean.
 *
 * `connection` is typed structurally (`{ prepare(sql): unknown }`) so
 * this module never imports `node:sqlite` directly. Callers pass the
 * real `DatabaseSync` they already keep around in `db.ts`.
 */
export function createDrizzleHandle(connection: NodeSqliteDatabase): DrizzleHandle {
  return drizzle(
    async (sqlText: string, params: unknown[], method: 'all' | 'run' | 'get' | 'values') => {
      const stmt = connection.prepare(sqlText) as SqliteStatementLike;
      const safeParams = normalizeUnknownSqliteBindParams(params);

      if (method === 'run') {
        stmt.run(...safeParams);
        return { rows: [] as unknown[] };
      }

      const rows = stmt.all(...safeParams) as SqliteRow[];
      // sqlite-proxy expects rows to be `unknown[][]` in column order. The
      // node:sqlite driver returns objects, so we project each row's values
      // into a tuple. Order is implementation-defined for `Object.values`,
      // but matches the column order returned by `node:sqlite.prepare(...)`
      // which itself follows the SELECT clause order.
      return {
        rows: rows.map((row) => Object.values(row)),
      };
    },
    { schema, casing: 'snake_case' },
  );
}

export { schema };
