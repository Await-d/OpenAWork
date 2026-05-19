/**
 * Coverage for `mcp-oauth-store` — the persistent store backing
 * `McpOAuthProvider`. Tests pin down:
 *
 *   1. Per-user isolation: user A's tokens MUST NOT leak into
 *      user B's reads, even when the store key collides.
 *   2. The URL gate (`getOAuthEntryForUrl`) refuses to return
 *      credentials issued for a different upstream server URL —
 *      this prevents replaying tokens after a config edit silently
 *      repoints the same `mcpId` to a new host.
 *   3. The reverse `findOAuthEntryByState` lookup correctly maps
 *      the OAuth `state` (CSRF token) back to its owning
 *      (userId, mcpId) so the callback route can resolve the
 *      pending authorization.
 *   4. Selective `invalidate` types do exactly what they say.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => {
  const rows = new Map<string, string>();
  return {
    rows,
    keyOf: (userId: string, key: string): string => `${userId}::${key}`,
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
      const value = rows.get(`${String(params[0])}::${String(params[1])}`);
      return value ? { value } : undefined;
    }),
    sqliteRunMock: vi.fn((_query: string, params: readonly unknown[] = []) => {
      rows.set(`${String(params[0])}::${String(params[1])}`, params[2] as string);
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

import {
  clearPendingOAuthFlow,
  findOAuthEntryByState,
  getOAuthEntry,
  getOAuthEntryForUrl,
  invalidateOAuthCredentials,
  setOAuthEntry,
  updateOAuthEntry,
} from '../../mcp/mcp-oauth-store.js';

describe('mcp-oauth-store', () => {
  beforeEach(() => {
    dbMock.rows.clear();
  });

  afterEach(() => {
    dbMock.rows.clear();
  });

  it("persists per-user; one user cannot read another user's credentials", () => {
    setOAuthEntry('user-A', 'github', {
      serverUrl: 'https://api.github.com/mcp',
      tokens: { accessToken: 'A-secret' },
    });
    setOAuthEntry('user-B', 'github', {
      serverUrl: 'https://api.github.com/mcp',
      tokens: { accessToken: 'B-secret' },
    });

    expect(getOAuthEntry('user-A', 'github')?.tokens?.accessToken).toBe('A-secret');
    expect(getOAuthEntry('user-B', 'github')?.tokens?.accessToken).toBe('B-secret');
    // Crucially: A cannot see B's token even though both are keyed
    // under `github`.
    expect(getOAuthEntry('user-A', 'github')?.tokens?.accessToken).not.toBe('B-secret');
  });

  it('refuses to return credentials from getOAuthEntryForUrl when the URL has changed', () => {
    setOAuthEntry('user-1', 'github', {
      serverUrl: 'https://OLD.example.com/mcp',
      tokens: { accessToken: 'old-token' },
    });

    // Same mcpId, but the user reconfigured to point at a new host.
    expect(getOAuthEntryForUrl('user-1', 'github', 'https://NEW.example.com/mcp')).toBeUndefined();

    // Reading the raw entry still returns it (so `setOAuthEntry`
    // can overwrite cleanly), but `getOAuthEntryForUrl` is the
    // safety gate.
    expect(getOAuthEntry('user-1', 'github')).toBeDefined();
  });

  it('updateOAuthEntry merges patches preserving existing fields', () => {
    setOAuthEntry('user-1', 'github', {
      serverUrl: 'https://api.github.com/mcp',
      clientInfo: { clientId: 'cid' },
    });

    updateOAuthEntry('user-1', 'github', {
      tokens: { accessToken: 'new-token' },
    });

    const entry = getOAuthEntry('user-1', 'github');
    expect(entry?.clientInfo?.clientId).toBe('cid'); // preserved
    expect(entry?.tokens?.accessToken).toBe('new-token'); // added
    expect(entry?.serverUrl).toBe('https://api.github.com/mcp'); // preserved
  });

  it("invalidate type 'verifier' drops codeVerifier without touching tokens or clientInfo", () => {
    setOAuthEntry('user-1', 'github', {
      tokens: { accessToken: 'survives' },
      clientInfo: { clientId: 'survives' },
      codeVerifier: 'doomed',
      oauthState: 'unchanged',
    });
    invalidateOAuthCredentials('user-1', 'github', 'verifier');
    const entry = getOAuthEntry('user-1', 'github');
    expect(entry?.codeVerifier).toBeUndefined();
    expect(entry?.tokens?.accessToken).toBe('survives');
    expect(entry?.clientInfo?.clientId).toBe('survives');
    // We deliberately don't clear oauthState on 'verifier' — the
    // SDK uses 'verifier' for refresh-time recovery, not for ending
    // the in-flight authorization flow.
    expect(entry?.oauthState).toBe('unchanged');
  });

  it("invalidate type 'discovery' is a no-op (we don't persist discovery state)", () => {
    setOAuthEntry('user-1', 'github', {
      tokens: { accessToken: 'survives' },
      codeVerifier: 'survives',
    });
    invalidateOAuthCredentials('user-1', 'github', 'discovery');
    const entry = getOAuthEntry('user-1', 'github');
    expect(entry?.tokens?.accessToken).toBe('survives');
    expect(entry?.codeVerifier).toBe('survives');
  });

  it('invalidate types: tokens / client / all behave as documented', () => {
    setOAuthEntry('user-1', 'github', {
      serverUrl: 'https://api.github.com/mcp',
      clientInfo: { clientId: 'cid' },
      tokens: { accessToken: 't' },
    });

    invalidateOAuthCredentials('user-1', 'github', 'tokens');
    expect(getOAuthEntry('user-1', 'github')?.tokens).toBeUndefined();
    expect(getOAuthEntry('user-1', 'github')?.clientInfo).toBeDefined();

    invalidateOAuthCredentials('user-1', 'github', 'client');
    expect(getOAuthEntry('user-1', 'github')?.clientInfo).toBeUndefined();

    setOAuthEntry('user-1', 'github', { tokens: { accessToken: 'x' } });
    invalidateOAuthCredentials('user-1', 'github', 'all');
    expect(getOAuthEntry('user-1', 'github')).toBeUndefined();
  });

  it('findOAuthEntryByState reverse-resolves to the owning (userId, mcpId)', () => {
    setOAuthEntry('user-1', 'github', { oauthState: 'state-aaa' });
    setOAuthEntry('user-1', 'gitea', { oauthState: 'state-bbb' });
    setOAuthEntry('user-2', 'github', { oauthState: 'state-ccc' });

    const found = findOAuthEntryByState('state-bbb');
    expect(found?.userId).toBe('user-1');
    expect(found?.mcpId).toBe('gitea');
  });

  it('findOAuthEntryByState returns undefined for unknown / tampered states', () => {
    setOAuthEntry('user-1', 'github', { oauthState: 'real-state' });
    expect(findOAuthEntryByState('not-a-state')).toBeUndefined();
    // Empty string must not match anything either — defence against
    // upstream redirects that drop the param entirely.
    expect(findOAuthEntryByState('')).toBeUndefined();
  });

  it('clearPendingOAuthFlow drops oauthState + codeVerifier but keeps tokens / clientInfo', () => {
    setOAuthEntry('user-1', 'github', {
      serverUrl: 'https://api.github.com/mcp',
      tokens: { accessToken: 'still-here' },
      clientInfo: { clientId: 'cid', clientSecret: 'csec' },
      codeVerifier: 'verifier-abc',
      oauthState: 'state-xyz',
    });

    clearPendingOAuthFlow('user-1', 'github');

    const entry = getOAuthEntry('user-1', 'github');
    expect(entry?.tokens?.accessToken).toBe('still-here');
    expect(entry?.clientInfo?.clientId).toBe('cid');
    expect(entry?.codeVerifier).toBeUndefined();
    expect(entry?.oauthState).toBeUndefined();
  });

  it('clearPendingOAuthFlow makes the previous state un-replayable via findOAuthEntryByState', () => {
    setOAuthEntry('user-1', 'github', { oauthState: 'spent-state' });
    expect(findOAuthEntryByState('spent-state')).toBeDefined();

    clearPendingOAuthFlow('user-1', 'github');

    // Same state value is now orphaned — a replayed callback URL
    // can no longer find the owning entry.
    expect(findOAuthEntryByState('spent-state')).toBeUndefined();
  });

  it('clearPendingOAuthFlow is a no-op when the entry does not exist', () => {
    expect(() => clearPendingOAuthFlow('nobody', 'nothing')).not.toThrow();
    expect(getOAuthEntry('nobody', 'nothing')).toBeUndefined();
  });

  it('survives a corrupt JSON blob in the store row by treating it as empty', () => {
    // Manually inject garbage to simulate a partially-written row.
    dbMock.rows.set(dbMock.keyOf('user-1', 'mcp_oauth_credentials'), 'this is not json');
    expect(getOAuthEntry('user-1', 'github')).toBeUndefined();
    // And future writes recover cleanly without a transitional crash.
    setOAuthEntry('user-1', 'github', { tokens: { accessToken: 'recovered' } });
    expect(getOAuthEntry('user-1', 'github')?.tokens?.accessToken).toBe('recovered');
  });
});
