/**
 * Coverage for `McpOAuthProvider` — the bridge from the MCP SDK's
 * `OAuthClientProvider` interface to OpenAWork's `mcp-oauth-store`.
 *
 * The provider is the single point that decides:
 *   1. Whether the SDK gets static (pre-registered) credentials or
 *      dynamically registered ones — and when to invalidate the
 *      latter (URL change, expired client_secret).
 *   2. How the SDK's `expires_in` (relative seconds-from-now) maps
 *      to our store's `expiresAt` (absolute unix seconds), and back.
 *   3. CSRF state lifecycle — `state()` mints a fresh value when
 *      none is saved, persists it, and round-trips with `saveState`.
 *
 * These tests exercise each path against the real `mcp-oauth-store`
 * (which is in turn mocked at the `db.js` boundary — same pattern
 * the tool-sandbox tests use).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => {
  const rows = new Map<string, string>();
  const keyOf = (userId: string, key: string): string => `${userId}::${key}`;
  return {
    rows,
    keyOf,
    sqliteAllMock: vi.fn((_query: string, params: readonly unknown[] = []) => {
      const settingKey = params[0] as string;
      const out: Array<{ user_id: string; value: string }> = [];
      for (const [k, value] of rows) {
        const [user_id, key] = k.split('::');
        if (key === settingKey && user_id) out.push({ user_id, value });
      }
      return out;
    }),
    sqliteGetMock: vi.fn((_query: string, params: readonly unknown[] = []) => {
      const value = rows.get(keyOf(params[0] as string, params[1] as string));
      return value ? { value } : undefined;
    }),
    sqliteRunMock: vi.fn((_query: string, params: readonly unknown[] = []) => {
      rows.set(keyOf(params[0] as string, params[1] as string), params[2] as string);
      return { lastInsertRowid: 1, changes: 1 };
    }),
  };
});

vi.mock('../../infra/db.js', () => ({
  WORKSPACE_ROOT: '/home/await',
  WORKSPACE_ROOTS: ['/home/await'],
  WORKSPACE_ACCESS_RESTRICTED: false,
  sqliteAll: dbMock.sqliteAllMock,
  sqliteGet: dbMock.sqliteGetMock,
  sqliteRun: dbMock.sqliteRunMock,
}));

import { McpOAuthProvider, defaultCallbackUrl } from '../../mcp/mcp-oauth-provider.js';
import { getOAuthEntry } from '../../mcp/mcp-oauth-store.js';

const USER_ID = 'user-1';
const MCP_ID = 'github';
const SERVER_URL = 'https://api.github.com/mcp';

function makeProvider(opts: { onRedirect?: (u: URL) => void } = {}): McpOAuthProvider {
  return new McpOAuthProvider(
    USER_ID,
    MCP_ID,
    SERVER_URL,
    {},
    {
      onRedirect: opts.onRedirect ?? (() => undefined),
    },
  );
}

describe('McpOAuthProvider', () => {
  beforeEach(() => {
    dbMock.rows.clear();
  });

  afterEach(() => {
    dbMock.rows.clear();
  });

  it('exposes the gateway default callback URL when none is configured', () => {
    const url = defaultCallbackUrl();
    expect(url).toMatch(/^http:\/\/[^:]+:\d+\/mcp\/oauth\/callback$/);
    // 0.0.0.0 must be flipped to 127.0.0.1 so the OAuth server can
    // actually reach back into us.
    expect(url).not.toContain('0.0.0.0');
  });

  it('returns pre-registered clientId/clientSecret when configured', async () => {
    const provider = new McpOAuthProvider(
      USER_ID,
      MCP_ID,
      SERVER_URL,
      { clientId: 'static-id', clientSecret: 'static-secret' },
      { onRedirect: () => undefined },
    );
    const info = await provider.clientInformation();
    expect(info).toEqual({ client_id: 'static-id', client_secret: 'static-secret' });
  });

  it('falls back to stored dynamic-registration credentials when no static ones are configured', async () => {
    // Seed the store as if a previous registration succeeded.
    dbMock.rows.set(
      dbMock.keyOf(USER_ID, 'mcp_oauth_credentials'),
      JSON.stringify({
        [MCP_ID]: {
          serverUrl: SERVER_URL,
          clientInfo: { clientId: 'dyn-id', clientSecret: 'dyn-secret' },
        },
      }),
    );

    const provider = makeProvider();
    const info = await provider.clientInformation();
    expect(info).toEqual({ client_id: 'dyn-id', client_secret: 'dyn-secret' });
  });

  it('invalidates stored client info when its client_secret has expired', async () => {
    dbMock.rows.set(
      dbMock.keyOf(USER_ID, 'mcp_oauth_credentials'),
      JSON.stringify({
        [MCP_ID]: {
          serverUrl: SERVER_URL,
          clientInfo: {
            clientId: 'dyn-id',
            clientSecret: 'dyn-secret',
            // 1 day ago
            clientSecretExpiresAt: Math.floor(Date.now() / 1000) - 86400,
          },
        },
      }),
    );

    const provider = makeProvider();
    expect(await provider.clientInformation()).toBeUndefined();
  });

  it('rejects stored credentials that were issued for a different server URL', async () => {
    dbMock.rows.set(
      dbMock.keyOf(USER_ID, 'mcp_oauth_credentials'),
      JSON.stringify({
        [MCP_ID]: {
          serverUrl: 'https://OLD-server.example.com/mcp',
          clientInfo: { clientId: 'dyn-id', clientSecret: 'dyn-secret' },
          tokens: { accessToken: 'old-token' },
        },
      }),
    );

    const provider = makeProvider();
    expect(await provider.clientInformation()).toBeUndefined();
    expect(await provider.tokens()).toBeUndefined();
  });

  it('saves dynamic-registration client information back to the store', async () => {
    const provider = makeProvider();
    await provider.saveClientInformation!({
      client_id: 'fresh-id',
      client_secret: 'fresh-secret',
      client_id_issued_at: 1700000000,
    });

    const entry = getOAuthEntry(USER_ID, MCP_ID);
    expect(entry?.clientInfo).toEqual({
      clientId: 'fresh-id',
      clientSecret: 'fresh-secret',
      clientIdIssuedAt: 1700000000,
      clientSecretExpiresAt: undefined,
    });
    expect(entry?.serverUrl).toBe(SERVER_URL);
  });

  it('round-trips tokens, converting expires_in ↔ expiresAt correctly', async () => {
    const provider = makeProvider();
    await provider.saveTokens({
      access_token: 'access-1',
      token_type: 'Bearer',
      refresh_token: 'refresh-1',
      expires_in: 3600,
      scope: 'repo read',
    });

    const tokens = await provider.tokens();
    expect(tokens?.access_token).toBe('access-1');
    expect(tokens?.refresh_token).toBe('refresh-1');
    expect(tokens?.scope).toBe('repo read');
    // expires_in should be ~3600 (allow ±5s for test wallclock drift).
    expect(tokens?.expires_in).toBeGreaterThan(3590);
    expect(tokens?.expires_in).toBeLessThanOrEqual(3600);
  });

  it('saveTokens handles expires_in = 0 (token already dead) without dropping the field', async () => {
    const provider = makeProvider();
    await provider.saveTokens({
      access_token: 'dead-on-arrival',
      token_type: 'Bearer',
      expires_in: 0,
    });
    const entry = getOAuthEntry(USER_ID, MCP_ID);
    // expiresAt MUST be set (it's "now-ish") rather than dropped
    // to undefined — see the comment in saveTokens about
    // distinguishing "no expiry info" from "expired now".
    expect(typeof entry?.tokens?.expiresAt).toBe('number');
    // And the value is finite + an integer (no fractional seconds).
    expect(Number.isInteger(entry?.tokens?.expiresAt)).toBe(true);
  });

  it('saveTokens stores expiresAt as an integer (no fractional ms noise)', async () => {
    const provider = makeProvider();
    await provider.saveTokens({
      access_token: 'a',
      token_type: 'Bearer',
      expires_in: 1234,
    });
    const entry = getOAuthEntry(USER_ID, MCP_ID);
    expect(Number.isInteger(entry?.tokens?.expiresAt)).toBe(true);
  });

  it('persists and re-reads the PKCE code verifier across calls', async () => {
    const provider = makeProvider();
    await provider.saveCodeVerifier('verifier-abc');
    expect(await provider.codeVerifier()).toBe('verifier-abc');
  });

  it('throws a descriptive error when codeVerifier() is called without prior save', async () => {
    const provider = makeProvider();
    await expect(provider.codeVerifier()).rejects.toThrow(/PKCE code verifier/);
  });

  it('mints and persists a fresh CSRF state when none was saved', async () => {
    const provider = makeProvider();
    const state1 = await provider.state!();
    expect(state1).toMatch(/^[a-f0-9]{64}$/);

    // Subsequent calls return the persisted value, not a new one.
    const state2 = await provider.state!();
    expect(state2).toBe(state1);
  });

  it('supports selective credential invalidation via type=tokens|client|all', async () => {
    // Seed both client info and tokens.
    dbMock.rows.set(
      dbMock.keyOf(USER_ID, 'mcp_oauth_credentials'),
      JSON.stringify({
        [MCP_ID]: {
          serverUrl: SERVER_URL,
          clientInfo: { clientId: 'c', clientSecret: 's' },
          tokens: { accessToken: 'a' },
        },
      }),
    );

    const provider = makeProvider();
    await provider.invalidateCredentials!('tokens');
    expect(getOAuthEntry(USER_ID, MCP_ID)?.tokens).toBeUndefined();
    expect(getOAuthEntry(USER_ID, MCP_ID)?.clientInfo).toBeDefined();

    await provider.invalidateCredentials!('client');
    expect(getOAuthEntry(USER_ID, MCP_ID)?.clientInfo).toBeUndefined();

    // Reseed and try `'all'`.
    dbMock.rows.set(
      dbMock.keyOf(USER_ID, 'mcp_oauth_credentials'),
      JSON.stringify({
        [MCP_ID]: { tokens: { accessToken: 'x' } },
      }),
    );
    await provider.invalidateCredentials!('all');
    expect(getOAuthEntry(USER_ID, MCP_ID)).toBeUndefined();
  });

  it('forwards the authorization URL to the onRedirect callback', async () => {
    const calls: URL[] = [];
    const provider = makeProvider({
      onRedirect: (u) => {
        calls.push(u);
      },
    });
    const url = new URL(
      'https://example.com/oauth/authorize?response_type=code&client_id=x&state=y',
    );
    await provider.redirectToAuthorization(url);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.toString()).toBe(url.toString());
  });

  it('declares the right clientMetadata depending on whether a clientSecret is present', () => {
    const noSecret = new McpOAuthProvider(
      USER_ID,
      MCP_ID,
      SERVER_URL,
      {},
      { onRedirect: () => undefined },
    );
    expect(noSecret.clientMetadata.token_endpoint_auth_method).toBe('none');

    const withSecret = new McpOAuthProvider(
      USER_ID,
      MCP_ID,
      SERVER_URL,
      { clientSecret: 'shh' },
      { onRedirect: () => undefined },
    );
    expect(withSecret.clientMetadata.token_endpoint_auth_method).toBe('client_secret_post');

    const withScope = new McpOAuthProvider(
      USER_ID,
      MCP_ID,
      SERVER_URL,
      { scope: 'read write' },
      { onRedirect: () => undefined },
    );
    expect(withScope.clientMetadata.scope).toBe('read write');
  });
});
