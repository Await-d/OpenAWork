/**
 * Skill MCP Connection Pool
 *
 * Ported from oh-my-opencode's SkillMcpManager. Provides:
 * - Lazy loading: connections created on first use
 * - Connection pooling: reuse existing connections across calls
 * - Idle cleanup: disconnect after 5 minutes of inactivity
 * - Process cleanup: close all connections on SIGINT/SIGTERM
 * - Race condition prevention: pending connection deduplication
 * - Operation retry: auto-reconnect on "not connected" errors
 * - Environment cleaning: filter npm/pnpm/yarn env vars for stdio
 */

import { MCPClientAdapterImpl } from '@openAwork/mcp-client';
import type { MCPServerRef, SkillManifest } from '@openAwork/skill-types';
import { sqliteAll } from '../db.js';

// ---------------------------------------------------------------------------
// Environment cleaner (ported from oh-my-opencode env-cleaner.ts)
// ---------------------------------------------------------------------------

const EXCLUDED_ENV_PATTERNS: RegExp[] = [
  /^NPM_CONFIG_/i,
  /^npm_config_/,
  /^YARN_/,
  /^PNPM_/,
  /^NO_UPDATE_NOTIFIER$/,
];

function createCleanMcpEnvironment(customEnv: Record<string, string> = {}): Record<string, string> {
  const proc = globalThis as unknown as { process?: { env?: Record<string, string | undefined> } };
  const rawEnv = proc?.process?.env ?? {};
  const cleanEnv: Record<string, string> = {};

  for (const [key, value] of Object.entries(rawEnv)) {
    if (value === undefined) continue;
    const shouldExclude = EXCLUDED_ENV_PATTERNS.some((pattern) => pattern.test(key));
    if (!shouldExclude) {
      cleanEnv[key] = value;
    }
  }

  Object.assign(cleanEnv, customEnv);
  return cleanEnv;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ManagedConnection {
  adapter: MCPClientAdapterImpl;
  serverRef: MCPServerRef;
  skillName: string;
  lastUsedAt: number;
}

/**
 * Listener invoked when the MCP server pushes a
 * `notifications/tools/list_changed` event for the (userId, mcpName)
 * connection. Registered via {@link SkillMcpConnectionPool.onToolListChanged}.
 *
 * The listener fires on the SDK's notification thread — keep it
 * fast and offload heavy work (e.g. re-fetching tool catalogs) to a
 * Promise.
 */
export type ToolListChangedListener = (input: {
  userId: string;
  mcpName: string;
  serverId: string;
}) => void | Promise<void>;

interface InstalledSkillRow {
  skill_id: string;
  manifest_json: string;
}

// ---------------------------------------------------------------------------
// Connection Pool
// ---------------------------------------------------------------------------

const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute
const MAX_OPERATION_RETRIES = 3;

class SkillMcpConnectionPool {
  private connections = new Map<string, ManagedConnection>();
  private pendingConnections = new Map<string, Promise<MCPClientAdapterImpl>>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private cleanupRegistered = false;
  private toolListChangedListeners = new Set<ToolListChangedListener>();

  private getConnectionKey(userId: string, mcpName: string): string {
    return `${userId}:${mcpName}`;
  }

  /**
   * Register a listener that fires whenever an MCP server connected
   * through this pool pushes a `notifications/tools/list_changed`
   * event. Listeners receive the originating `(userId, mcpName,
   * serverId)` tuple so they can scope their reaction (e.g. invalidate
   * a per-user catalog cache).
   *
   * Returns an unregister thunk for parity with `EventEmitter.on / off`.
   */
  onToolListChanged(listener: ToolListChangedListener): () => void {
    this.toolListChangedListeners.add(listener);
    return () => {
      this.toolListChangedListeners.delete(listener);
    };
  }

  private async dispatchToolListChanged(input: {
    userId: string;
    mcpName: string;
    serverId: string;
  }): Promise<void> {
    // Snapshot to insulate against listeners that mutate the set
    // during dispatch (rare, but cheap to defend against).
    const listeners = Array.from(this.toolListChangedListeners);
    await Promise.all(
      listeners.map(async (listener) => {
        try {
          await listener(input);
        } catch (err) {
          console.warn(
            `MCP tool-list-changed listener threw for ${input.userId}/${input.mcpName}:`,
            err,
          );
        }
      }),
    );
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  private registerProcessCleanup(): void {
    if (this.cleanupRegistered) return;
    this.cleanupRegistered = true;

    const cleanup = async () => {
      const entries = Array.from(this.connections.entries());
      this.connections.clear();
      for (const [, managed] of entries) {
        try {
          await managed.adapter.disconnect(managed.serverRef.id);
        } catch {
          // Ignore errors during cleanup
        }
      }
      this.pendingConnections.clear();
    };

    const proc = globalThis as unknown as {
      process?: { on?: (event: string, cb: () => void) => void; exit?: (code: number) => never };
    };
    const cleanupAndExit = (): void => {
      void cleanup()
        .catch((error: unknown) => {
          console.warn('Failed to clean up Skill MCP connections before exit', error);
        })
        .finally(() => {
          proc.process?.exit?.(0);
        });
    };
    proc.process?.on?.('SIGINT', cleanupAndExit);
    proc.process?.on?.('SIGTERM', cleanupAndExit);
  }

  private startCleanupTimer(): void {
    if (this.cleanupInterval) return;
    this.cleanupInterval = setInterval(() => {
      void this.cleanupIdleConnections().catch((error: unknown) => {
        console.warn('Failed to clean up idle Skill MCP connections', error);
      });
    }, CLEANUP_INTERVAL_MS);

    // Don't keep the process alive just for this timer
    if (
      typeof this.cleanupInterval === 'object' &&
      this.cleanupInterval &&
      'unref' in this.cleanupInterval
    ) {
      (this.cleanupInterval as ReturnType<typeof setInterval> & { unref(): void }).unref();
    }
  }

  private stopCleanupTimer(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  private async cleanupIdleConnections(): Promise<void> {
    const now = Date.now();
    const idleKeys: string[] = [];

    for (const [key, managed] of this.connections) {
      if (now - managed.lastUsedAt > IDLE_TIMEOUT_MS) {
        idleKeys.push(key);
      }
    }

    for (const key of idleKeys) {
      const managed = this.connections.get(key);
      if (!managed) continue;
      this.connections.delete(key);
      try {
        await managed.adapter.disconnect(managed.serverRef.id);
      } catch {
        // Connection may already be closed
      }
    }

    // Stop timer if no connections remain
    if (this.connections.size === 0) {
      this.stopCleanupTimer();
    }
  }

  // -----------------------------------------------------------------------
  // Connection management
  // -----------------------------------------------------------------------

  async getOrCreateConnection(
    userId: string,
    mcpName: string,
    serverRef: MCPServerRef,
  ): Promise<MCPClientAdapterImpl> {
    const key = this.getConnectionKey(userId, mcpName);

    // Reuse existing connection
    const existing = this.connections.get(key);
    if (existing) {
      existing.lastUsedAt = Date.now();
      return existing.adapter;
    }

    // Deduplicate concurrent connection attempts
    const pending = this.pendingConnections.get(key);
    if (pending) {
      return pending;
    }

    const connectionPromise = this.createConnection(userId, mcpName, serverRef);
    this.pendingConnections.set(key, connectionPromise);

    try {
      return await connectionPromise;
    } finally {
      this.pendingConnections.delete(key);
    }
  }

  private async createConnection(
    userId: string,
    mcpName: string,
    serverRef: MCPServerRef,
  ): Promise<MCPClientAdapterImpl> {
    this.registerProcessCleanup();
    const key = this.getConnectionKey(userId, mcpName);

    const adapter = new MCPClientAdapterImpl();

    // For stdio transport, clean the environment to avoid npm/pnpm conflicts
    if (serverRef.transport === 'stdio' && serverRef.command) {
      const cleanEnv = createCleanMcpEnvironment();
      const serverWithCleanEnv: MCPServerRef & { env?: Record<string, string> } = {
        ...serverRef,
        env: cleanEnv,
      };
      await adapter.connect(serverWithCleanEnv as MCPServerRef);
    } else {
      await adapter.connect(serverRef);
    }

    // Register the SDK notification handler now, while the
    // (userId, mcpName) tuple is still in scope. Mirrors opencode's
    // `mcp/index.ts:472-484` `watch()` — without this, MCP servers
    // that mutate their tool list at runtime (long-lived dev servers,
    // skill-installed servers that lazy-mount tools) would never
    // notify our caches and the LLM tool dictionary would drift.
    //
    // We deliberately don't await listener dispatch — fire-and-forget
    // matches opencode's semantics and keeps the SDK notification
    // thread snappy. The listener itself catches its own errors.
    try {
      await adapter.subscribeToolListChanged(serverRef.id, () => {
        void this.dispatchToolListChanged({
          userId,
          mcpName,
          serverId: serverRef.id,
        });
      });
    } catch (err) {
      // Some MCP servers don't advertise the `tools.listChanged`
      // capability — calling setNotificationHandler is still safe
      // (it just never fires), but if the SDK rejects the schema
      // for any reason we log and move on rather than failing the
      // connect. The pool stays usable for everything else.
      console.warn(`Failed to subscribe to tool-list-changed for ${serverRef.id}:`, err);
    }

    this.connections.set(key, {
      adapter,
      serverRef,
      skillName: mcpName,
      lastUsedAt: Date.now(),
    });

    this.startCleanupTimer();
    return adapter;
  }

  async disconnectUserConnection(userId: string, mcpName: string): Promise<void> {
    const key = this.getConnectionKey(userId, mcpName);
    const managed = this.connections.get(key);
    if (!managed) return;

    this.connections.delete(key);
    try {
      await managed.adapter.disconnect(managed.serverRef.id);
    } catch {
      // Connection may already be closed
    }

    if (this.connections.size === 0) {
      this.stopCleanupTimer();
    }
  }

  async disconnectAllForUser(userId: string): Promise<void> {
    const prefix = `${userId}:`;
    const keysToRemove: string[] = [];

    for (const [key, managed] of this.connections) {
      if (key.startsWith(prefix)) {
        keysToRemove.push(key);
        this.connections.delete(key);
        try {
          await managed.adapter.disconnect(managed.serverRef.id);
        } catch {
          // Ignore
        }
      }
    }

    if (this.connections.size === 0) {
      this.stopCleanupTimer();
    }
  }

  async disconnectAll(): Promise<void> {
    this.stopCleanupTimer();
    const entries = Array.from(this.connections.values());
    this.connections.clear();
    for (const managed of entries) {
      try {
        await managed.adapter.disconnect(managed.serverRef.id);
      } catch {
        // Ignore
      }
    }
  }

  // -----------------------------------------------------------------------
  // Operation retry with auto-reconnect
  // -----------------------------------------------------------------------

  async withOperationRetry<T>(
    userId: string,
    mcpName: string,
    serverRef: MCPServerRef,
    operation: (adapter: MCPClientAdapterImpl, serverId: string) => Promise<T>,
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_OPERATION_RETRIES; attempt++) {
      try {
        const adapter = await this.getOrCreateConnection(userId, mcpName, serverRef);
        return await operation(adapter, serverRef.id);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const errorMessage = lastError.message.toLowerCase();

        // Only retry on connection-related errors
        if (
          !errorMessage.includes('not connected') &&
          !errorMessage.includes('connection') &&
          !errorMessage.includes('disconnected')
        ) {
          throw lastError;
        }

        if (attempt === MAX_OPERATION_RETRIES) {
          throw new Error(
            `Failed after ${MAX_OPERATION_RETRIES} reconnection attempts: ${lastError.message}`,
          );
        }

        // Remove stale connection and retry
        const key = this.getConnectionKey(userId, mcpName);
        const managed = this.connections.get(key);
        if (managed) {
          this.connections.delete(key);
          try {
            await managed.adapter.disconnect(managed.serverRef.id);
          } catch {
            // Ignore
          }
        }
      }
    }

    throw lastError ?? new Error('Operation failed with unknown error');
  }

  // -----------------------------------------------------------------------
  // Status
  // -----------------------------------------------------------------------

  getConnectedServers(userId?: string): string[] {
    const keys = Array.from(this.connections.keys());
    if (!userId) return keys;
    return keys.filter((key) => key.startsWith(`${userId}:`));
  }

  isConnected(userId: string, mcpName: string): boolean {
    return this.connections.has(this.getConnectionKey(userId, mcpName));
  }

  /**
   * Peek-only adapter accessor.
   *
   * Unlike {@link getOrCreateConnection}, this never builds a new
   * connection — it returns the existing adapter if one is in the
   * pool, otherwise `null`. Used by the catalog cache's post-push
   * refresh path: if the connection has already been idle-cleaned,
   * dropping the cache is the correct outcome (next user request
   * rebuilds via the normal `withOperationRetry` path).
   */
  tryGetAdapter(userId: string, mcpName: string): MCPClientAdapterImpl | null {
    const managed = this.connections.get(this.getConnectionKey(userId, mcpName));
    return managed?.adapter ?? null;
  }

  get connectionCount(): number {
    return this.connections.size;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const skillMcpPool = new SkillMcpConnectionPool();

/**
 * Connection-pool entry point for **all** MCP traffic — both
 * `skill_mcp` (servers embedded in installed skills) and user-configured
 * MCP servers (`user_settings.mcp_servers`). The class is named
 * `SkillMcpConnectionPool` for historical reasons (it was originally
 * ported for `skill_mcp`), but the implementation is content-agnostic:
 * the connection key is `${userId}:${mcpName|serverId}`, so any caller
 * can stash a connection by passing a unique name.
 *
 * Mirrors opencode's `MCP.Service` (`@/temp/opencode/packages/opencode/src/mcp/index.ts:472-549`)
 * persistent-client philosophy: build once, reuse across calls,
 * auto-reconnect on transient errors, idle-cleanup at 5 min.
 *
 * Use this alias from new call sites (e.g. `mcp-runtime.ts`) so the
 * intent is obvious; legacy `skillMcpPool` continues to work.
 */
export const mcpConnectionPool = skillMcpPool;

// ---------------------------------------------------------------------------
// Skill lookup helper
// ---------------------------------------------------------------------------

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

export function findSkillMcpServer(
  userId: string,
  mcpName: string,
): { manifest: SkillManifest; mcp: MCPServerRef } | null {
  const rows = sqliteAll<InstalledSkillRow>(
    `SELECT skill_id, manifest_json FROM installed_skills WHERE user_id = ? AND enabled = 1 ORDER BY updated_at DESC`,
    [userId],
  );
  const normalized = normalizeName(mcpName);
  for (const row of rows) {
    const manifest = JSON.parse(row.manifest_json) as SkillManifest;
    if (!manifest.mcp) {
      continue;
    }
    const candidates = [manifest.mcp.id, manifest.id, manifest.name, manifest.displayName]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map(normalizeName);
    if (candidates.includes(normalized)) {
      return { manifest, mcp: manifest.mcp };
    }
  }
  return null;
}
