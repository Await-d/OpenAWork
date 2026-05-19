/**
 * OpenAWork's adapter from the MCP SDK's `OAuthClientProvider`
 * interface to our own `mcp-oauth-store`. Mirrors opencode's
 * `mcp/oauth-provider.ts` (PR-D-OAuth.1 reference); kept ~50% smaller
 * here because OpenAWork persists everything through the existing
 * `user_settings` table instead of standing up a new `auth.ts`
 * service abstraction.
 *
 * The SDK calls into this provider during three phases:
 *
 *   1. **Initial connect** — SDK calls `clientInformation()` and
 *      `tokens()`; if both return undefined or `tokens()` returns an
 *      expired access token, it calls `redirectToAuthorization(url)`
 *      with the authorize endpoint. The SDK throws an `UnauthorizedError`
 *      after that callback returns; the connection-pool catches it
 *      and surfaces an `auth-required` SSE event with the URL.
 *   2. **Refresh** — when the access token is expired but a refresh
 *      token exists, the SDK does the refresh-token grant
 *      automatically and calls `saveTokens()` with the new pair.
 *   3. **Re-auth on 401** — when `invalidateCredentials('tokens')`
 *      fires (server returned 401), we drop tokens; the next call
 *      goes back to phase 1.
 *
 * IMPORTANT: this provider does NOT open a browser — that's a UI
 * concern. We expose the URL to the caller via `onRedirect` so the
 * connection-pool can package it into an SSE event for the user's
 * browser to handle.
 */

import {
  getOAuthEntry,
  getOAuthEntryForUrl,
  invalidateOAuthCredentials,
  setOAuthEntry,
  updateOAuthEntry,
} from './mcp-oauth-store.js';
import type { McpOAuthConfig } from './mcp-runtime.js';

/**
 * Minimal subset of the MCP SDK's OAuth types we depend on. We
 * declare them locally to avoid pulling
 * `@modelcontextprotocol/sdk` into agent-gateway's direct
 * dependencies — same strategy `packages/mcp-client/src/adapter.ts`
 * already uses for SDK Client / transports. The shapes mirror
 * `@modelcontextprotocol/sdk/shared/auth.js` and
 * `@modelcontextprotocol/sdk/client/auth.js`.
 */
interface OAuthClientInformation {
  client_id: string;
  client_secret?: string;
}

interface OAuthClientInformationFull extends OAuthClientInformation {
  client_id_issued_at?: number;
  client_secret_expires_at?: number;
}

interface OAuthClientMetadata {
  redirect_uris: string[];
  client_name?: string;
  client_uri?: string;
  grant_types?: string[];
  response_types?: string[];
  token_endpoint_auth_method?: string;
  scope?: string;
}

interface OAuthTokens {
  access_token: string;
  token_type: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

interface OAuthClientProvider {
  readonly redirectUrl: string | URL;
  readonly clientMetadata: OAuthClientMetadata;
  clientInformation(): Promise<OAuthClientInformation | undefined>;
  saveClientInformation?(info: OAuthClientInformationFull): Promise<void>;
  tokens(): Promise<OAuthTokens | undefined>;
  saveTokens(tokens: OAuthTokens): Promise<void>;
  redirectToAuthorization(authorizationUrl: URL): Promise<void>;
  saveCodeVerifier(codeVerifier: string): Promise<void>;
  codeVerifier(): Promise<string>;
  saveState?(state: string): Promise<void>;
  state?(): Promise<string>;
  invalidateCredentials?(
    scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery',
  ): Promise<void>;
}

export const DEFAULT_OAUTH_CALLBACK_PATH = '/mcp/oauth/callback';

export interface McpOAuthProviderCallbacks {
  /**
   * Called when the SDK needs the user to visit an authorization URL.
   * The connection-pool wires this to a per-user SSE event so the
   * frontend can pop the URL into a new tab; tests can stub it to a
   * recorder array.
   */
  onRedirect: (authorizationUrl: URL) => void | Promise<void>;
}

/**
 * Compute the default callback URL. The gateway's host/port come
 * from env (`GATEWAY_HOST` / `GATEWAY_PORT`); when they're missing
 * we fall back to `127.0.0.1:3000` (the dev default), matching the
 * legacy single-process deploy. Production deployments behind a
 * reverse proxy must set `redirectUri` explicitly in the `oauth`
 * config because the proxy URL is not knowable from inside.
 */
export function defaultCallbackUrl(): string {
  const host = globalThis.process?.env?.['GATEWAY_HOST'] ?? '127.0.0.1';
  const port = globalThis.process?.env?.['GATEWAY_PORT'] ?? '3000';
  // 0.0.0.0 bind doesn't make sense as a redirect target — flip to
  // 127.0.0.1 so the OAuth server can actually reach us back.
  const reachableHost = host === '0.0.0.0' ? '127.0.0.1' : host;
  return `http://${reachableHost}:${port}${DEFAULT_OAUTH_CALLBACK_PATH}`;
}

export class McpOAuthProvider implements OAuthClientProvider {
  constructor(
    private userId: string,
    private mcpId: string,
    private serverUrl: string,
    private config: McpOAuthConfig,
    private callbacks: McpOAuthProviderCallbacks,
  ) {}

