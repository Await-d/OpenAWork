import type { TokenPair } from './auth.js';

const PAIRING_TIMEOUT_MS = 10_000;

export interface PairingQrResponse {
  dataUrl: string;
  expiresAt: number;
  hostUrl: string;
  qrData: string;
}

export async function getPairingQr(
  gatewayUrl: string,
  accessToken?: string,
  timeoutMs = PAIRING_TIMEOUT_MS,
): Promise<PairingQrResponse> {
  const res = await fetch(`${gatewayUrl}/pairing/qr`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error('Failed to load pairing QR');
  }
  return res.json() as Promise<PairingQrResponse>;
}

export async function loginWithDesktopDefault(
  gatewayUrl: string,
  desktopAuthToken: string,
  input: { deviceName?: string; platform?: 'desktop' } = {},
  timeoutMs = PAIRING_TIMEOUT_MS,
): Promise<TokenPair> {
  const res = await fetch(`${gatewayUrl}/auth/desktop-default`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-OpenAWork-Desktop-Auth': desktopAuthToken,
    },
    body: JSON.stringify({ platform: 'desktop', ...input }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const err = (await res.json()) as { error?: string };
    throw new Error(err.error ?? 'Desktop default login failed');
  }
  return res.json() as Promise<TokenPair>;
}

export async function loginWithPairingToken(
  hostUrl: string,
  token: string,
  input: { deviceName?: string; platform?: 'ios' | 'android' | 'web' } = {},
  timeoutMs = PAIRING_TIMEOUT_MS,
): Promise<TokenPair> {
  const res = await fetch(`${hostUrl}/pairing/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, ...input }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const err = (await res.json()) as { error?: string };
    throw new Error(err.error ?? 'Pairing login failed');
  }
  return res.json() as Promise<TokenPair>;
}
