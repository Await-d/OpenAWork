/**
 * Per-user façade over the in-memory `SSHConnectionManager` + the persistent
 * SQLite store. The route layer talks exclusively to this service so it can:
 *
 * 1. Scope every operation to the JWT-authenticated user (no cross-user reads).
 * 2. Persist connections, bindings, and "last opened SSH dialog" state, so a
 *    gateway restart no longer wipes the panel back to a blank window.
 * 3. Auto-reconnect the user's `auto_reconnect = 1` connections on boot, so
 *    the most-recently-active SSH dialog is already live by the time the web
 *    UI hydrates.
 *
 * The in-memory `SSHConnectionManagerImpl` keeps owning the actual ssh2
 * client lifecycle — we don't try to persist live channels, only the metadata
 * needed to recreate them after a restart.
 */

import {
  SSHConnectionManagerImpl,
  SSHSessionBindingRegistry,
  type SSHConnection as RuntimeSshConnection,
  type SSHFileEntry,
  type SSHFilePreview,
  type SSHConnectionManager,
} from '@openAwork/agent-core';
import {
  createSshConnection,
  deleteSshBinding,
  deleteSshConnection,
  deleteSshDialogsByConnection,
  deleteSshDialog,
  getMostRecentSshDialog,
  getSshConnection,
  getSshConnectionUnscoped,
  listAllAutoReconnectConnections,
  listAllSshBindings,
  listSshBindings,
  listSshConnections,
  listSshDialogs,
  migrateSshTables,
  resetAllSshConnectionStatus,
  updateSshConnection,
  updateSshConnectionStatus,
  upsertSshBinding,
  upsertSshDialog,
  type CreateSshConnectionInput,
  type PersistedSshConnection,
  type PersistedSshDialog,
  type UpdateSshConnectionInput,
  type UpsertSshDialogInput,
} from './ssh-store.js';

export interface SshConnectionView {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: PersistedSshConnection['authType'];
  privateKeyPath: string | null;
  /** True iff a credential is on file. We never expose the secret itself. */
  hasPassword: boolean;
  autoReconnect: boolean;
  status: PersistedSshConnection['status'];
  lastError: string | null;
  lastConnectedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface SshDialogView {
  id: string;
  connectionId: string;
  title: string | null;
  cwd: string;
  lastFilePath: string | null;
  lastFileEncoding: 'utf8' | 'base64' | null;
  pinned: boolean;
  lastOpenedAt: number;
}

export interface SshBindingView {
  sessionId: string;
  connectionId: string;
  updatedAt: number;
}

export type SshServiceLogger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

const NOOP_LOGGER: SshServiceLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function projectConnection(row: PersistedSshConnection): SshConnectionView {
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    username: row.username,
    authType: row.authType,
    privateKeyPath: row.privateKeyPath,
    hasPassword: Boolean(row.password) || row.authType === 'agent',
    autoReconnect: row.autoReconnect,
    status: row.status,
    lastError: row.lastError,
    lastConnectedAt: row.lastConnectedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function projectDialog(row: PersistedSshDialog): SshDialogView {
  return {
    id: row.id,
    connectionId: row.connectionId,
    title: row.title,
    cwd: row.cwd,
    lastFilePath: row.lastFilePath,
    lastFileEncoding: row.lastFileEncoding,
    pinned: row.pinned,
    lastOpenedAt: row.lastOpenedAt,
  };
}

function toRuntimeConnection(row: PersistedSshConnection): RuntimeSshConnection {
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    username: row.username,
    authType: row.authType,
    privateKeyPath: row.privateKeyPath ?? undefined,
    password: row.password ?? undefined,
    status: 'disconnected',
    createdAt: row.createdAt,
  };
}

export interface SshServiceOptions {
  manager?: SSHConnectionManager;
  bindings?: SSHSessionBindingRegistry;
  logger?: SshServiceLogger;
}

/**
 * Single per-process service that owns the persistent + in-memory SSH state.
 * The gateway boots one instance and registers it via {@link setSshService}
 * so route handlers, channel-bound tools, and the auto-reconnect worker all
 * share the same view.
 */
export class SshService {
  private readonly manager: SSHConnectionManager;
  private readonly bindings: SSHSessionBindingRegistry;
  private readonly logger: SshServiceLogger;
  /**
   * Connection ids whose ssh2 client has been ensured into the manager this
   * process. We need this because `SSHConnectionManagerImpl.addConnection`
   * is idempotent (overwrites in place) but `connect` / `execCommand` / etc.
   * fail with `SSH connection not found:` if the metadata wasn't pushed in
   * since the last process restart.
   */
  private readonly hydratedConnections = new Set<string>();

