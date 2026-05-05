import type { TokenPair } from '@openAwork/web-client';

export type DesktopGatewayMode = 'local' | 'remote';

export const DESKTOP_GATEWAY_MODE_KEY = 'desktop_gateway_mode';
export const DEFAULT_GATEWAY_PORT = 3000;
export const DESKTOP_DEFAULT_EMAIL = 'admin@openAwork.local';
const GATEWAY_HEALTH_CHECK_ATTEMPTS = 60;
const LOCAL_GATEWAY_HEALTH_CHECK_ATTEMPTS = 120;
const GATEWAY_HEALTH_CHECK_INTERVAL_MS = 500;

interface TauriRuntime {
  isTauri?: boolean;
  __TAURI__?: {
    core: {
      invoke: <T>(name: string, args?: Record<string, unknown>) => Promise<T>;
    };
  };
  __TAURI_INTERNALS__?: {
    invoke: <T>(name: string, args?: Record<string, unknown>) => Promise<T>;
  };
}

export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const runtime = window as Window & TauriRuntime;
  return Boolean(runtime.__TAURI__ || runtime.__TAURI_INTERNALS__ || runtime.isTauri);
}

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

export function desktopGatewayModeForUrl(gatewayUrl: string): DesktopGatewayMode {
  return isLocalGatewayUrl(gatewayUrl) ? 'local' : 'remote';
}

export async function isGatewayHealthy(gatewayUrl: string): Promise<boolean> {
  try {
    const url = normalizeGatewayUrl(gatewayUrl);
    if (isTauriRuntime() && isLocalGatewayUrl(url)) {
      return await invokeTauri<boolean>('check_local_gateway_health', {
        port: readGatewayPortFromUrl(url),
      });
    }

    const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2500) });
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
  const url = normalizeGatewayUrl(gatewayUrl);
  const attempts =
    isTauriRuntime() && isLocalGatewayUrl(url)
      ? LOCAL_GATEWAY_HEALTH_CHECK_ATTEMPTS
      : GATEWAY_HEALTH_CHECK_ATTEMPTS;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await isGatewayHealthy(url)) {
      return true;
    }
    await delay(GATEWAY_HEALTH_CHECK_INTERVAL_MS);
  }

  return false;
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

async function invokeTauri<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const runtime = window as Window & TauriRuntime;
  if (runtime.__TAURI__) {
    return await runtime.__TAURI__.core.invoke<T>(name, args);
  }

  if (runtime.__TAURI_INTERNALS__) {
    return await runtime.__TAURI_INTERNALS__.invoke<T>(name, args);
  }

  if (runtime.isTauri) {
    throw new Error('Tauri IPC is not available yet');
  }

  {
    throw new Error('Not running in Tauri');
  }
}

export async function startDesktopGateway(port: number): Promise<void> {
  await invokeTauri<void>('start_gateway', { port });
}

export async function stopDesktopGateway(): Promise<void> {
  await invokeTauri<void>('stop_gateway');
}

export async function authenticateDesktopGateway(gatewayUrl: string): Promise<TokenPair> {
  const url = normalizeGatewayUrl(gatewayUrl);
  if (!url) {
    throw new Error('请先选择 Gateway 地址');
  }

  if (!isLocalGatewayUrl(url)) {
    throw new Error('桌面默认身份仅适用于本地网关');
  }

  const runtime = window as Window & TauriRuntime;

  if (runtime.__TAURI__) {
    return await runtime.__TAURI__.core.invoke<TokenPair>('authenticate_desktop_gateway');
  }

  if (runtime.__TAURI_INTERNALS__) {
    return await runtime.__TAURI_INTERNALS__.invoke<TokenPair>('authenticate_desktop_gateway');
  }

  if (runtime.isTauri) {
    throw new Error('Tauri IPC is not available yet');
  }

  throw new Error('Not running in Tauri');
}
