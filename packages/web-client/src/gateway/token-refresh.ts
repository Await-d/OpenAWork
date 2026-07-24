import { refreshAccessToken } from './auth.js';
import { HttpError } from '../session/sessions.js';

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

/**
 * 全局单飞刷新入口。无论定时主动刷新还是 401 被动刷新，都通过此函数共享同一个
 * in-flight promise，避免并发使用同一个 refresh token 导致轮换竞态。
 *
 * - 如果已有刷新请求在进行中，直接 await 同一个 promise
 * - 如果没有，则启动新刷新请求
 * - 刷新成功返回新 access token，失败返回 null
 */
export async function acquireRefresh(
  gatewayUrl: string,
  store: TokenStore,
): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = doRefresh(gatewayUrl, store).finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export async function withTokenRefresh<T>(
  gatewayUrl: string,
  store: TokenStore,
  fn: (token: string) => Promise<T>,
): Promise<T> {
  const token = store.getAccessToken();
  if (!token) {
    store.clearAuth();
    throw new HttpError('当前未登录或访问令牌已失效。', 401);
  }
  try {
    return await fn(token);
  } catch (err) {
    if (!(err instanceof HttpError) || err.status !== 401) throw err;
    const newToken = await acquireRefresh(gatewayUrl, store);
    if (!newToken) throw new HttpError('登录态已过期，请重新登录。', 401);
    return await fn(newToken);
  }
}
