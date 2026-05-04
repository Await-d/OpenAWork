import { invoke } from '@tauri-apps/api/core';
import type { TokenPair } from '@openAwork/web-client';

export async function startDesktopGateway(port: number): Promise<void> {
  await invoke<void>('start_gateway', { port });
}

export async function stopDesktopGateway(): Promise<void> {
  await invoke<void>('stop_gateway');
}

export async function authenticateLocalDesktopGateway(): Promise<TokenPair> {
  return await invoke<TokenPair>('authenticate_desktop_gateway');
}
