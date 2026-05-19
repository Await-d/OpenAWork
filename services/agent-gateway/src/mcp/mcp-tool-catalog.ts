/**
 * Per-user MCP tool catalog cache + change notification bus.
 *
 * Maintains an in-memory snapshot of every connected MCP server's tool
 * list, keyed by `(userId, mcpPoolKey)`. Subscribers (UI, downstream
 * LLM-tools dictionary in PR-C) receive a notification whenever a
 * server pushes `notifications/tools/list_changed` and the cache has
 * been refreshed.
 *
 * Mirrors opencode's `MCP.Service` `state.defs[name]` cache + `bus.publish(ToolsChanged)`
 * (`@/temp/opencode/packages/opencode/src/mcp/index.ts:481-483`):
 * snapshot lives next to the connection, refresh fires on push, and
 * downstream observers see exactly one update per server-side mutation.
 *
 * Why a dedicated module instead of stuffing the cache into
 * `mcpConnectionPool`?
 * - Pool's only job is connection lifecycle; a catalog is an
 *   application-level concept (depends on `disabledTools`,
 *   user-config gating, etc.) that the pool shouldn't know about.
 * - Tests can mock the catalog independently of the pool.
 *
 * The catalog wires itself to `mcpConnectionPool.onToolListChanged`
 * lazily on first use so that import order in tests stays flexible.
 */

import type { MCPToolDef } from '@openAwork/mcp-client';
import {
  mcpConnectionPool,
  type ToolListChangedListener,
} from '../skill/skill-mcp-connection-pool.js';

interface CatalogEntry {
  /** Tools as last fetched from the server (post `disabledTools` filter). */
  tools: MCPToolDef[];
  /** Wall-clock at which `tools` was captured — for staleness debugging. */
  capturedAt: number;
}

export interface ToolCatalogChangeEvent {
  userId: string;
  /** Pool key — `${serverId}:${fingerprint}` for user MCPs, mcp name for skill_mcp. */
  mcpPoolKey: string;
  /** The actual MCP server id (sans fingerprint). */
  serverId: string;
  /** Newly fetched tools after the change. */
  tools: MCPToolDef[];
}

export type ToolCatalogChangeListener = (event: ToolCatalogChangeEvent) => void;

/**
 * OAuth redirect events (PR-D-OAuth). Emitted whenever an MCP
 * adapter's `OAuthClientProvider.redirectToAuthorization` fires —
 * i.e. the SDK has decided the user must visit an authorization URL
 * before the connection can proceed. Subscribers (the
 * `/mcp/events` SSE route) translate these into `mcp.auth.required`
 * SSE events so the frontend can pop the URL.
 */
export interface OAuthRedirectEvent {
  userId: string;
  /** MCP server id (the user-facing identifier from settings). */
  mcpId: string;
  /**
   * The authorization URL the user must visit. Includes all
   * SDK-managed query params: `response_type`, `client_id`,
   * `redirect_uri`, `state`, `code_challenge`, `code_challenge_method`,
   * `scope` if configured.
   */
  authorizationUrl: string;
}

export type OAuthRedirectListener = (event: OAuthRedirectEvent) => void;

const cache = new Map<string, CatalogEntry>();
const listeners = new Set<ToolCatalogChangeListener>();
const oauthRedirectListeners = new Set<OAuthRedirectListener>();
let poolListenerInstalled = false;

function getCacheKey(userId: string, mcpPoolKey: string): string {
  return `${userId}::${mcpPoolKey}`;
}

/**
 * Take an explicit catalog snapshot (caller is responsible for
 * already having fetched the tools — typically right after a fresh
 * `listMcpToolsForSession` round-trip).
 *
 * Used both by the explicit "warm cache after first listTools" path
 * and by the post-push refresh inside {@link installPoolListenerOnce}.
 */
export function setCatalogSnapshot(
  userId: string,
  mcpPoolKey: string,
  serverId: string,
  tools: MCPToolDef[],
): void {
  cache.set(getCacheKey(userId, mcpPoolKey), {
    tools,
    capturedAt: Date.now(),
  });
  publishChange({ userId, mcpPoolKey, serverId, tools });
}

