import type { OAuthConfig } from './types.js';

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAtMs?: number;
  tokenType?: string;
  scope?: string;
}

export interface PlatformOAuthAdapter {
  openUrl(url: string): Promise<string>;
  startLocalServer?(): Promise<string>;
  stopLocalServer?(): Promise<void>;
}

export interface OAuthFlowManager {
  startFlow(
    config: OAuthConfig,
    adapter: PlatformOAuthAdapter,
    redirectUri?: string,
  ): Promise<OAuthTokens>;

  refreshToken(config: OAuthConfig, tokens: OAuthTokens): Promise<OAuthTokens>;

  revokeToken(config: OAuthConfig, tokens: OAuthTokens): Promise<void>;
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function generateCodeVerifier(): Promise<string> {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64UrlEncode(array.buffer);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(digest);
}

function generateState(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return base64UrlEncode(array.buffer);
}

function buildUrl(base: string, params: Record<string, string>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function parseCallbackUrl(rawUrl: string): URLSearchParams {
  try {
    return new URL(rawUrl).searchParams;
  } catch {
    return new URLSearchParams(rawUrl.includes('?') ? rawUrl.split('?')[1] : rawUrl);
  }
}

const DEFAULT_REDIRECT_URI = 'http://127.0.0.1';

export class OAuthFlowManagerImpl implements OAuthFlowManager {
  public async startFlow(
    config: OAuthConfig,
    adapter: PlatformOAuthAdapter,
    redirectUri?: string,
  ): Promise<OAuthTokens> {
    if (!config.enabled) {
      throw new Error('OAuth is not enabled for this provider');
    }
    if (!config.clientId) {
      throw new Error('OAuthConfig.clientId is required');
    }
    if (!config.authorizeUrl) {
      throw new Error('OAuthConfig.authorizeUrl is required');
    }
    if (!config.tokenUrl) {
      throw new Error('OAuthConfig.tokenUrl is required');
    }

    const usePkce = config.usePkce ?? !config.clientSecret;

    let resolvedRedirectUri = redirectUri;
    if (!resolvedRedirectUri && adapter.startLocalServer) {
      resolvedRedirectUri = await adapter.startLocalServer();
    }
    resolvedRedirectUri = resolvedRedirectUri ?? DEFAULT_REDIRECT_URI;

    const state = generateState();
    let codeVerifier: string | undefined;
    let codeChallenge: string | undefined;

    if (usePkce) {
      codeVerifier = await generateCodeVerifier();
      codeChallenge = await generateCodeChallenge(codeVerifier);
    }

    const authParams: Record<string, string> = {
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: resolvedRedirectUri,
      state,
    };

    if (config.scope) {
      authParams['scope'] = config.scope;
    }
    if (config.audience) {
      authParams['audience'] = config.audience;
    }
    if (usePkce && codeChallenge) {
      authParams['code_challenge'] = codeChallenge;
      authParams['code_challenge_method'] = 'S256';
    }

    const authUrl = buildUrl(config.authorizeUrl, authParams);

    let callbackUrl: string;
    try {
      callbackUrl = await adapter.openUrl(authUrl);
    } finally {
      if (adapter.stopLocalServer) {
        await adapter.stopLocalServer();
      }
    }

    const callbackParams = parseCallbackUrl(callbackUrl);
    const returnedState = callbackParams.get('state');
    if (returnedState !== state) {
      throw new Error('OAuth state mismatch — possible CSRF attack');
    }

    const error = callbackParams.get('error');
    if (error) {
      const description = callbackParams.get('error_description') ?? error;
      throw new Error(`OAuth authorization error: ${description}`);
    }

    const code = callbackParams.get('code');
    if (!code) {
      throw new Error('OAuth callback did not include authorization code');
    }

    return this.exchangeCode({
      tokenUrl: config.tokenUrl,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      code,
      redirectUri: resolvedRedirectUri,
      codeVerifier,
    });
  }

  public async refreshToken(config: OAuthConfig, tokens: OAuthTokens): Promise<OAuthTokens> {
    if (!config.tokenUrl) {
      throw new Error('OAuthConfig.tokenUrl is required for token refresh');
    }
    if (!config.clientId) {
      throw new Error('OAuthConfig.clientId is required for token refresh');
    }
    if (!tokens.refreshToken) {
      throw new Error('No refresh token available');
    }

    const body: Record<string, string> = {
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      client_id: config.clientId,
    };
    if (config.clientSecret) {
      body['client_secret'] = config.clientSecret;
    }
    if (config.scope) {
      body['scope'] = config.scope;
    }

    return this.fetchTokens(config.tokenUrl, body);
  }

  public async revokeToken(config: OAuthConfig, tokens: OAuthTokens): Promise<void> {
    if (!config.revokeUrl) {
      // Provider doesn't expose a revocation endpoint — nothing to do.
      return;
    }
    if (!config.clientId) {
      throw new Error('OAuthConfig.clientId is required for token revocation');
    }

    const revokeOne = async (token: string, hint: string): Promise<void> => {
      const body: Record<string, string> = {
        token,
        token_type_hint: hint,
        client_id: config.clientId as string,
      };
      if (config.clientSecret) {
        body['client_secret'] = config.clientSecret;
      }

      const response = await fetch(config.revokeUrl as string, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body).toString(),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Token revocation failed (${response.status}): ${text}`);
      }
    };

    if (tokens.accessToken) {
      await revokeOne(tokens.accessToken, 'access_token');
    }
    if (tokens.refreshToken) {
      await revokeOne(tokens.refreshToken, 'refresh_token');
    }
  }

  private async exchangeCode(params: {
    tokenUrl: string;
    clientId: string;
    clientSecret?: string;
    code: string;
    redirectUri: string;
    codeVerifier?: string;
  }): Promise<OAuthTokens> {
    const body: Record<string, string> = {
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: params.redirectUri,
      client_id: params.clientId,
    };
    if (params.clientSecret) {
      body['client_secret'] = params.clientSecret;
    }
    if (params.codeVerifier) {
      body['code_verifier'] = params.codeVerifier;
    }

    return this.fetchTokens(params.tokenUrl, body);
  }

  private async fetchTokens(tokenUrl: string, body: Record<string, string>): Promise<OAuthTokens> {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Token request failed (${response.status}): ${text}`);
    }

    const json = (await response.json()) as Record<string, unknown>;

    const accessToken = typeof json['access_token'] === 'string' ? json['access_token'] : undefined;
    if (!accessToken) {
      throw new Error('Token response missing access_token');
    }

    const refreshToken =
      typeof json['refresh_token'] === 'string' ? json['refresh_token'] : undefined;
    const tokenType = typeof json['token_type'] === 'string' ? json['token_type'] : undefined;
    const scope = typeof json['scope'] === 'string' ? json['scope'] : undefined;

    let expiresAt: number | undefined;
    if (typeof json['expires_in'] === 'number') {
      expiresAt = Date.now() + json['expires_in'] * 1000;
    }

    return { accessToken, refreshToken, tokenType, scope, expiresAtMs: expiresAt };
  }
}