  get redirectUrl(): string {
    return this.config.redirectUri ?? defaultCallbackUrl();
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.redirectUrl],
      client_name: 'OpenAWork',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      // PKCE-only when no client_secret is configured; PKCE+secret
      // when one is. RFC 7636 lets servers reject token endpoints
      // they don't recognise so we let the SDK negotiate.
      token_endpoint_auth_method: this.config.clientSecret ? 'client_secret_post' : 'none',
      ...(this.config.scope ? { scope: this.config.scope } : {}),
    };
  }

  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    // Static (pre-registered) credentials win. This is the standard
    // case for sites that registered their MCP gateway with each
    // upstream provider out-of-band.
    if (this.config.clientId) {
      return {
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
      };
    }

    // Otherwise fall back to dynamic-registration credentials persisted
    // from a previous successful registration. The URL gate ensures
    // we don't reuse credentials issued for a different upstream.
    const entry = getOAuthEntryForUrl(this.userId, this.mcpId, this.serverUrl);
    if (!entry?.clientInfo) return undefined;

    // Honour the issuer's expiry on the client_secret — when it's
    // expired we trigger re-registration by returning undefined.
    if (
      entry.clientInfo.clientSecretExpiresAt &&
      entry.clientInfo.clientSecretExpiresAt < Date.now() / 1000
    ) {
      return undefined;
    }

    return {
      client_id: entry.clientInfo.clientId,
      client_secret: entry.clientInfo.clientSecret,
    };
  }

  async saveClientInformation(info: OAuthClientInformationFull): Promise<void> {
    updateOAuthEntry(
      this.userId,
      this.mcpId,
      {
        clientInfo: {
          clientId: info.client_id,
          clientSecret: info.client_secret,
          clientIdIssuedAt: info.client_id_issued_at,
          clientSecretExpiresAt: info.client_secret_expires_at,
        },
      },
      this.serverUrl,
    );
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const entry = getOAuthEntryForUrl(this.userId, this.mcpId, this.serverUrl);
    if (!entry?.tokens) return undefined;

    // Translate our internal `expiresAt` (absolute unix seconds) back
    // to the SDK's `expires_in` (relative seconds-from-now). The SDK
    // checks `expires_in <= 0` to decide whether to refresh.
    const expiresIn = entry.tokens.expiresAt
      ? Math.max(0, Math.floor(entry.tokens.expiresAt - Date.now() / 1000))
      : undefined;

    return {
      access_token: entry.tokens.accessToken,
      token_type: 'Bearer',
      refresh_token: entry.tokens.refreshToken,
      expires_in: expiresIn,
      scope: entry.tokens.scope,
    };
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    // Persist `expiresAt` as an absolute unix-second integer:
    //   - `Math.floor` for cleanliness — fractional seconds are
    //     just noise in the store.
    //   - `!= null` rather than truthy — `expires_in === 0` from a
    //     pathological upstream still tells us "this token is dead
    //     now", which is information we'd rather keep than drop.
    const expiresAt =
      tokens.expires_in != null ? Math.floor(Date.now() / 1000 + tokens.expires_in) : undefined;

    updateOAuthEntry(
      this.userId,
      this.mcpId,
      {
        tokens: {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt,
          scope: tokens.scope,
        },
      },
      this.serverUrl,
    );
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    await this.callbacks.onRedirect(authorizationUrl);
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    updateOAuthEntry(this.userId, this.mcpId, { codeVerifier }, this.serverUrl);
  }

  async codeVerifier(): Promise<string> {
    const entry = getOAuthEntry(this.userId, this.mcpId);
    if (!entry?.codeVerifier) {
      throw new Error(
        `No PKCE code verifier saved for MCP server '${this.mcpId}' — did the OAuth flow get interrupted before /authorize?`,
      );
    }
    return entry.codeVerifier;
  }

  async saveState(state: string): Promise<void> {
    updateOAuthEntry(this.userId, this.mcpId, { oauthState: state }, this.serverUrl);
  }

  async state(): Promise<string> {
    const entry = getOAuthEntry(this.userId, this.mcpId);
    if (entry?.oauthState) return entry.oauthState;

    // The SDK calls `state()` even when one wasn't pre-saved (e.g.
    // automatic re-auth on first connect after token expiry). Mint a
    // fresh CSRF state, persist, and return.
    const fresh = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    setOAuthEntry(this.userId, this.mcpId, {
      ...(entry ?? {}),
      oauthState: fresh,
      serverUrl: this.serverUrl,
    });
    return fresh;
  }

  async invalidateCredentials(
    type: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery',
  ): Promise<void> {
    invalidateOAuthCredentials(this.userId, this.mcpId, type);
  }
}

/**
 * Server-side counterpart of `provider.redirectToAuthorization`.
 * Drives the SDK's `auth()` helper to exchange an authorization
 * code for tokens and persist them via the provider's
 * `saveTokens(...)` callback.
 *
 * Delegates the actual SDK call to `@openAwork/mcp-client`'s
 * `runOAuthCodeExchange` so the SDK dependency stays in a single
 * workspace package (`agent-gateway` doesn't directly depend on
 * `@modelcontextprotocol/sdk`).
 *
 * Returns `'AUTHORIZED'` on success (tokens saved, caller may
 * proceed) or `'REDIRECT'` if the SDK decided another redirect is
 * needed (rare). Errors during code exchange throw.
 */
export async function finalizeOAuthFromCallback(
  provider: McpOAuthProvider,
  serverUrl: string,
  authorizationCode: string,
): Promise<'AUTHORIZED' | 'REDIRECT'> {
  const { runOAuthCodeExchange } = await import('@openAwork/mcp-client');
  return runOAuthCodeExchange(provider, serverUrl, authorizationCode);
}
