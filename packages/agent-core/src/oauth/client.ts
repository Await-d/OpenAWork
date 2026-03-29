import type { OAuthClientRegistration, OAuthServerMetadata, OAuthTokenResponse } from './types.js';
import type { PKCEChallenge } from './pkce.js';

export interface OAuthClientOptions {
  serverMetadataUrl: string;
  redirectUri: string;
  scopes: string[];
  clientName?: string;
}

export interface OAuthClient {
  discoverMetadata(): Promise<OAuthServerMetadata>;
  registerClient(metadata: OAuthServerMetadata): Promise<OAuthClientRegistration>;
  buildAuthorizationUrl(
    metadata: OAuthServerMetadata,
    registration: OAuthClientRegistration,
    pkce: PKCEChallenge,
    state: string,
  ): string;
  exchangeCode(
    metadata: OAuthServerMetadata,
    registration: OAuthClientRegistration,
    code: string,
    pkce: PKCEChallenge,
  ): Promise<OAuthTokenResponse>;
  refreshToken(
    metadata: OAuthServerMetadata,
    registration: OAuthClientRegistration,
    refreshToken: string,
  ): Promise<OAuthTokenResponse>;
}

function getString(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  return typeof value === 'string' ? value : undefined;
}

function getStringArray(obj: Record<string, unknown>, key: string): string[] | undefined {
  const value = obj[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  if (!value.every((item) => typeof item === 'string')) {
    return undefined;
  }
  return value;
}

export class OAuthClientImpl implements OAuthClient {
  public constructor(private readonly options: OAuthClientOptions) {}

  public async discoverMetadata(): Promise<OAuthServerMetadata> {
    const response = await fetch(this.options.serverMetadataUrl);
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`OAuth metadata discovery failed (${response.status}): ${body}`);
    }

    const json = (await response.json()) as Record<string, unknown>;
    const issuer = getString(json, 'issuer');
    const authorizationEndpoint = getString(json, 'authorization_endpoint');
    const tokenEndpoint = getString(json, 'token_endpoint');

    if (!issuer || !authorizationEndpoint || !tokenEndpoint) {
      throw new Error('Invalid OAuth metadata response: missing required endpoints');
    }

    return {
      issuer,
      authorization_endpoint: authorizationEndpoint,
      token_endpoint: tokenEndpoint,
      registration_endpoint: getString(json, 'registration_endpoint'),
      code_challenge_methods_supported: getStringArray(json, 'code_challenge_methods_supported'),
      grant_types_supported: getStringArray(json, 'grant_types_supported'),
      scopes_supported: getStringArray(json, 'scopes_supported'),
    };
  }

  public async registerClient(metadata: OAuthServerMetadata): Promise<OAuthClientRegistration> {
    if (!metadata.registration_endpoint) {
      throw new Error('OAuth server does not expose registration_endpoint');
    }

    const payload = {
      redirect_uris: [this.options.redirectUri],
      client_name: this.options.clientName,
      grant_types: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_method: 'none',
    };

    const response = await fetch(metadata.registration_endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`OAuth dynamic registration failed (${response.status}): ${body}`);
    }

    const json = (await response.json()) as Record<string, unknown>;
    const clientId = getString(json, 'client_id');
    if (!clientId) {
      throw new Error('Dynamic client registration response missing client_id');
    }

    const tokenAuthMethod = getString(json, 'token_endpoint_auth_method');
    const resolvedAuthMethod: OAuthClientRegistration['token_endpoint_auth_method'] =
      tokenAuthMethod === 'client_secret_basic' ||
      tokenAuthMethod === 'client_secret_post' ||
      tokenAuthMethod === 'none'
        ? tokenAuthMethod
        : 'none';

    const redirectUris = getStringArray(json, 'redirect_uris') ?? [this.options.redirectUri];
    const grantTypes =
      getStringArray(json, 'grant_types') ??
      (['authorization_code', 'refresh_token'] satisfies string[]);

    return {
      client_id: clientId,
      client_secret: getString(json, 'client_secret'),
      redirect_uris: redirectUris,
      client_name: getString(json, 'client_name') ?? this.options.clientName,
      grant_types: grantTypes,
      token_endpoint_auth_method: resolvedAuthMethod,
    };
  }

  public buildAuthorizationUrl(
    metadata: OAuthServerMetadata,
    registration: OAuthClientRegistration,
    pkce: PKCEChallenge,
    state: string,
  ): string {
    const url = new URL(metadata.authorization_endpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', registration.client_id);
    url.searchParams.set('redirect_uri', this.options.redirectUri);
    url.searchParams.set('scope', this.options.scopes.join(' '));
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', pkce.codeChallenge);
    url.searchParams.set('code_challenge_method', pkce.codeChallengeMethod);

    return url.toString();
  }

  public async exchangeCode(
    metadata: OAuthServerMetadata,
    registration: OAuthClientRegistration,
    code: string,
    pkce: PKCEChallenge,
  ): Promise<OAuthTokenResponse> {
    const body: Record<string, string> = {
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.options.redirectUri,
      code_verifier: pkce.codeVerifier,
    };

    return this.fetchToken(metadata.token_endpoint, registration, body);
  }

  public async refreshToken(
    metadata: OAuthServerMetadata,
    registration: OAuthClientRegistration,
    refreshToken: string,
  ): Promise<OAuthTokenResponse> {
    const body: Record<string, string> = {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    };

    return this.fetchToken(metadata.token_endpoint, registration, body);
  }

  private async fetchToken(
    tokenEndpoint: string,
    registration: OAuthClientRegistration,
    body: Record<string, string>,
  ): Promise<OAuthTokenResponse> {
    const headers = new Headers({
      'Content-Type': 'application/x-www-form-urlencoded',
    });

    if (registration.token_endpoint_auth_method === 'client_secret_basic') {
      if (!registration.client_secret) {
        throw new Error('client_secret_basic configured but client_secret is missing');
      }
      const basic = Buffer.from(`${registration.client_id}:${registration.client_secret}`).toString(
        'base64',
      );
      headers.set('Authorization', `Basic ${basic}`);
    } else {
      body['client_id'] = registration.client_id;
      if (registration.token_endpoint_auth_method === 'client_secret_post') {
        if (!registration.client_secret) {
          throw new Error('client_secret_post configured but client_secret is missing');
        }
        body['client_secret'] = registration.client_secret;
      }
    }

    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers,
      body: new URLSearchParams(body).toString(),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`OAuth token request failed (${response.status}): ${text}`);
    }

    const json = (await response.json()) as Record<string, unknown>;
    const accessToken = getString(json, 'access_token');
    const tokenType = getString(json, 'token_type');
    if (!accessToken || !tokenType) {
      throw new Error('Invalid token response: missing access_token or token_type');
    }

    const expiresInRaw = json['expires_in'];
    const expiresIn = typeof expiresInRaw === 'number' ? expiresInRaw : undefined;

    return {
      access_token: accessToken,
      token_type: tokenType,
      expires_in: expiresIn,
      refresh_token: getString(json, 'refresh_token'),
      scope: getString(json, 'scope'),
    };
  }
}
