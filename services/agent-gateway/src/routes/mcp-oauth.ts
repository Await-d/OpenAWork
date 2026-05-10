/**
 * `GET /mcp/oauth/callback?code=&state=` — OAuth 2.0 redirect URI
 * for MCP servers (PR-D-OAuth). Mirrors opencode's
 * `mcp/oauth-callback.ts` (PR-D-OAuth.1 reference) but reuses the
 * gateway's existing fastify instance instead of standing up a
 * separate HTTP server on port 19876.
 *
 * **Flow** (initiated automatically by the SDK on the first
 * connection attempt to an OAuth-protected MCP server):
 *
 *   1. SDK calls `provider.redirectToAuthorization(url)`.
 *   2. `mcp-runtime.ts`'s `onRedirect` callback fans the URL out via
 *      `publishOAuthRedirect`, which the SSE route delivers to the
 *      browser as `mcp.auth.required`.
 *   3. User completes the upstream consent flow.
 *   4. Upstream redirects to **this route** with `?code=&state=`.
 *   5. We look up `(userId, mcpId)` from the `state` (CSRF token)
 *      via the OAuth store, rebuild a {@link McpOAuthProvider}
 *      against the same persisted credentials, and call
 *      {@link finalizeOAuthFromCallback} which drives the SDK's
 *      `auth()` to POST the token endpoint with the code and
 *      saved PKCE verifier. The SDK then calls
 *      `provider.saveTokens(...)` so the next pool operation
 *      against this server reconnects with valid bearer tokens.
 *
 * Public route — does NOT require a JWT, because the upstream OAuth
 * server is the caller and it has no way to attach our tokens. CSRF
 * defence comes from the `state` parameter (cryptographically random,
 * issued by the SDK at `redirectToAuthorization` time).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { clearPendingOAuthFlow, findOAuthEntryByState } from '../mcp-oauth-store.js';
import { finalizeOAuthFromCallback, McpOAuthProvider } from '../mcp-oauth-provider.js';
import { getConfiguredServerByIdForUser } from '../mcp-runtime.js';

const HTML_SUCCESS = `<!DOCTYPE html>
<html>
<head><title>OpenAWork — Authorization Successful</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0f1117;color:#e8e8ea}h1{color:#4ade80;margin-bottom:.5rem}p{color:#a1a1aa}.box{text-align:center;padding:2rem}</style>
</head>
<body><div class="box"><h1>Authorization Successful</h1><p>You can close this window and return to OpenAWork.</p></div>
<script>setTimeout(()=>window.close(),2000)</script></body></html>`;

const HTML_ERROR = (message: string): string => `<!DOCTYPE html>
<html>
<head><title>OpenAWork — Authorization Failed</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0f1117;color:#e8e8ea}h1{color:#f87171;margin-bottom:.5rem}p{color:#a1a1aa}.box{text-align:center;padding:2rem;max-width:480px}.err{color:#fca5a5;font-family:monospace;margin-top:1rem;padding:.75rem;background:rgba(248,113,113,.1);border-radius:.5rem;font-size:.875rem}</style>
</head>
<body><div class="box"><h1>Authorization Failed</h1><p>An error occurred during authorization.</p><div class="err">${escapeHtml(message)}</div></div></body></html>`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export async function mcpOAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/mcp/oauth/callback', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = (request.query as Record<string, string | undefined>) ?? {};
    const code = query['code'];
    const state = query['state'];
    const error = query['error'];
    const errorDescription = query['error_description'];

    // CSRF defence: state must be present. Without it we can't safely
    // associate the redirect with any pending authorization.
    if (!state) {
      reply.code(400).type('text/html').send(HTML_ERROR('Missing required `state` parameter'));
      return;
    }

    // Upstream returned an error (user denied consent, server-side
    // failure, etc.). Surface the message and don't touch the store.
    if (error) {
      const msg = errorDescription || error;
      reply.code(200).type('text/html').send(HTML_ERROR(msg));
      return;
    }

    if (!code) {
      reply.code(400).type('text/html').send(HTML_ERROR('Missing `code` parameter'));
      return;
    }

    const found = findOAuthEntryByState(state);
    if (!found) {
      // Either expired (we don't track expiry yet — PR-D follow-up),
      // tampered with (real CSRF), or a genuine race where the
      // gateway restarted between `/authorize` and `/callback`.
      reply
        .code(400)
        .type('text/html')
        .send(HTML_ERROR('Invalid or expired `state` — please retry the authorization.'));
      return;
    }

    // Reconstruct the same provider that issued the redirect.
    // We can't reuse the original instance (it lived inside a
    // failed `connect()` call that already unwound), but the
    // store holds all the per-call state the SDK needs:
    //   - codeVerifier (saved by the original redirect)
    //   - clientInformation (or the static config if pre-registered)
    //   - the original serverUrl (URL gate inside the store)
    let server;
    try {
      server = getConfiguredServerByIdForUser(found.userId, found.mcpId);
    } catch (err) {
      // The MCP server config went away (user deleted it) between
      // the redirect and the callback. Nothing to recover.
      const msg = err instanceof Error ? err.message : String(err);
      reply
        .code(400)
        .type('text/html')
        .send(HTML_ERROR(`MCP server unavailable: ${msg}`));
      return;
    }

    // After this guard `oauthConfig` is a `McpOAuthConfig` object
    // (the truthy check excludes both `false` and `undefined`).
    const oauthConfig = server.oauth;
    if (
      !server.url ||
      server.transport === 'stdio' ||
      !oauthConfig ||
      typeof oauthConfig !== 'object'
    ) {
      reply
        .code(400)
        .type('text/html')
        .send(HTML_ERROR('MCP server is no longer configured for OAuth.'));
      return;
    }
    const provider = new McpOAuthProvider(found.userId, found.mcpId, server.url, oauthConfig, {
      // The SDK should NOT trigger another redirect during code
      // exchange — `auth()` with `authorizationCode` is the
      // server-side path. If it somehow does, swallow the URL
      // (we can't pop a browser tab from inside a callback handler);
      // the `'REDIRECT'` return below logs the situation.
      onRedirect: () => undefined,
    });

    try {
      const status = await finalizeOAuthFromCallback(provider, server.url, code);
      // Whether AUTHORIZED or REDIRECT, this flow's `oauthState`
      // and `codeVerifier` MUST NOT be reused. Clearing them now
      // prevents a stolen / cached / back-button-replayed callback
      // URL from being silently re-processed against the same
      // pending entry.
      clearPendingOAuthFlow(found.userId, found.mcpId);

      if (status === 'REDIRECT') {
        // Rare — typically when dynamic registration also expired
        // mid-flow. Surface as an error so the user retries
        // (which goes back through `redirectToAuthorization`).
        request.log.warn(
          { userId: found.userId, mcpId: found.mcpId },
          'MCP OAuth code exchange returned REDIRECT — re-authorization needed',
        );
        reply
          .code(200)
          .type('text/html')
          .send(
            HTML_ERROR('Re-authorization needed — please reconnect this MCP server in OpenAWork.'),
          );
        return;
      }

      request.log.info(
        { userId: found.userId, mcpId: found.mcpId },
        'MCP OAuth code exchange succeeded',
      );
      reply.code(200).type('text/html').send(HTML_SUCCESS);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Don't clear `codeVerifier` on transient failures — the user
      // can hit "retry" in their UI and the next attempt will reuse
      // the same `redirectToAuthorization`-issued verifier. We DO
      // clear `oauthState` though, since the same `state` may
      // already be considered "spent" by upstream.
      // (For now we keep both; failures are uncommon and a fresh
      // redirect overwrites both anyway.)
      request.log.error(
        { userId: found.userId, mcpId: found.mcpId, err: msg },
        'MCP OAuth code exchange failed',
      );
      reply
        .code(500)
        .type('text/html')
        .send(HTML_ERROR(`Token exchange failed: ${msg}`));
    }
  });
}
