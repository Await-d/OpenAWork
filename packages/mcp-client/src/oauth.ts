/**
 * OAuth 2.0 helpers that wrap the MCP SDK's `auth()` entry point.
 *
 * We host these here (rather than directly inside agent-gateway)
 * for the same reason we host the SDK Client / transport
 * dynamic-import shims here: agent-gateway must NOT take a direct
 * `@modelcontextprotocol/sdk` dependency. Centralising the import
 * inside `mcp-client` keeps the SDK as a single workspace boundary.
 */

import type { MCPAuthProviderLike } from './adapter.js';
import { MCPTimeoutError } from './error-handler.js';

/**
 * Hard ceiling on the server-side OAuth code-exchange round-trip. The SDK's
 * `auth()` POSTs to the upstream token endpoint over the network but has no
 * built-in wall-clock deadline: a token endpoint that accepts the connection
 * yet never responds (half-open socket, stalled proxy) would otherwise leave
 * `runOAuthCodeExchange` pending forever — and the gateway's `/mcp/oauth/callback`
 * route awaits it with no deadline, so the user's browser tab and the fastify
 * handler hang indefinitely. Racing the exchange against this timeout converts
 * the hang into a recoverable `MCPTimeoutError` the callback maps to a 500.
 */
export const OAUTH_CODE_EXCHANGE_TIMEOUT_MS = 30_000;

/**
 * Result of {@link runOAuthCodeExchange}. Mirrors the SDK's
 * `AuthResult`:
 *   - `'AUTHORIZED'` — tokens were saved via
 *     `provider.saveTokens(...)`. Caller may proceed.
 *   - `'REDIRECT'` — the SDK decided another redirect is needed
 *     (rare; typically when dynamic registration was also outdated
 *     and the SDK already triggered a fresh `redirectToAuthorization`
 *     against the provider). Caller should drain pending state and
 *     wait for the user to come back through the callback again.
 */
export type OAuthCodeExchangeResult = 'AUTHORIZED' | 'REDIRECT';

/**
 * Server-side counterpart of `provider.redirectToAuthorization`.
 * Run this from the OAuth callback route after the user finishes
 * the upstream consent flow:
 *
 * ```ts
 * const provider = new McpOAuthProvider(...);
 * const status = await runOAuthCodeExchange(provider, serverUrl, code);
 * if (status === 'AUTHORIZED') {
 *   // tokens are already in the store; the next pool op reconnects
 * }
 * ```
 *
 * The SDK reads `provider.codeVerifier()` (saved during the
 * original `/authorize` redirect), POSTs to the token endpoint
 * with the code and verifier, and finally calls
 * `provider.saveTokens(...)` to persist the access/refresh pair.
 */
export async function runOAuthCodeExchange(
  provider: MCPAuthProviderLike,
  serverUrl: string,
  authorizationCode: string,
): Promise<OAuthCodeExchangeResult> {
  // Race the whole exchange (dynamic SDK import + auth() round-trip) against a
  // wall-clock deadline. The SDK has no internal timeout, so a hung token
  // endpoint would otherwise wedge the callback handler forever. The timer is
  // armed synchronously (before the dynamic import) so the ceiling also covers
  // a stalled module load. On timeout we reject with MCPTimeoutError; the
  // pending PKCE verifier / oauthState are preserved by the caller so a retry
  // can reuse the same redirect-issued state.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new MCPTimeoutError(serverUrl, OAUTH_CODE_EXCHANGE_TIMEOUT_MS));
    }, OAUTH_CODE_EXCHANGE_TIMEOUT_MS);
  });

  const exchange = (async (): Promise<OAuthCodeExchangeResult> => {
    const authMod = (await import('@modelcontextprotocol/sdk/client/auth.js')) as {
      auth: (
        provider: unknown,
        opts: {
          serverUrl: string | URL;
          authorizationCode?: string;
        },
      ) => Promise<OAuthCodeExchangeResult>;
    };
    return authMod.auth(provider, { serverUrl, authorizationCode });
  })();

  try {
    return await Promise.race([exchange, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