  constructor(options: SshServiceOptions = {}) {
    this.manager = options.manager ?? new SSHConnectionManagerImpl();
    this.bindings = options.bindings ?? new SSHSessionBindingRegistry();
    this.logger = options.logger ?? NOOP_LOGGER;
    migrateSshTables();
  }

  getManager(): SSHConnectionManager {
    return this.manager;
  }

  getBindings(): SSHSessionBindingRegistry {
    return this.bindings;
  }

  // ─── Connections ─────────────────────────────────────────────────────────

  listConnections(userId: string): SshConnectionView[] {
    return listSshConnections(userId).map(projectConnection);
  }

  getConnection(userId: string, connectionId: string): SshConnectionView | null {
    const row = getSshConnection(userId, connectionId);
    return row ? projectConnection(row) : null;
  }

  createConnection(
    userId: string,
    input: Omit<CreateSshConnectionInput, 'userId'>,
  ): SshConnectionView {
    const row = createSshConnection({ ...input, userId });
    this.hydrateRuntimeConnection(row);
    return projectConnection(row);
  }

  updateConnection(
    userId: string,
    connectionId: string,
    patch: UpdateSshConnectionInput,
  ): SshConnectionView | null {
    const row = updateSshConnection(userId, connectionId, patch);
    if (!row) return null;
    // Force re-hydration so subsequent connect() picks up the new password /
    // host / etc. instead of the previous in-memory snapshot.
    this.hydratedConnections.delete(connectionId);
    this.hydrateRuntimeConnection(row);
    return projectConnection(row);
  }

