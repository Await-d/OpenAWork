import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import type * as DbModule from '../../infra/db.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

const VALID_USER = 'user-valid';
const VALID_FROM_SESSION = 'sess-from';
const VALID_TO_SESSION = 'sess-to';
const MISSING_SESSION = 'sess-missing';
const MISSING_USER = 'user-missing';

interface UsageRow {
  id: number;
  user_id: string;
  session_id: string;
  client_request_id: string | null;
  input_tokens: number;
}

interface HandoffRow {
  id: string;
  from_session_id: string;
  to_session_id: string | null;
  state: string;
  client_request_id: string | null;
}

interface ForeignKeyRow {
  from: string;
  on_delete: string;
  table: string;
}

let dbModule: typeof DbModule;
let warnMessages: string[];
let warnSpy: MockInstance<(...args: unknown[]) => void>;
let legacyUsageUniqueColumns: string[];
let legacyDuplicateRejected = false;
let legacyHandoffForeignKeys: ForeignKeyRow[];

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.closeDb();
  await dbModule.connectDb();
  dbModule.db.exec('PRAGMA foreign_keys=OFF');
  createLegacySchema();
  legacyUsageUniqueColumns = readUniqueUsageIndexColumns();
  legacyHandoffForeignKeys = readHandoffForeignKeys();
  seedLegacyRows();
  try {
    insertUsageRow(4, VALID_USER, VALID_FROM_SESSION, 'pm1', 'openai', 'gpt-a', 40);
  } catch {
    legacyDuplicateRejected = true;
  }
  dbModule.db.exec('PRAGMA foreign_keys=ON');

  warnMessages = [];
  warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnMessages.push(args.map((arg) => String(arg)).join(' '));
  });
  await dbModule.migrate();
});

afterAll(async () => {
  warnSpy?.mockRestore();
  await dbModule.closeDb();
});

function createLegacySchema(): void {
  dbModule.db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      messages_json TEXT NOT NULL DEFAULT '[]',
      state_status TEXT NOT NULL DEFAULT 'idle',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      title TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  dbModule.db.exec(`
    CREATE TABLE team_usage_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL,
      layer TEXT,
      agent_id TEXT,
      provider TEXT,
      model TEXT,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      reasoning_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      call_count INTEGER NOT NULL DEFAULT 0,
      total_duration_ms INTEGER NOT NULL DEFAULT 0,
      tool_call_count INTEGER NOT NULL DEFAULT 0,
      tool_error_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, session_id, layer, provider, model)
    );
  `);
  dbModule.db.exec(`
    CREATE TABLE handoff_records (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      from_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      from_role_layer TEXT NOT NULL,
      to_role_layer TEXT NOT NULL,
      to_session_id TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      state TEXT NOT NULL DEFAULT 'pending',
      claim_token TEXT,
      claimed_at TEXT,
      started_at TEXT,
      completed_at TEXT,
      failure_reason TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function seedLegacyRows(): void {
  dbModule.sqliteRun(`INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'hash')`, [
    VALID_USER,
    `${VALID_USER}@openawork.local`,
  ]);
  dbModule.sqliteRun(`INSERT INTO sessions (id, user_id, metadata_json) VALUES (?, ?, '{}')`, [
    VALID_FROM_SESSION,
    VALID_USER,
  ]);
  dbModule.sqliteRun(`INSERT INTO sessions (id, user_id, metadata_json) VALUES (?, ?, '{}')`, [
    VALID_TO_SESSION,
    VALID_USER,
  ]);

  insertUsageRow(1, VALID_USER, VALID_FROM_SESSION, 'pm1', 'openai', 'gpt-a', 10);
  insertUsageRow(2, VALID_USER, MISSING_SESSION, 'pm2', 'openai', 'gpt-b', 20);
  insertUsageRow(3, MISSING_USER, VALID_FROM_SESSION, 'pm1', 'openai', 'gpt-a', 30);

  insertHandoffRow('h-valid', VALID_FROM_SESSION, VALID_TO_SESSION, 'running');
  insertHandoffRow('h-dangling-from', MISSING_SESSION, VALID_TO_SESSION, 'completed');
  insertHandoffRow('h-dangling-to', VALID_FROM_SESSION, MISSING_SESSION, 'pending');
  insertHandoffRow('h-null-to', VALID_FROM_SESSION, null, 'pending');
  insertHandoffRow('h-both-dangling', MISSING_SESSION, MISSING_SESSION, 'cancelled');
}

function insertUsageRow(
  id: number,
  userId: string,
  sessionId: string,
  layer: string,
  provider: string,
  model: string,
  inputTokens: number,
): void {
  dbModule.sqliteRun(
    `INSERT INTO team_usage_records (id, user_id, session_id, layer, provider, model, input_tokens)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, sessionId, layer, provider, model, inputTokens],
  );
}

function insertHandoffRow(
  id: string,
  fromSessionId: string,
  toSessionId: string | null,
  state: string,
): void {
  dbModule.sqliteRun(
    `INSERT INTO handoff_records
       (id, user_id, from_session_id, from_role_layer, to_role_layer, to_session_id, state)
     VALUES (?, ?, ?, 'reception', 'pm1', ?, ?)`,
    [id, VALID_USER, fromSessionId, toSessionId, state],
  );
}

function readUniqueUsageIndexColumns(): string[] {
  const indexes = dbModule.sqliteAll<{ name: string; unique: number }>(
    'PRAGMA index_list(team_usage_records)',
  );
  const uniqueIndex = indexes.find((index) => index.unique === 1);
  if (!uniqueIndex) {
    return [];
  }
  return dbModule
    .sqliteAll<{ name: string }>(`PRAGMA index_info(${uniqueIndex.name})`)
    .map((row) => row.name);
}

