import { AuthRequestRejectedError, refreshAccessToken } from './auth.js';
import { HttpError } from '../session/sessions.js';

export interface TokenStore {
  getAccessToken: () => string | null;
  getRefreshToken: () => string | null;
  setTokens: (accessToken: string, refreshToken: string, expiresIn: string) => void;
  clearAuth: () => void;
}

let refreshPromise: Promise<string | null> | null = null;

/**
 * `/auth/refresh` 的失败必须分两类处理，混为一谈是「一次超时 = 全体登出」的根因：
 *
 * - 服务端明确拒绝（401/403：token 已过期 / 被轮换竞态吃掉 / 用户被删）：登录态
 *   真的没了，清除 token 并让调用方走重新登录。
 * - 瞬态失败（网络中断、10s 墙钟超时、5xx）：登录态仍然有效，必须保留 token 并
 *   把错误抛给调用方按可重试失败处理。清掉 token 的话，此后所有请求都会在发出
 *   网络请求之前直接 401（`withTokenRefresh` 的无 token 分支），只能靠刷新页面
 *   （桌面端自动重登）/ 重新登录恢复。
 */
function isRefreshTokenRejected(error: unknown): boolean {
  return (
    error instanceof AuthRequestRejectedError && (error.status === 401 || error.status === 403)
  );
}

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
  } catch (error) {
    if (isRefreshTokenRejected(error)) {
      store.clearAuth();
      return null;
    }
    // 瞬态失败：保留登录态，抛出可重试错误，交由调用方展示 / 重试。
    throw error;
  }
}

/**
 * 全局单飞刷新入口。无论定时主动刷新还是 401 被动刷新，都通过此函数共享同一个
 * in-flight promise，避免并发使用同一个 refresh token 导致轮换竞态。
 *
 * - 如果已有刷新请求在进行中，直接 await 同一个 promise
 * - 如果没有，则启动新刷新请求
 * - 刷新成功返回新 access token
 * - refresh token 被服务端拒绝（401/403）时清除登录态并返回 null
 * - 瞬态失败（网络 / 超时 / 5xx）保留登录态并**抛出**该错误，按可重试失败处理
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
