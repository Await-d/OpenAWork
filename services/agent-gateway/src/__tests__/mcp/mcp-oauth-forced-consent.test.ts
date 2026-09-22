/**
 * Regression coverage for the forced `prompt=consent` removal in the MCP
 * OAuth authorize URL.
 *
 * Upstream `@modelcontextprotocol/sdk@1.30.0` hard-codes this inside
 * `startAuthorization()`:
 *
 *   if (scope?.includes('offline_access')) {
 *     authorizationUrl.searchParams.append('prompt', 'consent');
 *   }
 *
 * so any MCP server whose resolved scope contains `offline_access` — from
 * the user's `oauth.scope` config OR from the protected-resource metadata
 * `scopes_supported` list — always gets an extra consent screen with no way
 * to opt out. We drop that block through bun's `patchedDependencies`
 * (`patches/@modelcontextprotocol%2Fsdk@1.30.0.patch`), mirroring upstream
 * opencode v2.0.13.
 *
 * The tests below:
 *   1. Drive the real SDK authorization flow — through the same
 *      `@openAwork/mcp-client` adapter the gateway connection pool uses —
 *      against a stub OAuth server, and assert the emitted authorize URL
 *      carries no `prompt` parameter while `offline_access` stays in
 *      `scope` (both scope sources covered).
 *   2. Guard the installed SDK artifacts (ESM + CJS dist builds) against
 *      the hard-coded append reappearing — that would mean the patch
 *      silently stopped applying (e.g. `patchedDependencies` drift).
 *
 * The stub server plays three roles:
 *   - the MCP endpoint itself (`POST /mcp` → 401 + `WWW-Authenticate`),
 *     which is what makes the SDK start the OAuth flow;
 *   - RFC 9728 protected-resource metadata (only in `'prm-scopes'` mode);
 *   - RFC 8414 authorization-server metadata, whose `authorization_endpoint`
 *     becomes the captured authorize URL.
 *
 * `GET /mcp` answers 204 so the adapter's legacy-SSE fallback stops
 * immediately instead of scheduling EventSource reconnects.
 */

import { readFileSync } from 'node:fs';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { MCPClientAdapterImpl } from '@openAwork/mcp-client';
import { McpOAuthProvider } from '../../mcp/mcp-oauth-provider.js';
import type { McpOAuthConfig } from '../../mcp/mcp-runtime.js';

const USER_ID = 'user-1';

/** `'prm-scopes'` serves RFC 9728 metadata advertising `offline_access`. */
type StubMode = 'no-prm' | 'prm-scopes';

let server: Server;
let origin = '';
let mode: StubMode = 'no-prm';
const hitPaths: string[] = [];

function sendJson(res: ServerResponse, body: unknown): void {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

beforeAll(async () => {
  server = createServer((req, res) => {
    // Path only — the stub never inspects query strings or bodies.
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    hitPaths.push(`${req.method ?? 'GET'} ${pathname}`);

    if (pathname === '/mcp') {
      if (req.method === 'GET') {
        // Legacy-SSE probe from the adapter's fallback path. 204 makes the
        // EventSource stop for good (no reconnect timer left behind).
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(401, { 'content-type': 'application/json', 'www-authenticate': 'Bearer' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }

    if (mode === 'prm-scopes' && pathname.startsWith('/.well-known/oauth-protected-resource')) {
      sendJson(res, {
        resource: `${origin}/mcp`,
        authorization_servers: [origin],
        scopes_supported: ['openid', 'offline_access'],
      });
      return;
    }

    if (pathname === '/.well-known/oauth-authorization-server') {
      sendJson(res, {
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
      });
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

beforeEach(() => {
  dbMock.rows.clear();
  hitPaths.length = 0;
  mode = 'no-prm';
});

/**
 * Connect through the real adapter with OAuth enabled and return every
 * authorization URL the SDK handed to `redirectToAuthorization`. The
 * connection is expected to fail — the SDK throws `UnauthorizedError`
 * right after the redirect, and nobody has visited the authorize URL yet,
 * which is exactly the state we want to inspect.
 */
async function connectAndCaptureRedirects(oauth: McpOAuthConfig, mcpId: string): Promise<URL[]> {
  const redirects: URL[] = [];
  const adapter = new MCPClientAdapterImpl();
  const provider = new McpOAuthProvider(USER_ID, mcpId, `${origin}/mcp`, oauth, {
    onRedirect: (authorizationUrl) => {
      redirects.push(authorizationUrl);
    },
  });

  await expect(
    adapter.connect({
      id: mcpId,
      transport: 'sse',
      url: `${origin}/mcp`,
      authProvider: provider,
    }),
  ).rejects.toThrow();

  return redirects;
}

function expectNoForcedConsent(redirects: URL[]): void {
  expect(redirects.length).toBeGreaterThan(0);
  for (const authorizeUrl of redirects) {
    expect(authorizeUrl.origin).toBe(origin);
    expect(authorizeUrl.pathname).toBe('/authorize');
    expect(authorizeUrl.searchParams.has('prompt')).toBe(false);
    // The offline-scope must survive untouched — we only removed the
    // forced consent prompt, not the scope itself.
    expect(authorizeUrl.searchParams.get('scope')).toBe('openid offline_access');
  }
}

describe('MCP OAuth authorize URL', () => {
  it('keeps offline_access without adding prompt=consent when the scope comes from user config', async () => {
    const redirects = await connectAndCaptureRedirects(
      { clientId: 'openAwork-static', scope: 'openid offline_access' },
      'server-config-scope',
    );

    expectNoForcedConsent(redirects);
  });

  it('keeps offline_access without adding prompt=consent when the scope comes from PRM scopes_supported', async () => {
    mode = 'prm-scopes';
    const redirects = await connectAndCaptureRedirects(
      { clientId: 'openAwork-static' },
      'server-prm-scope',
    );

    expectNoForcedConsent(redirects);
    // Prove the PRM branch really was the scope source instead of passing
    // by accident.
    expect(hitPaths.some((p) => p.includes('/.well-known/oauth-protected-resource'))).toBe(true);
  });
});

describe('installed MCP SDK artifacts', () => {
  it('ship no hard-coded prompt=consent append in the ESM or CJS build', () => {
    const mcpClientManifest = fileURLToPath(
      new URL('../../../../../packages/mcp-client/package.json', import.meta.url),
    );
    const sdkCjsAuthPath = createRequire(mcpClientManifest).resolve(
      '@modelcontextprotocol/sdk/client/auth.js',
    );
    const sdkDistDir = dirname(dirname(dirname(sdkCjsAuthPath)));
    const files = [sdkCjsAuthPath, join(sdkDistDir, 'esm', 'client', 'auth.js')];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      // Anchor: this must be `startAuthorization`'s module, otherwise the
      // "no prompt" assertion below could pass on the wrong file.
      expect(source).toContain("authorizationUrl.searchParams.set('scope', scope)");
      // `prompt=consent` must never be forced again, in either quote style.
      expect(source).not.toContain("searchParams.append('prompt', 'consent')");
      expect(source).not.toContain('searchParams.append("prompt", "consent")');
    }
  });
});
