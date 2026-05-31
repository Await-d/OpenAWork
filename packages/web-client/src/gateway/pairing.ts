import type { TokenPair } from './auth.js';
import {
  extractJsonErrorMessage,
  isGenericFetchErrorMessage,
  type JsonErrorData,
  fetchWithTimeout,
} from './http.js';

const PAIRING_TIMEOUT_MS = 10_000;

export interface PairingQrResponse {
  dataUrl: string;
  expiresAt: number;
  hostUrl: string;
  qrData: string;
}

function isGenericPairingNetworkErrorMessage(message: string): boolean {
  return isGenericFetchErrorMessage(message);
}

function normalizePairingError(actionLabel: string, error: unknown): Error {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message.length > 0 && !isGenericPairingNetworkErrorMessage(message)) {
      return error;
    }
  }
  return new Error(`网络异常，${actionLabel}失败。`);
}

async function readPairingError(response: Response): Promise<JsonErrorData | undefined> {
  const data = (await response.json().catch(() => null)) as JsonErrorData | null;
  return data ?? undefined;
}

export async function getPairingQr(
  gatewayUrl: string,
  accessToken?: string,
  timeoutMs = PAIRING_TIMEOUT_MS,
): Promise<PairingQrResponse> {
  try {
    const res = await fetchWithTimeout(`${gatewayUrl}/pairing/qr`, {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const data = await readPairingError(res);
      throw new Error(extractJsonErrorMessage(data) ?? '加载配对二维码失败。');
    }
    return res.json() as Promise<PairingQrResponse>;
  } catch (error) {
    throw normalizePairingError('加载配对二维码', error);
  }
}

export async function loginWithDesktopDefault(
  gatewayUrl: string,
  desktopAuthToken: string,
  input: { deviceName?: string; platform?: 'desktop' } = {},
  timeoutMs = PAIRING_TIMEOUT_MS,
): Promise<TokenPair> {
  try {
    const res = await fetchWithTimeout(`${gatewayUrl}/auth/desktop-default`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-OpenAWork-Desktop-Auth': desktopAuthToken,
      },
      body: JSON.stringify({ platform: 'desktop', ...input }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const err = await readPairingError(res);
      throw new Error(extractJsonErrorMessage(err) ?? '桌面默认登录失败。');
    }
    return res.json() as Promise<TokenPair>;
  } catch (error) {
    throw normalizePairingError('桌面默认登录', error);
  }
}

export async function loginWithPairingToken(
  hostUrl: string,
  token: string,
  input: { deviceName?: string; platform?: 'ios' | 'android' | 'web' } = {},
  timeoutMs = PAIRING_TIMEOUT_MS,
): Promise<TokenPair> {
  try {
    const res = await fetchWithTimeout(`${hostUrl}/pairing/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, ...input }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const err = await readPairingError(res);
      throw new Error(extractJsonErrorMessage(err) ?? '配对登录失败。');
    }
    return res.json() as Promise<TokenPair>;
  } catch (error) {
    throw normalizePairingError('配对登录', error);
  }
}
