/**
 * 持久化 SSH 状态：连接定义、与 Chat 会话的绑定、最近打开的 SSH 对话。
 *
 * 之前 `routes/ssh.ts` 持有的 `SSHConnectionManagerImpl` 与
 * `SSHSessionBindingRegistry` 都是纯内存 Map，gateway 进程一旦重启
 * 就会丢掉「连接列表」「与会话的绑定」以及「面板上次打开的 SSH 对话」。
 * 本模块把这些状态全部落到 SQLite，并提供：
 *
 * 1. 进程启动时读出的"持久化 manifest"——上层据此重建 manager / bindings；
 * 2. 显式的 `dialogs` 表（`ssh_dialogs`），代表「一次打开的 SSH 对话」，
 *    保存最近浏览路径、最近预览文件、最后激活时间。前端在重启后能直接
 *    打开上一次的对话窗口，而不是被甩回空白面板。
 *
 * 凭证（密码 / 私钥路径）写入前会经过 `ssh-secret-cipher`，杜绝
 * 明文落盘；read 时先解密再交给 ssh2 客户端。
 */

import { randomUUID } from 'node:crypto';
import { db } from '../infra/db.js';
import { decryptSecret, encryptSecret } from './ssh-secret-cipher.js';

export type SshAuthType = 'password' | 'key' | 'agent';
export type SshConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'error';

