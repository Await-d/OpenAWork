/**
 * Persistent OAuth credentials store for MCP servers.
 *
 * Mirrors opencode's `McpAuth` service (same field set: tokens,
 * client info, code verifier, oauth state) but persists everything
 * in a single SQLite-backed `user_settings` row keyed by user. We
 * deliberately keep the store **per-user** rather than global —
 * MCP credentials are user-scoped (different users authenticate as
 * themselves to the same upstream server) and conflating them across
 * users is a security incident waiting to happen.
 *
 * Storage layout (JSON in `user_settings.value` for key
 * `mcp_oauth_credentials`):
 *
 *   {
 *     "<mcpId>": {
 *       "serverUrl": "https://example.com/mcp",
 *       "tokens": { accessToken, refreshToken, expiresAt, scope },
 *       "clientInfo": { clientId, clientSecret, clientIdIssuedAt, clientSecretExpiresAt },
 *       "codeVerifier": "...",
 *       "oauthState": "..."
 *     },
 *     ...
 *   }
 *
 * The serverUrl is stored alongside the credentials so a moving
 * server URL invalidates stale tokens (matching opencode's
 * `getForUrl` semantics — see `mcp/auth.ts`).
 */

import { sqliteAll, sqliteGet, sqliteRun } from '../infra/db.js';

const STORE_KEY = 'mcp_oauth_credentials';

export interface McpOAuthTokens {
  accessToken: string;
  refreshToken?: string;
  /** Unix epoch seconds; absent means "no known expiry". */
  expiresAt?: number;
  scope?: string;
}

export interface McpOAuthClientInfo {
  clientId: string;
  clientSecret?: string;
  clientIdIssuedAt?: number;
  clientSecretExpiresAt?: number;
}

export interface McpOAuthEntry {
  /**
   * The server URL this credential set is bound to. We compare this
   * on read in {@link getForUrl} so a config edit that changes the
   * server URL silently invalidates stale tokens.
   */
  serverUrl?: string;
  tokens?: McpOAuthTokens;
  clientInfo?: McpOAuthClientInfo;
  codeVerifier?: string;
  oauthState?: string;
}

interface UserSettingRow {
  value: string;
}

