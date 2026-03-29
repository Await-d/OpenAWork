import { DatabaseSync } from 'node:sqlite';
import { parse, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import {
  dedupeWorkspaceRoots,
  discoverWorkspaceRoot,
  parseConfiguredWorkspaceRoots,
  parseWorkspaceAccessMode,
} from './workspace-config.js';

const DB_PATH =
  globalThis.process?.env['DATABASE_URL'] ?? resolve(process.cwd(), 'data', 'openAwork.db');

const configuredWorkspaceRoots = parseConfiguredWorkspaceRoots(process.env['WORKSPACE_ROOTS']);
const explicitWorkspaceRoot = process.env['WORKSPACE_ROOT'];
const fallbackWorkspaceRoot = explicitWorkspaceRoot ?? discoverWorkspaceRoot(process.cwd());
const hasExplicitWorkspaceRoots =
  configuredWorkspaceRoots.length > 0 || Boolean(explicitWorkspaceRoot);

export const WORKSPACE_ROOTS = dedupeWorkspaceRoots(
  configuredWorkspaceRoots.length > 0 ? configuredWorkspaceRoots : [fallbackWorkspaceRoot],
);

export const WORKSPACE_ROOT = WORKSPACE_ROOTS[0] ?? resolve(process.cwd());
export const WORKSPACE_ACCESS_MODE = parseWorkspaceAccessMode(
  process.env['WORKSPACE_ACCESS_MODE'],
  hasExplicitWorkspaceRoots,
);
export const WORKSPACE_ACCESS_RESTRICTED = WORKSPACE_ACCESS_MODE === 'restricted';
export const WORKSPACE_BROWSER_ROOT =
  parse(WORKSPACE_ROOT).root || parse(process.cwd()).root || resolve('/');

const dbDir = DB_PATH === ':memory:' ? null : DB_PATH.replace(/\/[^/]+$/, '');
if (dbDir) mkdirSync(dbDir, { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode=WAL');
db.exec('PRAGMA foreign_keys=ON');

const sessionStore = new Map<string, boolean>();

export const redis = {
  setex(key: string, _ttl: number, value: string) {
    sessionStore.set(key, value === '1');
  },
  del(key: string) {
    sessionStore.delete(key);
  },
  get(key: string) {
    return sessionStore.get(key) ? '1' : null;
  },
};

export async function connectDb(): Promise<void> {
  db.exec('SELECT 1');
}

export async function closeDb(): Promise<void> {
  db.close();
}

export async function migrate(): Promise<void> {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      messages_json TEXT NOT NULL DEFAULT '[]',
      state_status TEXT NOT NULL DEFAULT 'idle',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      title TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS session_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      role TEXT NOT NULL,
      content_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'final',
      client_request_id TEXT,
      created_at_ms INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(session_id, seq)
    )
  `);
  db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_session_messages_request_role ON session_messages(session_id, client_request_id, role) WHERE client_request_id IS NOT NULL',
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_session_messages_created ON session_messages(session_id, created_at_ms)',
  );

  migrateSessionTodosTable();

  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      tool_name TEXT NOT NULL,
      request_id TEXT NOT NULL,
      input_json TEXT,
      output_json TEXT,
      is_error INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS permission_requests (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      tool_name TEXT NOT NULL,
      scope TEXT NOT NULL,
      reason TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      preview_action TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      decision TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  ensureColumn('permission_requests', 'request_payload_json', 'TEXT');

  db.exec(`
    CREATE TABLE IF NOT EXISTS question_requests (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tool_name TEXT NOT NULL,
      title TEXT NOT NULL,
      questions_json TEXT NOT NULL,
      answer_json TEXT,
      request_payload_json TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_parent_auto_resume_contexts (
      child_session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      parent_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL,
      request_data_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      month TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, month)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS team_members (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      avatar_url TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS team_tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      assignee_id TEXT REFERENCES team_members(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      priority TEXT NOT NULL DEFAULT 'medium',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  ensureColumn('team_tasks', 'result', 'TEXT');

  db.exec(`
    CREATE TABLE IF NOT EXISTS team_messages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sender_id TEXT REFERENCES team_members(id) ON DELETE SET NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  ensureColumn('team_messages', 'type', "TEXT NOT NULL DEFAULT 'update'");

  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_templates (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL DEFAULT 'general',
      nodes_json TEXT NOT NULL DEFAULT '[]',
      edges_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, key)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS installed_skills (
      skill_id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL,
      manifest_json TEXT NOT NULL,
      granted_permissions_json TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1,
      installed_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (skill_id, user_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS registry_sources (
      id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'community',
      trust TEXT NOT NULL DEFAULT 'untrusted',
      enabled INTEGER NOT NULL DEFAULT 1,
      priority INTEGER NOT NULL DEFAULT 10,
      auth_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (id, user_id)
    )
  `);

  ensureColumn('registry_sources', 'last_synced_at', 'INTEGER');
  ensureColumn('registry_sources', 'last_sync_attempt_at', 'INTEGER');
  ensureColumn('registry_sources', 'last_sync_error', 'TEXT');
  ensureColumn('registry_sources', 'cached_skill_count', 'INTEGER NOT NULL DEFAULT 0');

  db.exec(`
    CREATE TABLE IF NOT EXISTS registry_source_skill_cache (
      source_id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      skill_id TEXT NOT NULL,
      category TEXT NOT NULL,
      search_text TEXT NOT NULL,
      entry_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (source_id, user_id, skill_id)
    )
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_registry_source_skill_cache_user_source ON registry_source_skill_cache(user_id, source_id)',
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_registry_source_skill_cache_user_category ON registry_source_skill_cache(user_id, category)',
  );
}

function ensureColumn(table: string, column: string, definition: string): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  const exists = rows.some((row) => row.name === column);
  if (!exists) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function migrateSessionTodosTable(): void {
  const rows = db.prepare('PRAGMA table_info(session_todos)').all() as Array<{ name: string }>;
  if (rows.length === 0) {
    createSessionTodosTable();
    return;
  }

  const hasLane = rows.some((row) => row.name === 'lane');
  if (hasLane) {
    db.exec(
      'CREATE INDEX IF NOT EXISTS idx_session_todos_session_lane ON session_todos(session_id, lane)',
    );
    return;
  }

  db.exec('ALTER TABLE session_todos RENAME TO session_todos_legacy');
  createSessionTodosTable();
  db.exec(`
    INSERT INTO session_todos (session_id, lane, position, content, status, priority, created_at)
    SELECT session_id, 'main', position, content, status, priority, created_at
    FROM session_todos_legacy
  `);
  db.exec('DROP TABLE session_todos_legacy');
}

function createSessionTodosTable(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_todos (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      lane TEXT NOT NULL,
      position INTEGER NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL,
      priority TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (session_id, lane, position)
    )
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_session_todos_session_lane ON session_todos(session_id, lane)',
  );
}

type SQLValue = string | number | bigint | Uint8Array | null;

export function sqliteRun(query: string, params: SQLValue[] = []): void {
  const stmt = db.prepare(query);
  stmt.run(...params);
}

export function sqliteGet<T>(query: string, params: SQLValue[] = []): T | undefined {
  const stmt = db.prepare(query);
  return stmt.get(...params) as T | undefined;
}

export function sqliteAll<T>(query: string, params: SQLValue[] = []): T[] {
  const stmt = db.prepare(query);
  return stmt.all(...params) as T[];
}