function readHandoffForeignKeys(): ForeignKeyRow[] {
  return dbModule.sqliteAll<ForeignKeyRow>('PRAGMA foreign_key_list(handoff_records)');
}

function listUsageRows(): UsageRow[] {
  return dbModule.sqliteAll<UsageRow>(
    'SELECT id, user_id, session_id, client_request_id, input_tokens FROM team_usage_records ORDER BY id',
  );
}

function listHandoffRows(): HandoffRow[] {
  return dbModule.sqliteAll<HandoffRow>(
    'SELECT id, from_session_id, to_session_id, state, client_request_id FROM handoff_records ORDER BY id',
  );
}

describe('team turn rollback legacy migrations', () => {
  it('hand-built schema really is the legacy shape (5-column UNIQUE, no to_session_id FK)', () => {
    expect(legacyUsageUniqueColumns).toEqual([
      'user_id',
      'session_id',
      'layer',
      'provider',
      'model',
    ]);
    expect(legacyDuplicateRejected).toBe(true);
    expect(legacyHandoffForeignKeys.some((fk) => fk.from === 'to_session_id')).toBe(false);
  });

  it('rebuilds team_usage_records into the 6-column request-scoped UNIQUE key', () => {
    expect(readUniqueUsageIndexColumns()).toEqual([
      'user_id',
      'session_id',
      'layer',
      'provider',
      'model',
      'client_request_id',
    ]);
    expect(listUsageRows()).toEqual([
      {
        id: 1,
        user_id: VALID_USER,
        session_id: VALID_FROM_SESSION,
        client_request_id: null,
        input_tokens: 10,
      },
      {
        id: 2,
        user_id: VALID_USER,
        session_id: MISSING_SESSION,
        client_request_id: null,
        input_tokens: 20,
      },
    ]);
  });

  it('drops orphan user_id rows with a warning instead of failing the rebuild', () => {
    expect(
      dbModule.sqliteGet<{ count: number }>(
        'SELECT COUNT(*) AS count FROM team_usage_records WHERE user_id = ?',
        [MISSING_USER],
      )?.count,
    ).toBe(0);
    expect(
      warnMessages.some(
        (message) => message.includes('team_usage_records') && message.includes('user_id 已悬挂'),
      ),
    ).toBe(true);
  });

  it('separates the same aggregate tuple by client_request_id after the rebuild', () => {
    dbModule.sqliteRun(
      `INSERT INTO team_usage_records
         (id, user_id, session_id, layer, provider, model, client_request_id, input_tokens)
       VALUES (4, ?, ?, 'pm1', 'openai', 'gpt-a', 'turn-2', 40)`,
      [VALID_USER, VALID_FROM_SESSION],
    );
    expect(
      dbModule.sqliteGet<{ count: number }>(
        `SELECT COUNT(*) AS count FROM team_usage_records
          WHERE user_id = ? AND session_id = ? AND layer = 'pm1' AND provider = 'openai' AND model = 'gpt-a'`,
        [VALID_USER, VALID_FROM_SESSION],
      )?.count,
    ).toBe(2);

    expect(() =>
      dbModule.sqliteRun(
        `INSERT INTO team_usage_records
           (id, user_id, session_id, layer, provider, model, client_request_id)
         VALUES (5, ?, ?, 'pm1', 'openai', 'gpt-a', 'turn-2')`,
        [VALID_USER, VALID_FROM_SESSION],
      ),
    ).toThrow(/UNIQUE/i);
  });

  it('adds the to_session_id SET NULL FK and cleans dangling handoff pointers', () => {
    const foreignKeys = readHandoffForeignKeys();
    expect(
      foreignKeys.some(
        (fk) =>
          fk.from === 'to_session_id' && fk.table === 'sessions' && fk.on_delete === 'SET NULL',
      ),
    ).toBe(true);
    expect(
      foreignKeys.some(
        (fk) =>
          fk.from === 'from_session_id' && fk.table === 'sessions' && fk.on_delete === 'CASCADE',
      ),
    ).toBe(true);

    expect(listHandoffRows()).toEqual([
      {
        id: 'h-dangling-to',
        from_session_id: VALID_FROM_SESSION,
        to_session_id: null,
        state: 'pending',
        client_request_id: null,
      },
      {
        id: 'h-null-to',
        from_session_id: VALID_FROM_SESSION,
        to_session_id: null,
        state: 'pending',
        client_request_id: null,
      },
      {
        id: 'h-valid',
        from_session_id: VALID_FROM_SESSION,
        to_session_id: VALID_TO_SESSION,
        state: 'running',
        client_request_id: null,
      },
    ]);
    expect(
      warnMessages.some(
        (message) => message.includes('handoff_records') && message.includes('from_session_id'),
      ),
    ).toBe(true);
    expect(dbModule.sqliteAll<Record<string, unknown>>('PRAGMA foreign_key_check')).toEqual([]);
  });

  it('runs migrate() a second time as a strict no-op', async () => {
    const usageBefore = listUsageRows();
    const handoffBefore = listHandoffRows();
    const warningCountBefore = warnMessages.length;

    await dbModule.migrate();

    expect(listUsageRows()).toEqual(usageBefore);
    expect(listHandoffRows()).toEqual(handoffBefore);
    expect(warnMessages.length).toBe(warningCountBefore);
    expect(readUniqueUsageIndexColumns()).toEqual([
      'user_id',
      'session_id',
      'layer',
      'provider',
      'model',
      'client_request_id',
    ]);
    expect(
      readHandoffForeignKeys().some((fk) => fk.from === 'to_session_id' && fk.table === 'sessions'),
    ).toBe(true);
    expect(dbModule.sqliteAll<Record<string, unknown>>('PRAGMA foreign_key_check')).toEqual([]);
  });
});
