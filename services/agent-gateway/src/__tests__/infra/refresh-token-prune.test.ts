/**
 * Regression: expired `refresh_tokens` rows were never deleted. Rows are only
 * removed on rotation / logout / password-change, and the refresh lookup
 * filters expired rows with `expires_at > datetime('now')` WITHOUT deleting
 * them — so each abandoned session (browser closed without logout) leaves a
 * dead row that lingers for the table's lifetime, growing unbounded. Token
 * issuance now opportunistically prunes expired rows.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as AuthModule from '../../infra/auth.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let auth: typeof AuthModule;

const USER_ID = 'u-refresh-prune';

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  auth = await import('../../infra/auth.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM refresh_tokens', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  dbModule.sqliteRun("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
});

afterAll(async () => {
  await dbModule.closeDb();
});

function countRefreshTokens(): number {
  const row = dbModule.sqliteGet<{ n: number }>('SELECT COUNT(*) AS n FROM refresh_tokens', []);
  return row?.n ?? 0;
}

function insertToken(hash: string, expiresAt: string): void {
  dbModule.sqliteRun(
    'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
    [`id-${hash}`, USER_ID, hash, expiresAt],
  );
}

describe('pruneExpiredRefreshTokens', () => {
  it('删除已过期行，保留未过期行', () => {
    const past = new Date(Date.now() - 86_400_000).toISOString(); // 1 day ago
    const future = new Date(Date.now() + 86_400_000).toISOString(); // 1 day ahead
    insertToken('expired-1', past);
    insertToken('expired-2', past);
    insertToken('live-1', future);
    expect(countRefreshTokens()).toBe(3);

    auth.pruneExpiredRefreshTokens();

    // Only the live row survives.
    expect(countRefreshTokens()).toBe(1);
    const remaining = dbModule.sqliteGet<{ token_hash: string }>(
      'SELECT token_hash FROM refresh_tokens LIMIT 1',
      [],
    );
    expect(remaining?.token_hash).toBe('live-1');
  });

  it('没有过期行时为 no-op，不影响未过期行', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    insertToken('live-a', future);
    insertToken('live-b', future);

    auth.pruneExpiredRefreshTokens();

    expect(countRefreshTokens()).toBe(2);
  });
});
