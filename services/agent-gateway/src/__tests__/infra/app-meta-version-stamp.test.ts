/**
 * Regression coverage for the cross-version app-meta stamp installed by
 * `migrate()` / `stampCurrentAppVersion()`.
 *
 * 这个 stamp 是「卸载未清数据 → 升级安装」场景的关键锚点：旧用户的
 * sqlite 仍然在新版本启动时被复用，我们需要：
 * 1. 首次启动写入 `app_version` / `first_seen_app_version`。
 * 2. 第二次启动 detect 到版本变化时把旧版本号写入 `previous_app_version`，
 *    并保留首次见到的版本号不被覆盖。
 * 3. 同版本重启不刷新 `previous_app_version`。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';

// 必须在 import db.js 之前完成，否则 module 顶层的 `currentDbPath`
// 会落到磁盘上的真实 openAwork.db。
process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '1.0.0';

let dbModule: typeof DbModule;

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('app_meta version stamp', () => {
  it('writes app_version + first_seen on initial migrate', () => {
    expect(dbModule.getAppMetaValue('app_version')).toBe('1.0.0');
    expect(dbModule.getAppMetaValue('first_seen_app_version')).toBe('1.0.0');
    expect(dbModule.getAppMetaValue('previous_app_version')).toBeUndefined();
  });

  it('records previous_app_version on upgrade and keeps first_seen pinned', () => {
    process.env['OPENAWORK_APP_VERSION'] = '1.1.0';
    const stamp = dbModule.stampCurrentAppVersion();

    expect(stamp.currentVersion).toBe('1.1.0');
    expect(stamp.previousVersion).toBe('1.0.0');
    expect(stamp.firstSeenVersion).toBe('1.0.0');
    expect(stamp.upgraded).toBe(true);

    expect(dbModule.getAppMetaValue('app_version')).toBe('1.1.0');
    expect(dbModule.getAppMetaValue('previous_app_version')).toBe('1.0.0');
    expect(dbModule.getAppMetaValue('first_seen_app_version')).toBe('1.0.0');
  });

  it('treats a downgrade as an upgrade-style version change', () => {
    process.env['OPENAWORK_APP_VERSION'] = '0.9.0';
    const stamp = dbModule.stampCurrentAppVersion();

    expect(stamp.currentVersion).toBe('0.9.0');
    expect(stamp.previousVersion).toBe('1.1.0');
    expect(stamp.upgraded).toBe(true);
    expect(dbModule.getAppMetaValue('previous_app_version')).toBe('1.1.0');
    expect(dbModule.getAppMetaValue('first_seen_app_version')).toBe('1.0.0');
  });

  it('does not mutate previous_app_version when the same version reboots', () => {
    process.env['OPENAWORK_APP_VERSION'] = '0.9.0';
    const before = dbModule.getAppMetaValue('previous_app_version');
    const stamp = dbModule.stampCurrentAppVersion();

    expect(stamp.upgraded).toBe(false);
    expect(dbModule.getAppMetaValue('previous_app_version')).toBe(before);
  });

  it('deduplicates legacy session_messages request-role mirrors before recreating the unique index', async () => {
    const sessionId = 'session-legacy-dedupe';
    const userId = 'user-legacy-dedupe';
    const clientRequestId = 'request-legacy-dedupe';

    dbModule.sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
      userId,
      'legacy-dedupe@example.com',
      'hash',
    ]);
    dbModule.sqliteRun('INSERT INTO sessions (id, user_id) VALUES (?, ?)', [sessionId, userId]);
    dbModule.sqliteRun('DROP INDEX IF EXISTS idx_session_messages_request_role');

    dbModule.sqliteRun(
      `INSERT INTO session_messages (
        id, session_id, user_id, seq, role, content_json, status, client_request_id, created_at_ms, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        'legacy-message-1',
        sessionId,
        userId,
        1,
        'assistant',
        JSON.stringify([{ type: 'text', text: 'older duplicate' }]),
        'error',
        clientRequestId,
        100,
      ],
    );
    dbModule.sqliteRun(
      `INSERT INTO session_messages (
        id, session_id, user_id, seq, role, content_json, status, client_request_id, created_at_ms, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        'legacy-message-2',
        sessionId,
        userId,
        2,
        'assistant',
        JSON.stringify([{ type: 'text', text: 'latest duplicate' }]),
        'error',
        clientRequestId,
        200,
      ],
    );

    await dbModule.migrate();

    const legacyRows = dbModule.sqliteAll<{ id: string; content_json: string }>(
      `SELECT id, content_json
       FROM session_messages
       WHERE session_id = ? AND user_id = ? AND client_request_id = ? AND role = ?
       ORDER BY created_at_ms ASC, id ASC`,
      [sessionId, userId, clientRequestId, 'assistant'],
    );
    const migratedRows = dbModule.sqliteAll<{ id: string }>(
      'SELECT id FROM message_v2 WHERE session_id = ? AND user_id = ? ORDER BY time_created ASC, id ASC',
      [sessionId, userId],
    );

    expect(legacyRows).toHaveLength(1);
    expect(legacyRows[0]?.id).toBe('legacy-message-2');
    expect(legacyRows[0]?.content_json).toContain('latest duplicate');
    expect(migratedRows).toHaveLength(1);
    expect(migratedRows[0]?.id).toBe('legacy-message-2');

    expect(() =>
      dbModule.sqliteRun(
        `INSERT INTO session_messages (
          id, session_id, user_id, seq, role, content_json, status, client_request_id, created_at_ms, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [
          'legacy-message-3',
          sessionId,
          userId,
          3,
          'assistant',
          JSON.stringify([{ type: 'text', text: 'duplicate after migrate' }]),
          'error',
          clientRequestId,
          300,
        ],
      ),
    ).toThrow(
      /UNIQUE constraint failed: session_messages\.session_id, session_messages\.client_request_id, session_messages\.role/,
    );
  });
});
