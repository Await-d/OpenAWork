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
}