export interface PersistedSshConnection {
  id: string;
  userId: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: SshAuthType;
  privateKeyPath: string | null;
  /** 解密后的密码；上层使用完毕后切勿写日志。 */
  password: string | null;
  /** 是否在 gateway 启动时自动 reconnect。默认 true。 */
  autoReconnect: boolean;
  status: SshConnectionStatus;
  /** 最近一次连接结果中记录到的错误信息，可用于 UI 排错。 */
  lastError: string | null;
  lastConnectedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface PersistedSshBinding {
  sessionId: string;
  userId: string;
  connectionId: string;
  updatedAt: number;
}

export interface PersistedSshDialog {
  id: string;
  userId: string;
  connectionId: string;
  /** UI 显示标签；缺省时回退到 `${user}@${host}`。 */
  title: string | null;
  /** 最近一次浏览的远端目录。 */
  cwd: string;
  /** 上次预览过的文件路径；用于重启后重新打开预览面板。 */
  lastFilePath: string | null;
  /** 上次预览的内容编码；目前只用 utf8 / base64。 */
  lastFileEncoding: 'utf8' | 'base64' | null;
  /** Pinned 的对话不会被滚动裁剪；预留给前端置顶交互。 */
  pinned: boolean;
  /** 最近一次激活该对话的时间，用于「上一次打开的 SSH 对话」回填。 */
  lastOpenedAt: number;
  createdAt: number;
  updatedAt: number;
}

interface SshConnectionRow {
  id: string;
  user_id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  auth_type: SshAuthType;
  private_key_path: string | null;
  password_cipher: string | null;
  auto_reconnect: number;
  status: SshConnectionStatus;
  last_error: string | null;
  last_connected_at: number | null;
  created_at: number;
  updated_at: number;
}

interface SshBindingRow {
  session_id: string;
  user_id: string;
  connection_id: string;
  updated_at: number;
}

interface SshDialogRow {
  id: string;
  user_id: string;
  connection_id: string;
  title: string | null;
  cwd: string;
  last_file_path: string | null;
  last_file_encoding: 'utf8' | 'base64' | null;
  pinned: number;
  last_opened_at: number;
  created_at: number;
  updated_at: number;
}

let migrated = false;

export function migrateSshTables(): void {
  if (migrated) return;
  migrated = true;

  db.exec(`
    CREATE TABLE IF NOT EXISTS ssh_connections (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 22,
      username TEXT NOT NULL,
      auth_type TEXT NOT NULL,
      private_key_path TEXT,
      password_cipher TEXT,
      auto_reconnect INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'disconnected',
      last_error TEXT,
      last_connected_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_ssh_connections_user ON ssh_connections(user_id, updated_at DESC)',
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS ssh_session_bindings (
      session_id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      connection_id TEXT NOT NULL REFERENCES ssh_connections(id) ON DELETE CASCADE,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (session_id, user_id)
    )
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_ssh_session_bindings_user ON ssh_session_bindings(user_id, updated_at DESC)',
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS ssh_dialogs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      connection_id TEXT NOT NULL REFERENCES ssh_connections(id) ON DELETE CASCADE,
      title TEXT,
      cwd TEXT NOT NULL DEFAULT '/',
      last_file_path TEXT,
      last_file_encoding TEXT,
      pinned INTEGER NOT NULL DEFAULT 0,
      last_opened_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_ssh_dialogs_user_recent ON ssh_dialogs(user_id, last_opened_at DESC)',
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_ssh_dialogs_connection ON ssh_dialogs(connection_id)',
  );
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_ssh_dialogs_user_connection ON ssh_dialogs(user_id, connection_id)",
  );
}

function rowToConnection(row: SshConnectionRow): PersistedSshConnection {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    host: row.host,
    port: row.port,
    username: row.username,
    authType: row.auth_type,
    privateKeyPath: row.private_key_path,
    password: decryptSecret(row.password_cipher),
    autoReconnect: row.auto_reconnect === 1,
    status: row.status,
    lastError: row.last_error,
    lastConnectedAt: row.last_connected_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToBinding(row: SshBindingRow): PersistedSshBinding {
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    connectionId: row.connection_id,
    updatedAt: row.updated_at,
  };
}

function rowToDialog(row: SshDialogRow): PersistedSshDialog {
  return {
    id: row.id,
    userId: row.user_id,
    connectionId: row.connection_id,
    title: row.title,
    cwd: row.cwd || '/',
    lastFilePath: row.last_file_path,
    lastFileEncoding: row.last_file_encoding,
    pinned: row.pinned === 1,
    lastOpenedAt: row.last_opened_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateSshConnectionInput {
  userId: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: SshAuthType;
  privateKeyPath?: string | null;
  password?: string | null;
  autoReconnect?: boolean;
}

export function createSshConnection(input: CreateSshConnectionInput): PersistedSshConnection {
  migrateSshTables();
  const id = randomUUID();
  const now = Date.now();
  const row: SshConnectionRow = {
    id,
    user_id: input.userId,
    name: input.name,
    host: input.host,
    port: input.port,
    username: input.username,
    auth_type: input.authType,
    private_key_path: input.privateKeyPath ?? null,
    password_cipher: encryptSecret(input.password ?? null),
    auto_reconnect: input.autoReconnect === false ? 0 : 1,
    status: 'disconnected',
    last_error: null,
    last_connected_at: null,
    created_at: now,
    updated_at: now,
  };
  db.prepare(
    `INSERT INTO ssh_connections (
       id, user_id, name, host, port, username, auth_type,
       private_key_path, password_cipher, auto_reconnect,
       status, last_error, last_connected_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.user_id,
    row.name,
    row.host,
    row.port,
    row.username,
    row.auth_type,
    row.private_key_path,
    row.password_cipher,
    row.auto_reconnect,
    row.status,
    row.last_error,
    row.last_connected_at,
    row.created_at,
    row.updated_at,
  );
  return rowToConnection(row);
}

export interface UpdateSshConnectionInput {
  name?: string;
  host?: string;
  port?: number;
  username?: string;
  authType?: SshAuthType;
  privateKeyPath?: string | null;
  password?: string | null;
  autoReconnect?: boolean;
}

export function updateSshConnection(
  userId: string,
  connectionId: string,
  patch: UpdateSshConnectionInput,
): PersistedSshConnection | null {
  migrateSshTables();
  const existing = db
    .prepare('SELECT * FROM ssh_connections WHERE id = ? AND user_id = ?')
    .get(connectionId, userId) as SshConnectionRow | undefined;
  if (!existing) return null;
  const next: SshConnectionRow = {
    ...existing,
    name: patch.name ?? existing.name,
    host: patch.host ?? existing.host,
    port: patch.port ?? existing.port,
    username: patch.username ?? existing.username,
    auth_type: patch.authType ?? existing.auth_type,
    private_key_path:
      patch.privateKeyPath === undefined ? existing.private_key_path : patch.privateKeyPath,
    password_cipher:
      patch.password === undefined
        ? existing.password_cipher
        : encryptSecret(patch.password ?? null),
    auto_reconnect:
      patch.autoReconnect === undefined ? existing.auto_reconnect : patch.autoReconnect ? 1 : 0,
    updated_at: Date.now(),
  };
  db.prepare(
    `UPDATE ssh_connections SET
       name = ?, host = ?, port = ?, username = ?, auth_type = ?,
       private_key_path = ?, password_cipher = ?, auto_reconnect = ?,
       updated_at = ?
     WHERE id = ? AND user_id = ?`,
  ).run(
    next.name,
    next.host,
    next.port,
    next.username,
    next.auth_type,
    next.private_key_path,
    next.password_cipher,
    next.auto_reconnect,
    next.updated_at,
    connectionId,
    userId,
  );
  return rowToConnection(next);
}

export function deleteSshConnection(userId: string, connectionId: string): boolean {
  migrateSshTables();
  const result = db
    .prepare('DELETE FROM ssh_connections WHERE id = ? AND user_id = ?')
    .run(connectionId, userId) as { changes?: number };
  return Number(result?.changes ?? 0) > 0;
}

export function listSshConnections(userId: string): PersistedSshConnection[] {
  migrateSshTables();
  const rows = db
    .prepare('SELECT * FROM ssh_connections WHERE user_id = ? ORDER BY updated_at DESC')
    .all(userId) as SshConnectionRow[];
  return rows.map(rowToConnection);
}

export function getSshConnection(
  userId: string,
  connectionId: string,
): PersistedSshConnection | null {
  migrateSshTables();
  const row = db
    .prepare('SELECT * FROM ssh_connections WHERE id = ? AND user_id = ?')
    .get(connectionId, userId) as SshConnectionRow | undefined;
  return row ? rowToConnection(row) : null;
}

/**
 * Lookup a connection by id without user scoping. Used by the bot reconciler /
 * background workers that don't have a JWT context but operate on data we
 * already vetted via user-scoped routes.
 */
export function getSshConnectionUnscoped(connectionId: string): PersistedSshConnection | null {
  migrateSshTables();
  const row = db
    .prepare('SELECT * FROM ssh_connections WHERE id = ?')
    .get(connectionId) as SshConnectionRow | undefined;
  return row ? rowToConnection(row) : null;
}

export function listAllAutoReconnectConnections(): PersistedSshConnection[] {
  migrateSshTables();
  const rows = db
    .prepare(
      'SELECT * FROM ssh_connections WHERE auto_reconnect = 1 ORDER BY user_id, updated_at DESC',
    )
    .all() as SshConnectionRow[];
  return rows.map(rowToConnection);
}

export function updateSshConnectionStatus(
  connectionId: string,
  status: SshConnectionStatus,
  lastError: string | null = null,
): void {
  migrateSshTables();
  const now = Date.now();
  if (status === 'connected') {
    db.prepare(
      `UPDATE ssh_connections SET status = ?, last_error = NULL, last_connected_at = ?, updated_at = ?
       WHERE id = ?`,
    ).run(status, now, now, connectionId);
  } else {
    db.prepare(
      `UPDATE ssh_connections SET status = ?, last_error = ?, updated_at = ?
       WHERE id = ?`,
    ).run(status, lastError, now, connectionId);
  }
}

/**
 * Normalize every persisted status to `disconnected` on gateway boot. Live
 * SSH clients are process-local so a previous "connected" row is always
 * stale after a restart; the auto-reconnect worker will flip the rows back
 * to "connected" once each handshake succeeds.
 */
export function resetAllSshConnectionStatus(): void {
  migrateSshTables();
  db.prepare(
    `UPDATE ssh_connections SET status = 'disconnected', updated_at = ?
     WHERE status != 'disconnected'`,
  ).run(Date.now());
}

// ─── Bindings ───────────────────────────────────────────────────────────────

export function upsertSshBinding(
  userId: string,
  sessionId: string,
  connectionId: string,
): void {
  migrateSshTables();
  const now = Date.now();
  db.prepare(
    `INSERT INTO ssh_session_bindings (session_id, user_id, connection_id, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(session_id, user_id) DO UPDATE SET
       connection_id = excluded.connection_id,
       updated_at = excluded.updated_at`,
  ).run(sessionId, userId, connectionId, now);
}

export function deleteSshBinding(userId: string, sessionId: string): void {
  migrateSshTables();
  db.prepare('DELETE FROM ssh_session_bindings WHERE session_id = ? AND user_id = ?').run(
    sessionId,
    userId,
  );
}

export function listSshBindings(userId: string): PersistedSshBinding[] {
  migrateSshTables();
  const rows = db
    .prepare(
      'SELECT session_id, user_id, connection_id, updated_at FROM ssh_session_bindings WHERE user_id = ? ORDER BY updated_at DESC',
    )
    .all(userId) as SshBindingRow[];
  return rows.map(rowToBinding);
}

export function listAllSshBindings(): PersistedSshBinding[] {
  migrateSshTables();
  const rows = db
    .prepare(
      'SELECT session_id, user_id, connection_id, updated_at FROM ssh_session_bindings ORDER BY updated_at DESC',
    )
    .all() as SshBindingRow[];
  return rows.map(rowToBinding);
}

// ─── Dialogs ────────────────────────────────────────────────────────────────

export interface UpsertSshDialogInput {
  userId: string;
  connectionId: string;
  title?: string | null;
  cwd?: string;
  lastFilePath?: string | null;
  lastFileEncoding?: 'utf8' | 'base64' | null;
  pinned?: boolean;
  /** 是否把 `last_opened_at` 推到现在；默认 true，让最近活跃的对话浮到列表顶端。 */
  touch?: boolean;
}

/**
 * 触发 / 续写一条 SSH 对话状态。一个连接只对应一个对话条目（user_id,
 * connection_id 联合唯一），重复 upsert 会更新 cwd / 预览路径 /
 * lastOpenedAt 等字段，确保「上次打开的对话」永远精确反映用户最近的操作。
 */
export function upsertSshDialog(input: UpsertSshDialogInput): PersistedSshDialog {
  migrateSshTables();
  const now = Date.now();
  const existing = db
    .prepare(
      'SELECT * FROM ssh_dialogs WHERE user_id = ? AND connection_id = ?',
    )
    .get(input.userId, input.connectionId) as SshDialogRow | undefined;

  if (!existing) {
    const id = randomUUID();
    const next: SshDialogRow = {
      id,
      user_id: input.userId,
      connection_id: input.connectionId,
      title: input.title ?? null,
      cwd: input.cwd && input.cwd.length > 0 ? input.cwd : '/',
      last_file_path: input.lastFilePath ?? null,
      last_file_encoding: input.lastFileEncoding ?? null,
      pinned: input.pinned ? 1 : 0,
      last_opened_at: now,
      created_at: now,
      updated_at: now,
    };
    db.prepare(
      `INSERT INTO ssh_dialogs (
         id, user_id, connection_id, title, cwd,
         last_file_path, last_file_encoding, pinned,
         last_opened_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      next.id,
      next.user_id,
      next.connection_id,
      next.title,
      next.cwd,
      next.last_file_path,
      next.last_file_encoding,
      next.pinned,
      next.last_opened_at,
      next.created_at,
      next.updated_at,
    );
    return rowToDialog(next);
  }

  const next: SshDialogRow = {
    ...existing,
    title: input.title === undefined ? existing.title : input.title,
    cwd: input.cwd === undefined ? existing.cwd : input.cwd && input.cwd.length > 0 ? input.cwd : '/',
    last_file_path:
      input.lastFilePath === undefined ? existing.last_file_path : input.lastFilePath,
    last_file_encoding:
      input.lastFileEncoding === undefined
        ? existing.last_file_encoding
        : input.lastFileEncoding,
    pinned: input.pinned === undefined ? existing.pinned : input.pinned ? 1 : 0,
    last_opened_at: input.touch === false ? existing.last_opened_at : now,
    updated_at: now,
  };
  db.prepare(
    `UPDATE ssh_dialogs SET
       title = ?, cwd = ?, last_file_path = ?, last_file_encoding = ?,
       pinned = ?, last_opened_at = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    next.title,
    next.cwd,
    next.last_file_path,
    next.last_file_encoding,
    next.pinned,
    next.last_opened_at,
    next.updated_at,
    next.id,
  );
  return rowToDialog(next);
}

export function listSshDialogs(userId: string): PersistedSshDialog[] {
  migrateSshTables();
  const rows = db
    .prepare(
      'SELECT * FROM ssh_dialogs WHERE user_id = ? ORDER BY pinned DESC, last_opened_at DESC',
    )
    .all(userId) as SshDialogRow[];
  return rows.map(rowToDialog);
}

export function getMostRecentSshDialog(userId: string): PersistedSshDialog | null {
  migrateSshTables();
  const row = db
    .prepare(
      'SELECT * FROM ssh_dialogs WHERE user_id = ? ORDER BY pinned DESC, last_opened_at DESC LIMIT 1',
    )
    .get(userId) as SshDialogRow | undefined;
  return row ? rowToDialog(row) : null;
}

export function deleteSshDialog(userId: string, dialogId: string): boolean {
  migrateSshTables();
  const result = db
    .prepare('DELETE FROM ssh_dialogs WHERE id = ? AND user_id = ?')
    .run(dialogId, userId) as { changes?: number };
  return Number(result?.changes ?? 0) > 0;
}

export function deleteSshDialogsByConnection(
  userId: string,
  connectionId: string,
): void {
  migrateSshTables();
  db.prepare(
    'DELETE FROM ssh_dialogs WHERE user_id = ? AND connection_id = ?',
  ).run(userId, connectionId);
}

/**
 * Test-only helper: drop every persisted row. Production code must not call
 * this — it doesn't unwind any live ssh2 client either.
 */
export function __resetSshStoreForTests(): void {
  migrateSshTables();
  db.exec('DELETE FROM ssh_dialogs');
  db.exec('DELETE FROM ssh_session_bindings');
  db.exec('DELETE FROM ssh_connections');
}
