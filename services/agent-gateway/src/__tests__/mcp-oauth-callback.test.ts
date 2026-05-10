/**
 * Coverage for the OAuth callback route (PR-D-OAuth follow-up).
 *
 * The route is a thin orchestrator over four moving parts:
 *   1. State → (userId, mcpId) reverse lookup via the OAuth store.
 *   2. Server config re-resolution from `mcp-runtime`.
 *   3. Provider re-construction (the original was thrown away when
 *      the failed connect unwound).
 *   4. Delegation to `finalizeOAuthFromCallback` for SDK token
 *      exchange.
 *
 * Tests pin down each of these and the error paths in between.
 */

import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const mocks = vi.hoisted(() => {
  const rows = new Map<string, string>();
  return {
    rows,
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
    finalizeMock: vi.fn(),
    getServerMock: vi.fn(),
  };
});

vi.mock('../db.js', () => ({
  WORKSPACE_ROOT: '/home/await',
  WORKSPACE_ROOTS: ['/home/await'],
  WORKSPACE_ACCESS_RESTRICTED: false,
  sqliteAll: mocks.sqliteAllMock,
  sqliteGet: mocks.sqliteGetMock,
  sqliteRun: mocks.sqliteRunMock,
}));

vi.mock('../mcp-runtime.js', () => ({
  getConfiguredServerByIdForUser: mocks.getServerMock,
}));

vi.mock('../mcp-oauth-provider.js', async () => {
  type McpOAuthProviderModule = typeof McpOAuthProviderActual;
  const actual = await vi.importActual<McpOAuthProviderModule>('../mcp-oauth-provider.js');
  return {
    ...actual,
    finalizeOAuthFromCallback: mocks.finalizeMock,
  };
});

import { mcpOAuthRoutes } from '../routes/mcp-oauth.js';
import { setOAuthEntry } from '../mcp-oauth-store.js';
import type * as McpOAuthProviderActual from '../mcp-oauth-provider.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(mcpOAuthRoutes);
  return app;
}

