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
import { sqliteAll } from './db.js';

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

function createCleanMcpEnvironment(
  customEnv: Record<string, string> = {},
): Record<string, string> {
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

  private getConnectionKey(userId: string, mcpName: string): string {
    return `${userId}:${mcpName}`;
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

    const proc = globalThis as unknown as { process?: { on?: (event: string, cb: () => void) => void; exit?: (code: number) => never } };
    proc.process?.on?.('SIGINT', async () => {
      await cleanup();
      proc.process?.exit?.(0);
    });
    proc.process?.on?.('SIGTERM', async () => {
      await cleanup();
      proc.process?.exit?.(0);
    });
  }

  private startCleanupTimer(): void {
    if (this.cleanupInterval) return;
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleConnections();
    }, CLEANUP_INTERVAL_MS);

    // Don't keep the process alive just for this timer
    if (typeof this.cleanupInterval === 'object' && this.cleanupInterval && 'unref' in this.cleanupInterval) {
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

    const connectionPromise = this.createConnection(key, serverRef);
    this.pendingConnections.set(key, connectionPromise);

    try {
      return await connectionPromise;
    } finally {
      this.pendingConnections.delete(key);
    }
  }

  private async createConnection(
    key: string,
    serverRef: MCPServerRef,
  ): Promise<MCPClientAdapterImpl> {
    this.registerProcessCleanup();

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

    this.connections.set(key, {
      adapter,
      serverRef,
      skillName: key.split(':')[1] ?? '',
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

  get connectionCount(): number {
    return this.connections.size;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const skillMcpPool = new SkillMcpConnectionPool();

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