function readAll(userId: string): Record<string, McpOAuthEntry> {
  const row = sqliteGet<UserSettingRow>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = ?`,
    [userId, STORE_KEY],
  );
  if (!row?.value) return {};
  try {
    const parsed = JSON.parse(row.value) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, McpOAuthEntry>;
    }
    return {};
  } catch {
    // Don't crash a stream turn just because the credentials JSON
    // got corrupted — treat the store as empty (safer than blowing
    // up; the user can re-authenticate to repair).
    return {};
  }
}

function writeAll(userId: string, all: Record<string, McpOAuthEntry>): void {
  sqliteRun(
    `INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`,
    [userId, STORE_KEY, JSON.stringify(all)],
  );
}

/**
 * Read the credential entry for a given (userId, mcpId).
 * Returns `undefined` when no entry exists.
 */
export function getOAuthEntry(userId: string, mcpId: string): McpOAuthEntry | undefined {
  return readAll(userId)[mcpId];
}

/**
 * Read the credential entry only when its `serverUrl` matches the
 * requested URL. This implements opencode's "URL changed →
 * invalidate" guard — if a user repointed the same `mcpId` to a
 * different upstream server, we MUST NOT replay tokens issued by
 * the old one against the new one (that would leak the old server's
 * access token to the new one's logs at minimum).
 */
export function getOAuthEntryForUrl(
  userId: string,
  mcpId: string,
  serverUrl: string,
): McpOAuthEntry | undefined {
  const entry = readAll(userId)[mcpId];
  if (!entry) return undefined;
  if (entry.serverUrl && entry.serverUrl !== serverUrl) return undefined;
  return entry;
}

/**
 * **Overwrite** the entry for `(userId, mcpId)` — the passed
 * object becomes the entire stored value. If you only want to
 * modify some fields, use {@link updateOAuthEntry} instead, which
 * merges. (We keep both: `setOAuthEntry` is the right primitive
 * when the caller already holds a fully-formed entry, e.g. when
 * minting a fresh `oauthState` against a previously-empty entry.)
 */
export function setOAuthEntry(userId: string, mcpId: string, entry: McpOAuthEntry): void {
  const all = readAll(userId);
  all[mcpId] = entry;
  writeAll(userId, all);
}

/**
 * Merge `patch` into the existing entry for `(userId, mcpId)`,
 * preserving any fields not mentioned in `patch`. When `serverUrl`
 * is passed, it is set as the entry's `serverUrl` regardless of
 * whether the patch object includes one — this is the right
 * default for `provider.save*()` callbacks since they always know
 * which server URL their tokens belong to.
 */
export function updateOAuthEntry(
  userId: string,
  mcpId: string,
  patch: Partial<McpOAuthEntry>,
  serverUrl?: string,
): McpOAuthEntry {
  const all = readAll(userId);
  const next: McpOAuthEntry = {
    ...(all[mcpId] ?? {}),
    ...patch,
    ...(serverUrl ? { serverUrl } : {}),
  };
  all[mcpId] = next;
  writeAll(userId, all);
  return next;
}

/**
 * Drop the **transient** state of an in-flight OAuth flow
 * (`oauthState`, `codeVerifier`) while preserving the long-lived
 * tokens / client info. Call this from the OAuth callback route
 * once `auth()` has either succeeded or definitively failed:
 *
 *   - On success, the saved tokens are now the source of truth and
 *     the verifier is single-use — keeping them around just gives
 *     a hypothetical replay attacker a longer window. Clearing the
 *     state ALSO defends against the same callback URL being
 *     re-opened (e.g. browser back-button) and being silently
 *     re-processed.
 *   - On a definitive `REDIRECT` reply, the SDK has concluded
 *     this flow's tokens can't be salvaged; the user has to start
 *     a fresh `redirectToAuthorization`, which mints a new
 *     state + verifier anyway.
 *
 * If the entry is missing this is a no-op.
 */
export function clearPendingOAuthFlow(userId: string, mcpId: string): void {
  const all = readAll(userId);
  const entry = all[mcpId];
  if (!entry) return;
  delete entry.oauthState;
  delete entry.codeVerifier;
  writeAll(userId, all);
}

/**
 * Selective credential invalidation. `type` mirrors the SDK's
 * `OAuthClientProvider.invalidateCredentials` API
 * (`@modelcontextprotocol/sdk/client/auth.d.ts:105`):
 *
 *   - `'all'`: drop the whole entry (force full re-auth from scratch).
 *   - `'client'`: drop dynamic-registration client info but keep
 *     tokens (rare — used when the issuer rotates the client_id).
 *   - `'tokens'`: drop access/refresh tokens but keep client info
 *     (the common case — refresh failed, need user re-consent but
 *     we can reuse the registered client).
 *   - `'verifier'`: drop the in-flight PKCE code verifier without
 *     touching long-lived tokens. The SDK calls this when a token
 *     refresh attempt concludes the verifier is no longer usable
 *     (e.g. it was already redeemed).
 *   - `'discovery'`: drop any cached RFC 9728 / 8414 discovery
 *     metadata. We don't persist discovery state today, so this is
 *     a no-op — declaring it keeps the SDK contract complete.
 */
export type InvalidateOAuthScope = 'all' | 'client' | 'tokens' | 'verifier' | 'discovery';

export function invalidateOAuthCredentials(
  userId: string,
  mcpId: string,
  type: InvalidateOAuthScope,
): void {
  const all = readAll(userId);
  const entry = all[mcpId];
  if (!entry) return;

  switch (type) {
    case 'all':
      delete all[mcpId];
      break;
    case 'client':
      delete entry.clientInfo;
      break;
    case 'tokens':
      delete entry.tokens;
      break;
    case 'verifier':
      delete entry.codeVerifier;
      break;
    case 'discovery':
      // We don't persist discovery state — nothing to clear. We
      // still take this branch (instead of falling through) so the
      // store doesn't perform an unnecessary write.
      return;
  }
  writeAll(userId, all);
}

/**
 * Reverse-lookup: given an oauthState (the CSRF token issued at
 * `startAuth` time), find the (userId, mcpId) that owns it. The
 * callback route uses this to know which credential entry to update
 * after exchanging the auth code, since the upstream server only
 * sends back `?code=&state=` and has no other way to identify which
 * MCP server the response is for.
 *
 * Note: this is O(num_users × num_mcps_per_user). Given typical
 * deployments have <1k users and <10 MCP servers each, that's a
 * handful of microseconds and not worth indexing for now.
 */
export function findOAuthEntryByState(
  oauthState: string,
): { userId: string; mcpId: string; entry: McpOAuthEntry } | undefined {
  const rows = sqliteAllOAuthRows();
  for (const row of rows) {
    let parsed: Record<string, McpOAuthEntry>;
    try {
      parsed = JSON.parse(row.value) as Record<string, McpOAuthEntry>;
    } catch {
      continue;
    }
    for (const [mcpId, entry] of Object.entries(parsed)) {
      if (entry?.oauthState === oauthState) {
        return { userId: row.user_id, mcpId, entry };
      }
    }
  }
  return undefined;
}

interface OAuthRow {
  user_id: string;
  value: string;
}

function sqliteAllOAuthRows(): OAuthRow[] {
  return sqliteAll<OAuthRow>(`SELECT user_id, value FROM user_settings WHERE key = ?`, [STORE_KEY]);
}
