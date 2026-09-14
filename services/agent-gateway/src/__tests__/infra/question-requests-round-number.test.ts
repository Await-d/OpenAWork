import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';

process.env['DATABASE_URL'] = ':memory:';

let dbModule: typeof DbModule;

interface TableInfoRow {
  name: string;
  type: string;
}

function tableInfo(): TableInfoRow[] {
  return dbModule.sqliteAll<TableInfoRow>('PRAGMA table_info(question_requests)');
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('question_requests.round_number migration', () => {
  it('migrate 后存在 round_number 列且类型为 INTEGER', () => {
    const column = tableInfo().find((row) => row.name === 'round_number');
    expect(column).toBeDefined();
    expect(column?.type).toBe('INTEGER');
  });

  it('保留既有列（回归护栏）', () => {
    const names = tableInfo().map((row) => row.name);
    for (const expected of [
      'id',
      'session_id',
      'user_id',
      'tool_name',
      'title',
      'questions_json',
      'answer_json',
      'request_payload_json',
      'status',
      'created_at',
      'updated_at',
      'expires_at',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('重复 migrate 幂等：列不重复且不抛错', async () => {
    await dbModule.migrate();
    const matches = tableInfo().filter((row) => row.name === 'round_number');
    expect(matches).toHaveLength(1);
  });
});
