/**
 * 261101-记忆确认写入与周期整理 —— 记忆治理迁移回归。
 *
 * 迁移最容易出错的不是建表，而是**顺序**与**存量数据**：
 *   - 老库所有行 `scope_id` 都是空串，若先建作用域化唯一索引再回填，同 type+key 的多行
 *     会塌到 `'user' + ''` 上直接撞索引，整条迁移失败；
 *   - 历史数据不能被伪造成「人工确认」或「提议确认」——只能标 `source_detail='legacy'`；
 *   - 来源不明的记忆不能被推断成某个群，必须留在 `user` 作用域。
 *
 * 这里构造一个「没有治理列、只有旧唯一索引」的老库，跑真实 migrate() 后逐条断言。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

const USER_ID = 'user-legacy';

interface MemoryRow {
  id: string;
  scope_type: string;
  scope_id: string;
  lifecycle: string;
  revision: number;
  change_seq: number;
  confirmation_kind: string | null;
  confirmed_at: string | null;
  source_detail: string | null;
  team_workspace_id: string | null;
  workspace_root: string | null;
}

let dbModule: typeof DbModule;

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.closeDb();
  await dbModule.connectDb();
  dbModule.db.exec('PRAGMA foreign_keys=OFF');
  createLegacySchema();
  seedLegacyRows();
  dbModule.db.exec('PRAGMA foreign_keys=ON');
  await dbModule.migrate();
});

afterAll(async () => {
  await dbModule.closeDb();
});

function createLegacySchema(): void {
  dbModule.db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  // 老库的 memories：没有任何治理列（scope_type / revision / change_seq ...）。
  dbModule.db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      confidence REAL NOT NULL DEFAULT 1.0,
      priority INTEGER NOT NULL DEFAULT 50,
      workspace_root TEXT,
      team_workspace_id TEXT,
      role_layers_json TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  dbModule.db.exec(
    'CREATE INDEX IF NOT EXISTS idx_memories_user_enabled ON memories(user_id, enabled)',
  );
  dbModule.db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_user_type_key ON memories(user_id, type, key) WHERE enabled = 1',
  );
}

function seedLegacyRows(): void {
  dbModule.db
    .prepare(`INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)`)
    .run(USER_ID, 'legacy@example.com', 'x');
  const insert = dbModule.db.prepare(
    `INSERT INTO memories (id, user_id, type, key, value, workspace_root, team_workspace_id, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insert.run('m-personal', USER_ID, 'fact', 'runtime', 'node-20', null, null, 1);
  insert.run('m-team', USER_ID, 'fact', 'stack', 'go', null, 'team-1', 1);
  // 带尾斜杠，验证作用域 id 会被规范化（否则同一目录会出现两个作用域）。
  insert.run('m-workspace', USER_ID, 'fact', 'style', 'rust', '/tmp/proj/', null, 1);
  insert.run('m-disabled', USER_ID, 'fact', 'old', 'redis', null, null, 0);
}

function readMemories(): MemoryRow[] {
  return dbModule.db
    .prepare(
      `SELECT id, scope_type, scope_id, lifecycle, revision, change_seq, confirmation_kind,
              confirmed_at, source_detail, team_workspace_id, workspace_root
       FROM memories ORDER BY id`,
    )
    .all() as MemoryRow[];
}

function readCounter(): number {
  const row = dbModule.db.prepare('SELECT value FROM memory_change_counter WHERE id = 1').get() as
    { value: number } | undefined;
  return row?.value ?? -1;
}

function listIndexNames(): string[] {
  const rows = dbModule.db.prepare('PRAGMA index_list(memories)').all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

function tableExists(name: string): boolean {
  const row = dbModule.db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .get(name) as { name: string } | undefined;
  return row !== undefined;
}

describe('记忆治理迁移', () => {
  it('存量行按来源回填作用域，且不伪造确认来源', () => {
    const rows = readMemories();
    const byId = new Map(rows.map((row) => [row.id, row]));

    expect(byId.get('m-personal')).toMatchObject({
      scope_type: 'user',
      scope_id: USER_ID,
      lifecycle: 'active',
      revision: 1,
      confirmation_kind: null,
      confirmed_at: null,
      source_detail: 'legacy',
    });
    expect(byId.get('m-team')).toMatchObject({ scope_type: 'team', scope_id: 'team-1' });
    // 尾斜杠被规范化掉，保证同一目录只有一个作用域。
    expect(byId.get('m-workspace')).toMatchObject({
      scope_type: 'workspace',
      scope_id: '/tmp/proj',
    });
    // 停用行同样进治理列，但不参与唯一索引。
    expect(byId.get('m-disabled')).toMatchObject({ scope_type: 'user', source_detail: 'legacy' });
  });

  it('为存量行回填唯一且单调的 change_seq，并同步计数器', () => {
    const rows = readMemories();
    const seqs = rows.map((row) => row.change_seq);
    expect(seqs.every((value) => value > 0)).toBe(true);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(readCounter()).toBe(Math.max(...seqs));
  });

  it('换掉旧唯一索引，改为作用域化唯一索引', () => {
    const indexes = listIndexNames();
    expect(indexes).not.toContain('idx_memories_user_type_key');
    expect(indexes).toContain('idx_memories_scope_type_key');
  });

  it('同 type+key 允许存在于不同作用域（这正是本次要修的范围串用）', () => {
    const insert = dbModule.db.prepare(
      `INSERT INTO memories (id, user_id, type, key, value, scope_type, scope_id, lifecycle, revision, change_seq, enabled, source_detail)
       VALUES (?, ?, 'fact', 'runtime', 'bun', 'workspace', '/tmp/proj', 'active', 1, 999, 1, 'test')`,
    );
    expect(() => insert.run('m-ws-duplicate-key', USER_ID)).not.toThrow();
  });

  it('同作用域内重复 type+key 仍被唯一索引拦住', () => {
    const insert = dbModule.db.prepare(
      `INSERT INTO memories (id, user_id, type, key, value, scope_type, scope_id, lifecycle, revision, change_seq, enabled, source_detail)
       VALUES (?, ?, 'fact', 'runtime', 'deno', 'user', ?, 'active', 1, 1000, 1, 'test')`,
    );
    expect(() => insert.run('m-user-duplicate-key', USER_ID, USER_ID)).toThrow();
  });

  it('归档条目让出唯一键（lifecycle 参与唯一索引条件）', () => {
    dbModule.db
      .prepare(`UPDATE memories SET lifecycle = 'archived', enabled = 0 WHERE id = 'm-personal'`)
      .run();
    const insert = dbModule.db.prepare(
      `INSERT INTO memories (id, user_id, type, key, value, scope_type, scope_id, lifecycle, revision, change_seq, enabled)
       VALUES (?, ?, 'fact', 'runtime', 'node-22', 'user', ?, 'active', 1, 1001, 1)`,
    );
    expect(() => insert.run('m-user-after-archive', USER_ID, USER_ID)).not.toThrow();
    dbModule.db.prepare('DELETE FROM memories WHERE id = ?').run('m-user-after-archive');
    dbModule.db
      .prepare(`UPDATE memories SET lifecycle = 'active', enabled = 1 WHERE id = 'm-personal'`)
      .run();
  });

  it('建出全部治理表', () => {
    for (const name of [
      'memory_change_counter',
      'memory_proposals',
      'memory_review_decisions',
      'memory_revisions',
      'memory_jobs',
      'memory_maintenance_state',
      'memory_scope_watermarks',
      'memory_maintenance_reports',
      'memory_deliveries',
      'memory_message_provenance',
      'memory_rule_entries',
    ]) {
      expect(tableExists(name), name).toBe(true);
    }
  });

  it('已有job旧索引升级为含user_id的唯一键且保留任务', async () => {
    dbModule.sqliteRun('DROP INDEX IF EXISTS idx_memory_jobs_period_user');
    dbModule.sqliteRun(
      'CREATE UNIQUE INDEX idx_memory_jobs_period ON memory_jobs(kind, scope_key, period_key)',
    );
    await dbModule.migrate();
    const indexes = dbModule.sqliteAll<{ name: string }>('PRAGMA index_list(memory_jobs)');
    expect(indexes.map((entry) => entry.name)).not.toContain('idx_memory_jobs_period');
    const columns = dbModule.sqliteAll<{ name: string }>(
      'PRAGMA index_info(idx_memory_jobs_period_user)',
    );
    expect(columns.map((entry) => entry.name)).toEqual([
      'user_id',
      'kind',
      'scope_key',
      'period_key',
    ]);
  });

  it('重复迁移是 no-op（不重置作用域，也不重排水位）', async () => {
    const before = readMemories();
    const counterBefore = readCounter();
    await dbModule.migrate();
    const after = readMemories();
    expect(after).toEqual(before);
    expect(readCounter()).toBe(counterBefore);
  });
});
