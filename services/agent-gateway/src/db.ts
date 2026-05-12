import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, parse, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import {
  dedupeWorkspaceRoots,
  discoverWorkspaceRoot,
  parseConfiguredWorkspaceRoots,
  parseWorkspaceAccessMode,
} from './workspace-config.js';
import { loadAppVersion } from './app-version.js';
import { resolveGatewayDatabasePath } from './storage-paths.js';
import {
  normalizeToolArgumentsForStorage,
  normalizeToolResultOutputForStorage,
  stringifyToolResultOutput,
} from './tool-result-contract.js';
import { normalizeSqliteBindParams, type SqliteBindableValue } from './sqlite-bind-params.js';

interface SqliteStatement {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): unknown;
}

interface GatewayDatabase {
  close(): void;
  exec(sql: string): unknown;
  prepare(sql: string): SqliteStatement;
}

type DatabaseConstructor = new (path: string) => GatewayDatabase;

const requireRuntimeModule = createRequire(import.meta.url);

function loadDatabaseConstructor(): DatabaseConstructor {
  const runtime = globalThis as typeof globalThis & { Bun?: unknown };
  const moduleName = runtime.Bun ? 'bun:sqlite' : 'node:sqlite';
  const sqliteModule = requireRuntimeModule(moduleName) as {
    Database?: DatabaseConstructor;
    DatabaseSync?: DatabaseConstructor;
  };
  const Database = sqliteModule.DatabaseSync ?? sqliteModule.Database;
  if (!Database) {
    throw new Error(`SQLite runtime module ${moduleName} did not expose a database constructor`);
  }

  return Database;
}

const DatabaseSync = loadDatabaseConstructor();

function resolveDbPath(): string {
  return resolveGatewayDatabasePath();
}

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

function createDatabase(dbPath: string): GatewayDatabase {
  const dbDir = dbPath === ':memory:' ? null : dirname(dbPath);
  if (dbDir) mkdirSync(dbDir, { recursive: true });
  const database = new DatabaseSync(dbPath);
  database.exec('PRAGMA journal_mode=WAL');
  database.exec('PRAGMA foreign_keys=ON');
  return database;
}

let currentDbPath = resolveDbPath();
let dbClosed = false;

export let db = createDatabase(currentDbPath);

function buildSearchableMessageTextForMigration(contentJson: string): string {
  try {
    const parsed = JSON.parse(contentJson) as unknown;
    if (!Array.isArray(parsed)) {
      return '';
    }

    return parsed
      .flatMap((item) => {
        if (!item || typeof item !== 'object') {
          return [];
        }
        const record = item as Record<string, unknown>;
        if (record['type'] === 'text' && typeof record['text'] === 'string') {
          return [record['text']];
        }
        if (record['type'] === 'modified_files_summary') {
          const title = typeof record['title'] === 'string' ? record['title'] : '';
          const summary = typeof record['summary'] === 'string' ? record['summary'] : '';
          return [[title, summary].filter((value) => value.length > 0).join('：')];
        }
        return [];
      })
      .join('\n')
      .trim();
  } catch {
    return '';
  }
}

function rebuildSessionMessageSearchIndex(): void {
  db.exec('DELETE FROM session_messages_fts');
  const rows = db
    .prepare('SELECT id, session_id, user_id, role, content_json FROM session_messages')
    .all() as Array<{
    content_json: string;
    id: string;
    role: string;
    session_id: string;
    user_id: string;
  }>;
  const insert = db.prepare(
    'INSERT INTO session_messages_fts (message_id, session_id, user_id, role, content) VALUES (?, ?, ?, ?, ?)',
  );

  rows.forEach((row) => {
    const content = buildSearchableMessageTextForMigration(row.content_json);
    if (content.length === 0) {
      return;
    }

    insert.run(row.id, row.session_id, row.user_id, row.role, content);
  });
}

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
  const desiredPath = resolveDbPath();
  if (dbClosed || desiredPath !== currentDbPath) {
    if (!dbClosed) {
      db.close();
    }
    currentDbPath = desiredPath;
    db = createDatabase(currentDbPath);
    dbClosed = false;
  }
  db.exec('SELECT 1');
}

