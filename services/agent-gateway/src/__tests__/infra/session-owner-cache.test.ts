import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as SessionOwnerCacheModule from '../../infra/session-owner-cache.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let ownerCache: typeof SessionOwnerCacheModule;

const SESSION_ID = 'sess-owner-cache';
const USER_ID = 'u-owner-cache';
const LATE_SESSION_ID = 'sess-owner-cache-late';

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  ownerCache = await import('../../infra/session-owner-cache.js');
});

beforeEach(() => {
  ownerCache.invalidateSessionOwnerCache();
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  dbModule.sqliteRun("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'owner cache', '{}', 'idle')`,
    [SESSION_ID, USER_ID],
  );
});

afterEach(() => {
  ownerCache.invalidateSessionOwnerCache();
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('session owner cache', () => {
  it('serves repeat lookups from the cache instead of re-reading the row', () => {
    expect(ownerCache.getSessionOwnerUserId(SESSION_ID)).toBe(USER_ID);

    // 绕过应用层直接删除：命中缓存时仍返回缓存值。
    dbModule.sqliteRun('DELETE FROM sessions WHERE id = ?', [SESSION_ID]);
    expect(ownerCache.getSessionOwnerUserId(SESSION_ID)).toBe(USER_ID);

    ownerCache.invalidateSessionOwnerCache(SESSION_ID);
    expect(ownerCache.getSessionOwnerUserId(SESSION_ID)).toBeNull();
  });

  it('caches misses so unknown sessions do not re-query on every call', () => {
    expect(ownerCache.getSessionOwnerUserId(LATE_SESSION_ID)).toBeNull();

    // TTL 内出现同名 session：负缓存仍在生效，显式失效后才可见。
    dbModule.sqliteRun(
      `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
       VALUES (?, ?, 'late', '{}', 'idle')`,
      [LATE_SESSION_ID, USER_ID],
    );
    expect(ownerCache.getSessionOwnerUserId(LATE_SESSION_ID)).toBeNull();

    ownerCache.invalidateSessionOwnerCache(LATE_SESSION_ID);
    expect(ownerCache.getSessionOwnerUserId(LATE_SESSION_ID)).toBe(USER_ID);
  });

  it('clears every entry on full invalidation', () => {
    expect(ownerCache.getSessionOwnerUserId(SESSION_ID)).toBe(USER_ID);

    ownerCache.invalidateSessionOwnerCache();
    dbModule.sqliteRun('DELETE FROM sessions WHERE id = ?', [SESSION_ID]);
    expect(ownerCache.getSessionOwnerUserId(SESSION_ID)).toBeNull();
  });
});
