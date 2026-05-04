import type { TokenPair } from '@openAwork/web-client';
import { authenticateLocalDesktopGateway } from './tauri-gateway.js';

export type DesktopGatewayMode = 'local' | 'remote';

export const DESKTOP_GATEWAY_MODE_KEY = 'desktop_gateway_mode';
export const DEFAULT_GATEWAY_PORT = 3000;
export const DESKTOP_DEFAULT_EMAIL = 'admin@openAwork.local';
const GATEWAY_HEALTH_CHECK_ATTEMPTS = 60;
const GATEWAY_HEALTH_CHECK_INTERVAL_MS = 500;

export function normalizeGatewayUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export function localGatewayUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

export function parseGatewayPort(value: string, fallback: number = DEFAULT_GATEWAY_PORT): number {
  const port = Number.parseInt(value, 10);
  return Number.isFinite(port) && port > 0 && port < 65536 ? port : fallback;
}

export function readGatewayPortFromUrl(
  gatewayUrl: string,
  fallback: number = DEFAULT_GATEWAY_PORT,
): number {
  try {
    const parsed = new URL(gatewayUrl);
    return parseGatewayPort(parsed.port || fallback.toString(), fallback);
  } catch (_error) {
    return fallback;
  }
}

export function isLocalGatewayUrl(gatewayUrl: string): boolean {
  try {
    const parsed = new URL(gatewayUrl);
    return (
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === 'localhost' ||
      parsed.hostname === '::1'
    );
  } catch (_error) {
    return false;
  }
}

export function readDesktopGatewayMode(): DesktopGatewayMode | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }

  const value = localStorage.getItem(DESKTOP_GATEWAY_MODE_KEY);
  return value === 'local' || value === 'remote' ? value : null;
}

export function writeDesktopGatewayMode(mode: DesktopGatewayMode): void {
  if (typeof localStorage === 'undefined') {
    return;
  }

  localStorage.setItem(DESKTOP_GATEWAY_MODE_KEY, mode);
}

export async function isGatewayHealthy(gatewayUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${gatewayUrl}/health`, { signal: AbortSignal.timeout(2500) });
    return response.ok;
  } catch (_error) {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export async function waitForGatewayHealth(gatewayUrl: string): Promise<boolean> {
  for (let attempt = 0; attempt < GATEWAY_HEALTH_CHECK_ATTEMPTS; attempt += 1) {
    if (await isGatewayHealthy(gatewayUrl)) {
      return true;
    }
    await delay(GATEWAY_HEALTH_CHECK_INTERVAL_MS);
  }

  return false;
}

export async function authenticateDesktopGateway(gatewayUrl: string): Promise<TokenPair> {
  const url = normalizeGatewayUrl(gatewayUrl);
  if (!url) {
    throw new Error('请先选择 Gateway 地址');
  }

  if (!isLocalGatewayUrl(url)) {
    throw new Error('桌面默认身份仅适用于本地网关');
  }

  return await authenticateLocalDesktopGateway();
}
