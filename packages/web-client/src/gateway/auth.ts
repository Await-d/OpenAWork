export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

const LOGIN_TIMEOUT_MS = 15_000;

export async function login(
  gatewayUrl: string,
  email: string,
  password: string,
  timeoutMs = LOGIN_TIMEOUT_MS,
): Promise<TokenPair> {
  const res = await fetch(`${gatewayUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const err = (await res.json()) as { error?: string };
    throw new Error(err.error ?? 'Login failed');
  }
  return res.json() as Promise<TokenPair>;
}

const REFRESH_TIMEOUT_MS = 10_000;

export async function refreshAccessToken(
  gatewayUrl: string,
  refreshToken: string,
  timeoutMs = REFRESH_TIMEOUT_MS,
): Promise<TokenPair> {
  const res = await fetch(`${gatewayUrl}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error('Refresh failed');
  return res.json() as Promise<TokenPair>;
}

export async function logout(gatewayUrl: string, accessToken: string): Promise<void> {
  await fetch(`${gatewayUrl}/auth/logout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}