describe('GET /mcp/oauth/callback', () => {
  beforeEach(() => {
    mocks.rows.clear();
    mocks.finalizeMock.mockReset();
    mocks.getServerMock.mockReset();
  });

  afterEach(() => {
    mocks.rows.clear();
    vi.clearAllMocks();
  });

  it('rejects requests without a `state` parameter (CSRF defence)', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/mcp/oauth/callback?code=abc',
      });
      expect(res.statusCode).toBe(400);
      expect(res.body).toContain('Missing required `state` parameter');
    } finally {
      await app.close();
    }
  });

  it('shows the upstream error when the OAuth server returned `?error=`', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/mcp/oauth/callback?state=anything&error=access_denied&error_description=user%20said%20no',
      });
      // The upstream error is informational, not a 4xx — the
      // user already sees the error in their browser.
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('user said no');
    } finally {
      await app.close();
    }
  });

  it('rejects an unknown / tampered `state` (no entry in the store)', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/mcp/oauth/callback?state=fake-state&code=abc',
      });
      expect(res.statusCode).toBe(400);
      expect(res.body).toContain('Invalid or expired');
    } finally {
      await app.close();
    }
  });

  it('runs the full happy path: state → server lookup → provider → finalize → success page', async () => {
    setOAuthEntry('user-1', 'github', {
      serverUrl: 'https://api.github.com/mcp',
      oauthState: 'good-state',
      codeVerifier: 'verifier-abc',
    });
    mocks.getServerMock.mockReturnValue({
      id: 'github',
      name: 'GitHub',
      transport: 'sse',
      url: 'https://api.github.com/mcp',
      enabled: true,
      oauth: { clientId: 'cid' },
    });
    mocks.finalizeMock.mockResolvedValue('AUTHORIZED');

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/mcp/oauth/callback?state=good-state&code=auth-code-xyz',
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('Authorization Successful');
      expect(mocks.finalizeMock).toHaveBeenCalledTimes(1);
      const [provider, serverUrl, code] = mocks.finalizeMock.mock.calls[0]!;
      expect((provider as { redirectUrl: string }).redirectUrl).toMatch(/\/mcp\/oauth\/callback$/);
      expect(serverUrl).toBe('https://api.github.com/mcp');
      expect(code).toBe('auth-code-xyz');
    } finally {
      await app.close();
    }
  });

  it('clears the pending state after success — a replayed callback URL is rejected', async () => {
    setOAuthEntry('user-1', 'github', {
      serverUrl: 'https://api.github.com/mcp',
      oauthState: 'one-shot-state',
      codeVerifier: 'verifier-abc',
    });
    mocks.getServerMock.mockReturnValue({
      id: 'github',
      name: 'GitHub',
      transport: 'sse',
      url: 'https://api.github.com/mcp',
      enabled: true,
      oauth: {},
    });
    mocks.finalizeMock.mockResolvedValue('AUTHORIZED');

    const app = await buildApp();
    try {
      // First callback succeeds.
      const first = await app.inject({
        method: 'GET',
        url: '/mcp/oauth/callback?state=one-shot-state&code=code-1',
      });
      expect(first.statusCode).toBe(200);
      expect(first.body).toContain('Authorization Successful');

      // Second callback with the same state (browser back-button,
      // intercepted URL, etc.) MUST NOT be processed again.
      const replay = await app.inject({
        method: 'GET',
        url: '/mcp/oauth/callback?state=one-shot-state&code=code-2',
      });
      expect(replay.statusCode).toBe(400);
      expect(replay.body).toContain('Invalid or expired');
      // And finalize was NOT called a second time.
      expect(mocks.finalizeMock).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it('also clears the pending state when finalize returns REDIRECT', async () => {
    setOAuthEntry('user-1', 'github', {
      serverUrl: 'https://api.github.com/mcp',
      oauthState: 'redirect-state',
    });
    mocks.getServerMock.mockReturnValue({
      id: 'github',
      transport: 'sse',
      url: 'https://api.github.com/mcp',
      enabled: true,
      oauth: {},
    });
    mocks.finalizeMock.mockResolvedValue('REDIRECT');

    const app = await buildApp();
    try {
      const first = await app.inject({
        method: 'GET',
        url: '/mcp/oauth/callback?state=redirect-state&code=any',
      });
      expect(first.statusCode).toBe(200);
      expect(first.body).toContain('Re-authorization needed');

      // Replay must also be rejected.
      const replay = await app.inject({
        method: 'GET',
        url: '/mcp/oauth/callback?state=redirect-state&code=any',
      });
      expect(replay.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('returns 500 when finalize throws (token endpoint failure)', async () => {
    setOAuthEntry('user-1', 'github', {
      serverUrl: 'https://api.github.com/mcp',
      oauthState: 'good-state',
    });
    mocks.getServerMock.mockReturnValue({
      id: 'github',
      name: 'GitHub',
      transport: 'sse',
      url: 'https://api.github.com/mcp',
      enabled: true,
      oauth: {},
    });
    mocks.finalizeMock.mockRejectedValue(new Error('upstream is down'));

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/mcp/oauth/callback?state=good-state&code=any',
      });
      expect(res.statusCode).toBe(500);
      expect(res.body).toContain('Token exchange failed');
      expect(res.body).toContain('upstream is down');
    } finally {
      await app.close();
    }
  });

  it('rejects when the user deleted the MCP server config between authorize and callback', async () => {
    setOAuthEntry('user-1', 'github', {
      oauthState: 'good-state',
    });
    mocks.getServerMock.mockImplementation(() => {
      throw new Error('Configured MCP server not found: github');
    });

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/mcp/oauth/callback?state=good-state&code=any',
      });
      expect(res.statusCode).toBe(400);
      expect(res.body).toContain('MCP server unavailable');
    } finally {
      await app.close();
    }
  });

  it('rejects when the server is no longer configured for OAuth', async () => {
    setOAuthEntry('user-1', 'github', {
      oauthState: 'good-state',
    });
    mocks.getServerMock.mockReturnValue({
      id: 'github',
      name: 'GitHub',
      transport: 'sse',
      url: 'https://api.github.com/mcp',
      enabled: true,
      // OAuth was disabled (or never configured) for this server now.
      oauth: false,
    });

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/mcp/oauth/callback?state=good-state&code=any',
      });
      expect(res.statusCode).toBe(400);
      expect(res.body).toContain('no longer configured for OAuth');
    } finally {
      await app.close();
    }
  });
});
