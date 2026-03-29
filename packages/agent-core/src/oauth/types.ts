export interface OAuthServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  code_challenge_methods_supported?: string[];
  grant_types_supported?: string[];
  scopes_supported?: string[];
}

export interface OAuthClientRegistration {
  client_id: string;
  client_secret?: string;
  redirect_uris: string[];
  client_name?: string;
  grant_types: string[];
  token_endpoint_auth_method: 'none' | 'client_secret_basic' | 'client_secret_post';
}

export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

export interface StoredToken {
  skillId: string;
  serverId: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
}
