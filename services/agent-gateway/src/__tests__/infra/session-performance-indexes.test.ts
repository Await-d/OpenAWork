import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('会话高频读路径索引', () => {
  it('为消息、交互和文件摘要查询建立复合索引', () => {
    const tables = [
      'message_v2',
      'part_v2',
      'permission_requests',
      'question_requests',
      'session_file_diffs',
      'session_snapshots',
    ] as const;
    const expected = new Set([
      'idx_message_v2_session_user_time',
      'idx_part_v2_session_message',
      'idx_permission_requests_session_status_created',
      'idx_question_requests_session_status_created',
      'idx_session_file_diffs_session_user_created',
      'idx_session_snapshots_session_user_created',
    ]);

    const actual = new Set(
      tables.flatMap((table) =>
        dbModule.sqliteAll<{ name: string }>(`PRAGMA index_list(${table})`).map((row) => row.name),
      ),
    );

    expect([...expected].filter((name) => !actual.has(name))).toEqual([]);
  });
});
