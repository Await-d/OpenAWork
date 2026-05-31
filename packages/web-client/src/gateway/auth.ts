import {
  extractJsonErrorMessage,
  isGenericFetchErrorMessage,
  type JsonErrorData,
  fetchWithTimeout,
} from './http.js';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

const LOGIN_TIMEOUT_MS = 15_000;

function isGenericAuthNetworkErrorMessage(message: string): boolean {
  return isGenericFetchErrorMessage(message);
}

function normalizeAuthError(actionLabel: string, error: unknown): Error {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message.length > 0 && !isGenericAuthNetworkErrorMessage(message)) {
      return error;
    }
  }
  return new Error(`网络异常，${actionLabel}失败。`);
}

async function readAuthError(response: Response): Promise<JsonErrorData | undefined> {
  const data = (await response.json().catch(() => null)) as JsonErrorData | null;
  return data ?? undefined;
}

export async function login(
  gatewayUrl: string,
  email: string,
  password: string,
  timeoutMs = LOGIN_TIMEOUT_MS,
): Promise<TokenPair> {
  try {
    const res = await fetchWithTimeout(`${gatewayUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const err = await readAuthError(res);
      throw new Error(extractJsonErrorMessage(err) ?? '登录失败。');
    }
    return res.json() as Promise<TokenPair>;
  } catch (error) {
    throw normalizeAuthError('登录', error);
  }
}

const REFRESH_TIMEOUT_MS = 10_000;

const LOGOUT_TIMEOUT_MS = 10_000;

export async function refreshAccessToken(
  gatewayUrl: string,
  refreshToken: string,
  timeoutMs = REFRESH_TIMEOUT_MS,
): Promise<TokenPair> {
  try {
    const res = await fetchWithTimeout(`${gatewayUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const err = await readAuthError(res);
      throw new Error(extractJsonErrorMessage(err) ?? '刷新凭证失败。');
    }
    return res.json() as Promise<TokenPair>;
  } catch (error) {
    throw normalizeAuthError('刷新凭证', error);
  }
}

/**
 * Best-effort server-side token revocation. Unlike `login` / `refreshAccessToken`
 * this NEVER throws and NEVER hangs: sign-out must always proceed locally (the
 * caller clears persisted tokens regardless of the server's reply). Without the
 * wall-clock deadline a hung `/auth/logout` (half-open socket, stalled proxy)
 * would leave this promise pending forever and wedge any sign-out flow that
 * awaits it; without the catch, a transient network error would reject straight
 * into the caller and could abort the local clear. We bound the call and swallow
 * every failure (timeout, network, non-2xx) — the access token expires on its
 * own, so a missed revocation is a minor, self-healing degradation.
 */
export async function logout(
  gatewayUrl: string,
  accessToken: string,
  timeoutMs = LOGOUT_TIMEOUT_MS,
): Promise<void> {
  try {
    await fetchWithTimeout(`${gatewayUrl}/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    // Swallow — local sign-out proceeds regardless of server reachability.
  }
}
