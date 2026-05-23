import { invoke } from '@tauri-apps/api/core';
import type { TokenPair } from '@openAwork/web-client';

/**
 * 桌面端 sidecar bind 模式：
 * - `localhost`：sidecar bind 127.0.0.1，仅本机可访问（默认）；
 * - `lan`：sidecar bind 0.0.0.0，同局域网设备可通过本机 IP 访问。
 * 与 `apps/web/src/utils/desktop-gateway.ts` 的 `DesktopGatewayBindMode` 对齐。
 */
export type DesktopGatewayBindMode = 'localhost' | 'lan';

function gatewayBindHost(mode: DesktopGatewayBindMode): '127.0.0.1' | '0.0.0.0' {
  return mode === 'lan' ? '0.0.0.0' : '127.0.0.1';
}

export async function startDesktopGateway(
  port: number,
  mode: DesktopGatewayBindMode = 'localhost',
): Promise<void> {
  await invoke<void>('start_gateway', { port, host: gatewayBindHost(mode) });
}

export async function stopDesktopGateway(): Promise<void> {
  await invoke<void>('stop_gateway');
}

export async function restartDesktopApp(): Promise<void> {
  await invoke<void>('restart_app');
}

export async function isLocalDesktopGatewayHealthy(port: number): Promise<boolean> {
  return await invoke<boolean>('check_local_gateway_health', { port });
}

export async function authenticateLocalDesktopGateway(): Promise<TokenPair> {
  return await invoke<TokenPair>('authenticate_desktop_gateway');
}

export async function listLanAddresses(): Promise<string[]> {
  return await invoke<string[]>('list_lan_addresses');
}