export async function closeDb(): Promise<void> {
  if (!dbClosed) {
    db.close();
    dbClosed = true;
  }
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
  db.exec(
    `CREATE TABLE IF NOT EXISTS message_ratings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      rating TEXT NOT NULL CHECK(rating IN ('up', 'down')),
      reason TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      UNIQUE(session_id, user_id, message_id)
    )`,
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_message_ratings_session ON message_ratings(session_id, user_id, updated_at DESC)',
  );
  db.exec(
    `CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unread' CHECK(status IN ('unread', 'read')),
      read_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC)',
  );
  db.exec(
    `CREATE TABLE IF NOT EXISTS notification_preferences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      channel TEXT NOT NULL,
      event_type TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, channel, event_type)
    )`,
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_notification_preferences_user ON notification_preferences(user_id, channel, event_type)',
  );
  db.exec(
    `CREATE TABLE IF NOT EXISTS session_shares (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      member_id TEXT NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
      permission TEXT NOT NULL CHECK(permission IN ('view', 'comment', 'operate')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, session_id, member_id)
    )`,
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_session_shares_user_created ON session_shares(user_id, created_at DESC)',
  );
  db.exec(
    "CREATE VIRTUAL TABLE IF NOT EXISTS session_messages_fts USING fts5(message_id UNINDEXED, session_id UNINDEXED, user_id UNINDEXED, role UNINDEXED, content, tokenize='unicode61')",
  );
  rebuildSessionMessageSearchIndex();

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
    CREATE TABLE IF NOT EXISTS session_file_diffs (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_request_id TEXT,
      request_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      tool_call_id TEXT,
      file_path TEXT NOT NULL,
      before_backup_id TEXT,
      after_backup_id TEXT,
      additions INTEGER NOT NULL DEFAULT 0,
      deletions INTEGER NOT NULL DEFAULT 0,
      status TEXT,
      source_kind TEXT,
      guarantee_level TEXT,
      observability_json TEXT,
      backup_before_ref_json TEXT,
      backup_after_ref_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (session_id, request_id, file_path)
    )
  `);
  ensureColumn('session_file_diffs', 'client_request_id', 'TEXT');
  ensureColumn('session_file_diffs', 'tool_call_id', 'TEXT');
  ensureColumn('session_file_diffs', 'source_kind', 'TEXT');
  ensureColumn('session_file_diffs', 'guarantee_level', 'TEXT');
  ensureColumn('session_file_diffs', 'observability_json', 'TEXT');
  ensureColumn('session_file_diffs', 'backup_before_ref_json', 'TEXT');
  ensureColumn('session_file_diffs', 'backup_after_ref_json', 'TEXT');
  ensureColumn('session_file_diffs', 'before_backup_id', 'TEXT');
  ensureColumn('session_file_diffs', 'after_backup_id', 'TEXT');
  migrateSessionFileDiffsDropLegacyTextColumns();

  db.exec(`
    CREATE TABLE IF NOT EXISTS permission_decision_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT NOT NULL,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      tool_name TEXT NOT NULL,
      scope TEXT NOT NULL,
      decision TEXT NOT NULL,
      workspace_root TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS request_workflow_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT NOT NULL,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      status_code INTEGER NOT NULL,
      ip TEXT,
      user_agent TEXT,
      workflow_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS session_run_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      client_request_id TEXT,
      seq INTEGER,
      event_type TEXT NOT NULL,
      event_id TEXT,
      run_id TEXT,
      occurred_at_ms INTEGER,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  ensureColumn('session_run_events', 'client_request_id', 'TEXT');
  ensureColumn('session_run_events', 'seq', 'INTEGER');

  db.exec(`
    CREATE TABLE IF NOT EXISTS session_runtime_threads (
      session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_request_id TEXT NOT NULL,
      started_at_ms INTEGER NOT NULL,
      heartbeat_at_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // session_terminals — tracks every bash / interactive_bash / background bash
  // invocation per session so the UI can render "currently running terminals"
  // and the user can kill an individual command without aborting the whole
  // LLM run. See .agentdocs/workflow/260512-session-terminal-tracking-spec.md.
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_terminals (
      terminal_id        TEXT PRIMARY KEY,
      session_id         TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_request_id  TEXT,
      tool_name          TEXT NOT NULL,
      kind               TEXT NOT NULL,
      command            TEXT NOT NULL,
      description        TEXT,
      cwd                TEXT NOT NULL,
      pid                INTEGER,
      status             TEXT NOT NULL,
      exit_code          INTEGER,
      started_at_ms      INTEGER NOT NULL,
      ended_at_ms        INTEGER,
      last_activity_ms   INTEGER NOT NULL,
      output_bytes_total INTEGER NOT NULL DEFAULT 0,
      output_tail        TEXT NOT NULL DEFAULT '',
      output_path        TEXT,
      metadata_json      TEXT NOT NULL DEFAULT '{}'
    )
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_session_terminals_session ON session_terminals(session_id, started_at_ms DESC)',
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_session_terminals_status ON session_terminals(status, session_id)',
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS session_snapshots (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_request_id TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      files_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (session_id, client_request_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS session_file_backups (
      backup_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      kind TEXT NOT NULL,
      source_tool TEXT,
      source_request_id TEXT,
      tool_call_id TEXT,
      storage_path TEXT,
      artifact_id TEXT,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_session_file_backups_session ON session_file_backups(session_id)',
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_session_file_backups_hash ON session_file_backups(content_hash)',
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_session_file_backups_storage_path ON session_file_backups(storage_path)',
  );
  ensureColumn('session_file_backups', 'content_tier', "TEXT NOT NULL DEFAULT 'text'");
  ensureColumn('session_file_backups', 'content_format', 'TEXT');
  ensureColumn('session_file_backups', 'hash_scope', "TEXT NOT NULL DEFAULT 'raw'");
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_session_file_backups_kind_hash_tier ON session_file_backups(kind, content_hash, content_tier, hash_scope)',
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      parent_version_id TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_artifacts_user_session ON artifacts(user_id, session_id)',
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_artifacts_session_updated ON artifacts(session_id, updated_at)',
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS artifact_versions (
      id TEXT PRIMARY KEY,
      artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      content TEXT NOT NULL,
      diff_json TEXT NOT NULL DEFAULT '[]',
      created_by TEXT NOT NULL,
      created_by_note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(artifact_id, version_number)
    )
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_artifact_versions_artifact_created ON artifact_versions(artifact_id, created_at)',
  );

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
  ensureColumn('permission_requests', 'expires_at', 'INTEGER');
  ensureColumn('permission_requests', 'always_json', 'TEXT');

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
  ensureColumn('question_requests', 'expires_at', 'INTEGER');

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
    CREATE TABLE IF NOT EXISTS team_workspaces (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      visibility TEXT NOT NULL DEFAULT 'private',
      default_working_root TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_team_workspaces_user_updated ON team_workspaces(user_id, updated_at DESC)',
  );

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
    CREATE TABLE IF NOT EXISTS team_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      actor_email TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_team_audit_logs_user_created ON team_audit_logs(user_id, created_at DESC)',
  );
  ensureColumn('team_audit_logs', 'actor_user_id', 'TEXT');
  ensureColumn('team_audit_logs', 'actor_email', 'TEXT');

  db.exec(`
    CREATE TABLE IF NOT EXISTS shared_session_comments (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      author_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      author_email TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_shared_session_comments_owner_session_created ON shared_session_comments(owner_user_id, session_id, created_at ASC)',
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS shared_session_presence (
      owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      viewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      viewer_email TEXT NOT NULL,
      first_seen_at_ms INTEGER NOT NULL,
      last_seen_at_ms INTEGER NOT NULL,
      PRIMARY KEY (owner_user_id, session_id, viewer_user_id)
    )
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_shared_session_presence_owner_session_last_seen ON shared_session_presence(owner_user_id, session_id, last_seen_at_ms DESC)',
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_templates (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL DEFAULT 'general',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      nodes_json TEXT NOT NULL DEFAULT '[]',
      edges_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  ensureColumn('workflow_templates', 'metadata_json', "TEXT NOT NULL DEFAULT '{}' ");

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
  // Populated by the periodic GitHub-version check background task; lets
  // the UI surface an "更新可用" badge for installed-from-market skills.
  // Stored shape: {"latestVersion": string|null, "checkedAt": number, "error": string|null}.
  ensureColumn('installed_skills', 'latest_version_check_json', 'TEXT');

  // ─── Chat Workspace Skill Selection (PR1 of skill-workspace-selection spec) ───
  // Per-user skill selection set keyed by chat workspace path. Empty table
  // means "never configured" → runtime falls back to installed_skills.enabled.
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_workspace_skill_selections (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      workspace_path TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      pinned INTEGER NOT NULL DEFAULT 0,
      reason TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, workspace_path, skill_id)
    )
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_cwss_user_path ON chat_workspace_skill_selections(user_id, workspace_path)',
  );
  // `priority` controls the rendering / truncation order of pinned skills in
  // the system prompt section (see `pinned-skills-prompt.ts`). Lower values
  // appear first; equal values fall back to alphabetic skill_id ordering.
  // Added via `ensureColumn` so existing deployments upgrade in place
  // without losing data — older rows default to 0 which keeps current
  // behavior (insertion-order rendering).
  ensureColumn('chat_workspace_skill_selections', 'priority', 'INTEGER NOT NULL DEFAULT 0');

  // Marker table that records *whether* a (user, workspace_path) tuple has
  // been explicitly configured, even when the resulting selection set is
  // empty. Without this row, an empty `chat_workspace_skill_selections`
  // result is ambiguous — it could either mean "never configured" (→ fall
  // back to installed_skills.enabled) or "user explicitly disabled
  // everything" (→ effective set should be BUILTIN-only). The PUT handler
  // upserts here on every save so the resolver can disambiguate.
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_workspace_skill_configured (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      workspace_path TEXT NOT NULL,
      configured_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, workspace_path)
    )
  `);

  // Per-session override. Row means the user explicitly flipped this skill
  // for the current session. pinned is nullable — null means "inherit from
  // workspace default for pinned", only enabled is overridden.
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_session_skill_overrides (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      skill_id TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      pinned INTEGER,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (session_id, skill_id)
    )
  `);

  // Audit trail for the one-click AI recommendation workflow. applied=0 rows
  // are pending review; applied=1 rows have been committed to
  // chat_workspace_skill_selections with source='ai-recommend'.
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_workspace_skill_recommendations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      workspace_path TEXT NOT NULL,
      signal_digest TEXT NOT NULL,
      model_id TEXT,
      result_json TEXT NOT NULL,
      applied INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_cwsr_user_path_created ON chat_workspace_skill_recommendations(user_id, workspace_path, created_at DESC)',
  );

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

  db.exec(`
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
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_memories_user_enabled ON memories(user_id, enabled)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_memories_user_type ON memories(user_id, type)');
  db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_user_type_key ON memories(user_id, type, key) WHERE enabled = 1',
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_extraction_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      client_request_id TEXT NOT NULL,
      extracted_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, session_id, client_request_id)
    )
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_memory_extraction_logs_user ON memory_extraction_logs(user_id)',
  );

  // ─── V2 Message Store (opencode-style Session → Message → Part) ───

  db.exec(`
    CREATE TABLE IF NOT EXISTS message_v2 (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      time_created INTEGER NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_message_v2_session_time ON message_v2(session_id, time_created, id)',
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS part_v2 (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES message_v2(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      time_created INTEGER NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_part_v2_message ON part_v2(message_id, id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_part_v2_session ON part_v2(session_id)');

  // ─── Event Sourcing (SyncEvent) ───

  db.exec(`
    CREATE TABLE IF NOT EXISTS event_log (
      id TEXT PRIMARY KEY,
      aggregate_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      version INTEGER NOT NULL,
      data TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // ─── SessionEvent (opencode-aligned typed stream events) ───
  // Distinct from session_run_events: this table stores the lower-level
  // typed event taxonomy (text.delta, tool.input.*, tool.success, etc.)
  // mirroring opencode's session_entry table, and powers replaySessionEntries.
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_entry (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_request_id TEXT,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_session_entry_session_seq ON session_entry(session_id, seq, timestamp)',
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_session_entry_session_request ON session_entry(session_id, client_request_id, seq)',
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS event_sequences (
      aggregate_id TEXT PRIMARY KEY,
      seq INTEGER NOT NULL DEFAULT 0
    )
  `);

  migrateSyncEventTables();

  // ─── V1 → V2 Data Migration ───
  migrateV1MessagesToV2();

  // ─── V2 Session Columns (event-sourcing projectors) ───
  ensureColumn('sessions', 'parent_id', 'TEXT DEFAULT NULL');
  ensureColumn('sessions', 'workspace_id', 'TEXT DEFAULT NULL');
  ensureColumn('sessions', 'time_created', 'TEXT DEFAULT NULL');
  ensureColumn('sessions', 'time_updated', 'TEXT DEFAULT NULL');
  ensureColumn('sessions', 'time_compacting', 'TEXT DEFAULT NULL');
  ensureColumn('sessions', 'time_archived', 'TEXT DEFAULT NULL');
  ensureColumn('sessions', 'summary_additions', 'INTEGER DEFAULT NULL');
  ensureColumn('sessions', 'summary_deletions', 'INTEGER DEFAULT NULL');
  ensureColumn('sessions', 'summary_files', 'INTEGER DEFAULT NULL');
  ensureColumn('sessions', 'summary_diffs', 'TEXT DEFAULT NULL');
  ensureColumn('sessions', 'revert', 'TEXT DEFAULT NULL');
  ensureColumn('sessions', 'permission', 'TEXT DEFAULT NULL');

  // ─── App meta：跨版本状态戳 ───
  // 卸载桌面端但「保留用户数据」时，旧的 sqlite 仍在新版本启动时被复用。
  // 这里建立一张轻量的 key/value meta 表，为后续「按版本号触发兼容修补」
  // 提供锚点；同时在每次 migrate 完成后落入「当前版本号」，记录上一次
  // 启动时的版本（previous_app_version），供观测/日志使用。
  ensureAppMetaTable();
  stampCurrentAppVersion();
}

function ensureAppMetaTable(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

/** 读取 app_meta 中的某个 key；表/行不存在时返回 undefined。 */
export function getAppMetaValue(key: string): string | undefined {
  try {
    const row = db.prepare('SELECT value FROM app_meta WHERE key = ? LIMIT 1').get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  } catch {
    return undefined;
  }
}

export function setAppMetaValue(key: string, value: string): void {
  db.prepare(
    `INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  ).run(key, value);
}

const APP_META_KEY_APP_VERSION = 'app_version';
const APP_META_KEY_PREVIOUS_APP_VERSION = 'previous_app_version';
const APP_META_KEY_FIRST_SEEN_VERSION = 'first_seen_app_version';

export interface AppVersionStamp {
  /** 本次启动写入的当前版本号。 */
  currentVersion: string;
  /** 上一次启动写入的版本号；首次启动 / 旧库无戳时为 null。 */
  previousVersion: string | null;
  /** 库里第一次见到的版本号（用于排查老用户最初安装版本）。 */
  firstSeenVersion: string;
  /** 与上次版本不一致 → upgrade（也包含 downgrade）。 */
  upgraded: boolean;
}

/**
 * 把当前进程的 app version 写入 `app_meta`，并返回对比结果。
 * 调用方可以根据 `upgraded` 决定是否打日志或触发未来的兼容修补。
 */
export function stampCurrentAppVersion(): AppVersionStamp {
  const currentVersion = loadAppVersion();
  const previousRaw = getAppMetaValue(APP_META_KEY_APP_VERSION);
  const previousVersion = previousRaw && previousRaw.length > 0 ? previousRaw : null;
  const firstSeenStored = getAppMetaValue(APP_META_KEY_FIRST_SEEN_VERSION);

  if (previousVersion && previousVersion !== currentVersion) {
    setAppMetaValue(APP_META_KEY_PREVIOUS_APP_VERSION, previousVersion);
    // 升级/降级日志走 stdout，避免 pull `WorkflowLogger` 造成循环依赖。
    // 该日志在 gateway 启动时输出一行，便于排查「卸载未清数据 → 升级后行为异常」类问题。
    console.log(
      `[app-version] gateway boot detected version change: ${previousVersion} -> ${currentVersion}`,
    );
  }

  setAppMetaValue(APP_META_KEY_APP_VERSION, currentVersion);
  if (!firstSeenStored) {
    setAppMetaValue(APP_META_KEY_FIRST_SEEN_VERSION, currentVersion);
  }

  return {
    currentVersion,
    previousVersion,
    firstSeenVersion: firstSeenStored ?? currentVersion,
    upgraded: previousVersion !== null && previousVersion !== currentVersion,
  };
}

function ensureColumn(table: string, column: string, definition: string): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  const exists = rows.some((row) => row.name === column);
  if (!exists) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function migrateSessionFileDiffsDropLegacyTextColumns(): void {
  const cols = db.prepare('PRAGMA table_info(session_file_diffs)').all() as Array<{
    name: string;
    notnull: number;
  }>;
  const hasBeforeText = cols.some((c) => c.name === 'before_text');
  if (!hasBeforeText) return;

  db.exec(`
    CREATE TABLE session_file_diffs_new (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_request_id TEXT,
      request_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      tool_call_id TEXT,
      file_path TEXT NOT NULL,
      before_backup_id TEXT,
      after_backup_id TEXT,
      additions INTEGER NOT NULL DEFAULT 0,
      deletions INTEGER NOT NULL DEFAULT 0,
      status TEXT,
      source_kind TEXT,
      guarantee_level TEXT,
      observability_json TEXT,
      backup_before_ref_json TEXT,
      backup_after_ref_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (session_id, request_id, file_path)
    )
  `);
  db.exec(`
    INSERT INTO session_file_diffs_new
      (session_id, user_id, client_request_id, request_id, tool_name, tool_call_id,
       file_path, before_backup_id, after_backup_id, additions, deletions,
       status, source_kind, guarantee_level, observability_json,
       backup_before_ref_json, backup_after_ref_json, created_at)
    SELECT
      session_id, user_id, client_request_id, request_id, tool_name, tool_call_id,
      file_path, before_backup_id, after_backup_id, additions, deletions,
      status, source_kind, guarantee_level, observability_json,
      backup_before_ref_json, backup_after_ref_json, created_at
    FROM session_file_diffs
  `);
  db.exec('DROP TABLE session_file_diffs');
  db.exec('ALTER TABLE session_file_diffs_new RENAME TO session_file_diffs');
}

function migrateSyncEventTables(): void {
  db.exec('DROP INDEX IF EXISTS idx_event_log_aggregate_seq');

  db.exec(`
    DELETE FROM event_log
    WHERE rowid NOT IN (
      SELECT MIN(rowid)
      FROM event_log
      GROUP BY aggregate_id, seq
    )
  `);

  db.exec('DELETE FROM event_sequences');
  db.exec(`
    INSERT INTO event_sequences (aggregate_id, seq)
    SELECT aggregate_id, MAX(seq)
    FROM event_log
    GROUP BY aggregate_id
  `);

  db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS uq_event_log_aggregate_seq ON event_log(aggregate_id, seq)',
  );
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

function migrateV1MessagesToV2(): void {
  // Check if migration is needed: if message_v2 is empty but session_messages has data
  const v2Count = db.prepare('SELECT COUNT(*) as cnt FROM message_v2').get() as { cnt: number };
  if (v2Count.cnt > 0) {
    return; // Already migrated
  }

  const v1Count = db.prepare('SELECT COUNT(*) as cnt FROM session_messages').get() as {
    cnt: number;
  };
  if (v1Count.cnt === 0) {
    return; // Nothing to migrate
  }

  console.log(`[V2_MIGRATION] Starting V1→V2 migration of ${v1Count.cnt} messages...`);

  const rows = db
    .prepare(
      'SELECT id, session_id, user_id, seq, role, content_json, status, client_request_id, created_at_ms FROM session_messages ORDER BY session_id, seq ASC',
    )
    .all() as Array<{
    id: string;
    session_id: string;
    user_id: string;
    seq: number;
    role: string;
    content_json: string;
    status: string;
    client_request_id: string | null;
    created_at_ms: number;
  }>;

  let migratedMessages = 0;
  let migratedParts = 0;

  for (const row of rows) {
    // Insert message row
    const infoData: Record<string, unknown> = {
      role: row.role,
      time: { created: row.created_at_ms },
    };
    if (row.role === 'assistant') {
      Object.assign(infoData, {
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      });
    }
    db.prepare(
      'INSERT OR IGNORE INTO message_v2 (id, session_id, user_id, time_created, data) VALUES (?, ?, ?, ?, ?)',
    ).run(row.id, row.session_id, row.user_id, row.created_at_ms, JSON.stringify(infoData));

    migratedMessages++;

    // Parse content_json and create parts
    let content: unknown[];
    try {
      content = JSON.parse(row.content_json) as unknown[];
    } catch {
      continue;
    }

    for (const item of content) {
      const part = item as Record<string, unknown>;
      const partId = randomUUID();
      let partData: Record<string, unknown>;

      if (part['type'] === 'text') {
        partData = { type: 'text', text: part['text'] ?? '' };
      } else if (part['type'] === 'tool_call') {
        const input = (part['input'] as Record<string, unknown>) ?? {};
        partData = {
          type: 'tool',
          callID: part['toolCallId'] ?? '',
          tool: part['toolName'] ?? '',
          state: {
            status: 'pending',
            input,
            raw: normalizeToolArgumentsForStorage(part['rawArguments'] ?? input),
          },
        };
      } else if (part['type'] === 'tool_result') {
        // Don't create a separate part for tool_result — find and update the ToolPart
        const callID = part['toolCallId'] as string;
        if (callID) {
          const partRows = db
            .prepare('SELECT id, data FROM part_v2 WHERE session_id = ? AND message_id = ?')
            .all(row.session_id, row.id) as Array<{ id: string; data: string }>;

          for (const pr of partRows) {
            const pd = JSON.parse(pr.data) as Record<string, unknown>;
            if (pd['type'] === 'tool' && pd['callID'] === callID) {
              const isError = part['isError'] === true;
              const output = part['output'];
              const outputStr = stringifyToolResultOutput(
                normalizeToolResultOutputForStorage(output),
              );
              if (isError) {
                pd['state'] = {
                  status: 'error',
                  input: (pd['state'] as Record<string, unknown>)?.['input'] ?? {},
                  error: outputStr,
                  time: { start: row.created_at_ms, end: row.created_at_ms },
                };
              } else {
                pd['state'] = {
                  status: 'completed',
                  input: (pd['state'] as Record<string, unknown>)?.['input'] ?? {},
                  output: outputStr,
                  title: (part['toolName'] as string) ?? callID,
                  metadata: {},
                  time: { start: row.created_at_ms, end: row.created_at_ms },
                };
              }
              db.prepare('UPDATE part_v2 SET data = ? WHERE id = ?').run(JSON.stringify(pd), pr.id);
              break;
            }
          }
        }
        continue;
      } else if (part['type'] === 'modified_files_summary') {
        partData = {
          type: 'modified_files_summary',
          title: part['title'] ?? '',
          summary: part['summary'] ?? '',
          files: part['files'] ?? [],
        };
      } else {
        continue;
      }

      db.prepare(
        'INSERT OR IGNORE INTO part_v2 (id, message_id, session_id, user_id, time_created, data) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(
        partId,
        row.id,
        row.session_id,
        row.user_id,
        row.created_at_ms,
        JSON.stringify(partData),
      );

      migratedParts++;
    }
  }

  console.log(
    `[V2_MIGRATION] Complete: ${migratedMessages} messages, ${migratedParts} parts migrated`,
  );
}

export function sqliteRun(query: string, params: readonly SqliteBindableValue[] = []): void {
  const stmt = db.prepare(query);
  stmt.run(...normalizeSqliteBindParams(params));
}

export function sqliteGet<T>(
  query: string,
  params: readonly SqliteBindableValue[] = [],
): T | undefined {
  const stmt = db.prepare(query);
  // bun:sqlite 在没有匹配行时返回 `null`，node:sqlite 返回 `undefined`。
  // 上层代码大量使用 `row !== undefined` / `row != null` 等判断，统一在
  // 这里把 `null` 折叠为 `undefined`，让所有 caller 在两种 runtime 下行为一致。
  const row = stmt.get(...normalizeSqliteBindParams(params));
  return (row ?? undefined) as T | undefined;
}

export function sqliteAll<T>(query: string, params: readonly SqliteBindableValue[] = []): T[] {
  const stmt = db.prepare(query);
  return stmt.all(...normalizeSqliteBindParams(params)) as T[];
}

export function sqliteTransaction<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