  async deleteConnection(userId: string, connectionId: string): Promise<boolean> {
    const existing = getSshConnection(userId, connectionId);
    if (!existing) return false;
    try {
      await this.manager.disconnect(connectionId);
    } catch (err) {
      this.logger.warn('ssh service: disconnect during delete failed', {
        connectionId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
    this.bindings.unbindByConnection(connectionId);
    deleteSshDialogsByConnection(userId, connectionId);
    const removed = deleteSshConnection(userId, connectionId);
    this.hydratedConnections.delete(connectionId);
    return removed;
  }

  // ─── Connect / disconnect lifecycle ──────────────────────────────────────

  async connect(userId: string, connectionId: string): Promise<SshConnectionView> {
    const row = this.requireOwnedConnection(userId, connectionId);
    this.hydrateRuntimeConnection(row);
    updateSshConnectionStatus(connectionId, 'connecting');
    try {
      await this.manager.connect(connectionId);
      updateSshConnectionStatus(connectionId, 'connected');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      updateSshConnectionStatus(connectionId, 'error', message);
      throw err;
    }
    const refreshed = getSshConnection(userId, connectionId);
    return projectConnection(refreshed ?? row);
  }

  async disconnect(userId: string, connectionId: string): Promise<SshConnectionView> {
    const row = this.requireOwnedConnection(userId, connectionId);
    try {
      await this.manager.disconnect(connectionId);
    } finally {
      updateSshConnectionStatus(connectionId, 'disconnected');
    }
    const refreshed = getSshConnection(userId, connectionId);
    return projectConnection(refreshed ?? row);
  }

  // ─── File access ─────────────────────────────────────────────────────────

  async listFiles(
    userId: string,
    connectionId: string,
    path: string,
  ): Promise<SSHFileEntry[]> {
    this.requireOwnedConnection(userId, connectionId);
    const entries = await this.manager.listFiles(connectionId, path);
    upsertSshDialog({
      userId,
      connectionId,
      cwd: path,
      touch: true,
    });
    return entries;
  }

  async readFile(
    userId: string,
    connectionId: string,
    path: string,
  ): Promise<SSHFilePreview> {
    this.requireOwnedConnection(userId, connectionId);
    const preview = await this.manager.readFile(connectionId, path);
    upsertSshDialog({
      userId,
      connectionId,
      lastFilePath: preview.path,
      lastFileEncoding: preview.encoding,
      touch: true,
    });
    return preview;
  }

  async writeFile(
    userId: string,
    connectionId: string,
    path: string,
    content: string | Uint8Array,
  ): Promise<void> {
    this.requireOwnedConnection(userId, connectionId);
    await this.manager.writeFile(connectionId, path, content);
    upsertSshDialog({
      userId,
      connectionId,
      lastFilePath: path,
      touch: true,
    });
  }

  // ─── Bindings ────────────────────────────────────────────────────────────

  bindSession(userId: string, sessionId: string, connectionId: string): SshBindingView {
    this.requireOwnedConnection(userId, connectionId);
    upsertSshBinding(userId, sessionId, connectionId);
    this.bindings.bind(sessionId, connectionId);
    upsertSshDialog({ userId, connectionId, touch: true });
    return {
      sessionId,
      connectionId,
      updatedAt: Date.now(),
    };
  }

  unbindSession(userId: string, sessionId: string): void {
    deleteSshBinding(userId, sessionId);
    this.bindings.unbind(sessionId);
  }

  listBindings(userId: string): SshBindingView[] {
    return listSshBindings(userId).map((row) => ({
      sessionId: row.sessionId,
      connectionId: row.connectionId,
      updatedAt: row.updatedAt,
    }));
  }

  // ─── Dialogs ─────────────────────────────────────────────────────────────

  listDialogs(userId: string): SshDialogView[] {
    return listSshDialogs(userId).map(projectDialog);
  }

  /**
   * Dialog primary used by the panel — touches `last_opened_at` so the most
   * recently focused dialog is what the panel restores after a restart.
   */
  upsertDialog(input: UpsertSshDialogInput): SshDialogView {
    this.requireOwnedConnection(input.userId, input.connectionId);
    return projectDialog(upsertSshDialog(input));
  }

  deleteDialog(userId: string, dialogId: string): boolean {
    return deleteSshDialog(userId, dialogId);
  }

  /** Last dialog the user touched. Used by the web app to restore the panel. */
  getLastOpenedDialog(userId: string): SshDialogView | null {
    const row = getMostRecentSshDialog(userId);
    return row ? projectDialog(row) : null;
  }

  // ─── Boot reconcile ──────────────────────────────────────────────────────

  /**
   * Called once during gateway startup. Resets every persisted status to
   * `disconnected` (live channels are gone), pre-loads metadata into the
   * in-memory manager so subsequent connect() calls don't 404, projects all
   * persisted bindings into the in-memory registry, and kicks off
   * auto-reconnect for every `auto_reconnect = 1` connection.
   *
   * Background errors are swallowed and logged — boot must not depend on a
   * remote SSH server being reachable.
   */
  async reconcileOnBoot(): Promise<void> {
    migrateSshTables();
    resetAllSshConnectionStatus();

    const allBindings = listAllSshBindings();
    for (const binding of allBindings) {
      this.bindings.bind(binding.sessionId, binding.connectionId);
    }

    const candidates = listAllAutoReconnectConnections();
    for (const row of candidates) {
      this.hydrateRuntimeConnection(row);
    }
    if (candidates.length === 0) return;

    // Fire-and-forget each handshake. If a remote host is offline / creds
    // are stale we want the rest of the gateway to keep booting; the row's
    // `last_error` field captures the failure for the UI to surface later.
    void Promise.allSettled(
      candidates.map(async (row) => {
        updateSshConnectionStatus(row.id, 'connecting');
        try {
          await this.manager.connect(row.id);
          updateSshConnectionStatus(row.id, 'connected');
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          updateSshConnectionStatus(row.id, 'error', message);
          this.logger.warn('ssh auto-reconnect failed', {
            connectionId: row.id,
            err: message,
          });
        }
      }),
    );
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  private hydrateRuntimeConnection(row: PersistedSshConnection): void {
    this.manager.addConnection(toRuntimeConnection(row));
    this.hydratedConnections.add(row.id);
  }

  private requireOwnedConnection(userId: string, connectionId: string): PersistedSshConnection {
    const row = getSshConnection(userId, connectionId);
    if (!row) {
      const err = new Error(`SSH connection not found: ${connectionId}`);
      throw err;
    }
    if (!this.hydratedConnections.has(connectionId)) {
      this.hydrateRuntimeConnection(row);
    }
    return row;
  }
}

let activeService: SshService | null = null;

export function setSshService(service: SshService): void {
  activeService = service;
}

export function getSshService(): SshService {
  if (!activeService) {
    activeService = new SshService();
  }
  return activeService;
}

/**
 * Used by the v2 runtime tools that resolve an ssh proxy by connection id
 * without going through a JWT-authenticated route. The lookup is unscoped
 * intentionally — by the time a tool fires, the binding row has already
 * been written by the user through the user-scoped `bindSession` route.
 */
export function lookupConnectionById(connectionId: string): PersistedSshConnection | null {
  return getSshConnectionUnscoped(connectionId);
}

/** Test helper. Reset module-level singletons. */
export function __resetSshServiceForTests(service: SshService | null = null): void {
  activeService = service;
}
