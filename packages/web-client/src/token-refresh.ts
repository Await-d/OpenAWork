import { refreshAccessToken } from './auth.js';
import { HttpError } from './sessions.js';

export interface TokenStore {
  getAccessToken: () => string | null;
  getRefreshToken: () => string | null;
  setTokens: (accessToken: string, refreshToken: string, expiresIn: string) => void;
  clearAuth: () => void;
}

let refreshPromise: Promise<string | null> | null = null;

async function doRefresh(gatewayUrl: string, store: TokenStore): Promise<string | null> {
  const refreshToken = store.getRefreshToken();
  if (!refreshToken) {
    store.clearAuth();
    return null;
  }
  try {
    const data = await refreshAccessToken(gatewayUrl, refreshToken);
    store.setTokens(data.accessToken, data.refreshToken, data.expiresIn);
    return data.accessToken;
  } catch {
    store.clearAuth();
    return null;
  }
}

export async function withTokenRefresh<T>(
  gatewayUrl: string,
  store: TokenStore,
  fn: (token: string) => Promise<T>,
): Promise<T> {
  const token = store.getAccessToken();
  if (!token) {
    store.clearAuth();
    throw new HttpError('No access token', 401);
  }
  try {
    return await fn(token);
  } catch (err) {
    if (!(err instanceof HttpError) || err.status !== 401) throw err;
    if (!refreshPromise) {
      refreshPromise = doRefresh(gatewayUrl, store).finally(() => {
        refreshPromise = null;
      });
    }
    const newToken = await refreshPromise;
    if (!newToken) throw new HttpError('Session expired', 401);
    return await fn(newToken);
  }
}
