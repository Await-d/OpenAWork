import type { OAuthClientRegistration, OAuthServerMetadata, StoredToken } from './types.js';
import type { OAuthClient } from './client.js';

export interface TokenStore {
  save(token: StoredToken): void;
  get(skillId: string, serverId: string): StoredToken | null;
  isExpired(token: StoredToken): boolean;
  delete(skillId: string, serverId: string): void;
  autoRefresh(
    skillId: string,
    serverId: string,
    client: OAuthClient,
    metadata: OAuthServerMetadata,
    registration: OAuthClientRegistration,
  ): Promise<StoredToken | null>;
}

const EXPIRY_BUFFER_MS = 60_000;

function toTokenKey(skillId: string, serverId: string): string {
  return `${skillId}:${serverId}`;
}

export class InMemoryTokenStore implements TokenStore {
  private readonly tokens = new Map<string, StoredToken>();
  /**
   * In-flight refreshes keyed by token key. A refresh consumes the current
   * refresh token; many OAuth servers rotate it (RFC 6749 §10.4), so two
   * concurrent `autoRefresh` calls racing on the same expired token would
   * have the second request reuse an already-rotated (now invalid) refresh
   * token and fail, breaking the connection. Sharing one promise per key
   * collapses concurrent refreshes into a single round-trip.
   */
  private readonly inflightRefreshes = new Map<string, Promise<StoredToken | null>>();

  public save(token: StoredToken): void {
    this.tokens.set(toTokenKey(token.skillId, token.serverId), token);
  }

  public get(skillId: string, serverId: string): StoredToken | null {
    const token = this.tokens.get(toTokenKey(skillId, serverId));
    if (!token) {
      return null;
    }

    if (this.isExpired(token)) {
      return null;
    }

    return token;
  }

  public isExpired(token: StoredToken): boolean {
    if (!token.expiresAt) {
      return false;
    }

    return token.expiresAt - EXPIRY_BUFFER_MS <= Date.now();
  }

  public delete(skillId: string, serverId: string): void {
    this.tokens.delete(toTokenKey(skillId, serverId));
  }

  public async autoRefresh(
    skillId: string,
    serverId: string,
    client: OAuthClient,
    metadata: OAuthServerMetadata,
    registration: OAuthClientRegistration,
  ): Promise<StoredToken | null> {
    const key = toTokenKey(skillId, serverId);
    const current = this.tokens.get(key);
    if (!current) {
      return null;
    }

    if (!this.isExpired(current)) {
      return current;
    }

    if (!current.refreshToken) {
      return null;
    }
    const refreshToken = current.refreshToken;

    // Coalesce concurrent refreshes for the same key onto one round-trip.
    const existing = this.inflightRefreshes.get(key);
    if (existing) {
      return existing;
    }

    const refreshPromise = (async (): Promise<StoredToken | null> => {
      const refreshed = await client.refreshToken(metadata, registration, refreshToken);
      const next: StoredToken = {
        skillId,
        serverId,
        accessToken: refreshed.access_token,
        refreshToken: refreshed.refresh_token ?? refreshToken,
        expiresAt:
          typeof refreshed.expires_in === 'number'
            ? Date.now() + refreshed.expires_in * 1000
            : undefined,
        scope: refreshed.scope ?? current.scope,
      };
      this.save(next);
      return next;
    })().finally(() => {
      this.inflightRefreshes.delete(key);
    });

    this.inflightRefreshes.set(key, refreshPromise);
    return refreshPromise;
  }
}