export function getCatalogSnapshot(userId: string, mcpPoolKey: string): MCPToolDef[] | null {
  return cache.get(getCacheKey(userId, mcpPoolKey))?.tools ?? null;
}

export function clearCatalogSnapshot(userId: string, mcpPoolKey: string): void {
  cache.delete(getCacheKey(userId, mcpPoolKey));
}

export function clearAllCatalogSnapshots(): void {
  cache.clear();
}

/**
 * Subscribe to catalog changes. Returns an unregister thunk.
 *
 * Subscribers see every catalog refresh — both fresh-snapshot writes
 * (via {@link setCatalogSnapshot}) and pushed changes from the MCP
 * server (via the pool listener). They are NOT replayed on subscribe;
 * call {@link getCatalogSnapshot} for the current state.
 */
export function subscribeToolCatalogChanges(listener: ToolCatalogChangeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function publishChange(event: ToolCatalogChangeEvent): void {
  // Snapshot listener set so a listener that unsubscribes itself
  // mid-dispatch doesn't shift indices of the remaining iterators.
  const snapshot = Array.from(listeners);
  for (const listener of snapshot) {
    try {
      listener(event);
    } catch (err) {
      console.warn('MCP tool-catalog change listener threw:', err);
    }
  }
}

/**
 * Hook the catalog into the connection pool exactly once. Called
 * lazily by {@link ensurePoolListener} so unit tests that don't import
 * this module pay no cost; once installed the listener is the
 * authoritative re-fetch path on push.
 *
 * The listener uses `withOperationRetry` to ride out the brief
 * disconnect that some servers do alongside the
 * `notifications/tools/list_changed` push.
 */
function installPoolListenerOnce(): void {
  if (poolListenerInstalled) return;
  poolListenerInstalled = true;

  const listener: ToolListChangedListener = async ({ userId, mcpName, serverId }) => {
    try {
      // Peek-only: if the connection was already idle-cleaned before
      // the push arrived, just drop the cache — the next user request
      // rebuilds via the normal `withOperationRetry` path. We avoid
      // reconnecting eagerly here because the push handler runs on
      // the SDK notification thread and the user may have closed the
      // session by now.
      const adapter = mcpConnectionPool.tryGetAdapter(userId, mcpName);
      if (!adapter) {
        clearCatalogSnapshot(userId, mcpName);
        return;
      }
      const tools = await adapter.listTools(serverId);
      setCatalogSnapshot(userId, mcpName, serverId, tools);
    } catch (err) {
      console.warn(`Failed to refresh MCP tool catalog after push for ${userId}/${mcpName}:`, err);
      clearCatalogSnapshot(userId, mcpName);
    }
  };

  mcpConnectionPool.onToolListChanged(listener);
}

/**
 * Ensure the pool listener is wired up. Idempotent.
 *
 * Call this from any code path that publishes catalog snapshots so
 * that the in-memory cache stays consistent with downstream pushes.
 */
export function ensureToolCatalogPoolListener(): void {
  installPoolListenerOnce();
}

/**
 * Subscribe to OAuth-redirect events for any MCP server. The
 * listener fires once per `redirectToAuthorization` call from the
 * SDK; the SSE route fans the event out to the relevant user's
 * browser as `mcp.auth.required`.
 */
export function subscribeOAuthRedirects(listener: OAuthRedirectListener): () => void {
  oauthRedirectListeners.add(listener);
  return () => {
    oauthRedirectListeners.delete(listener);
  };
}

/**
 * Emit an OAuth-redirect event. Called by `mcp-runtime`'s OAuth
 * provider callbacks when the SDK indicates a user must complete
 * authorization. Uses the same fire-and-forget pub/sub pattern as
 * {@link publishChange} so a misbehaving subscriber can't break
 * the connect path.
 */
export function publishOAuthRedirect(event: OAuthRedirectEvent): void {
  const snapshot = Array.from(oauthRedirectListeners);
  for (const listener of snapshot) {
    try {
      listener(event);
    } catch (err) {
      console.warn('MCP oauth-redirect listener threw:', err);
    }
  }
}
