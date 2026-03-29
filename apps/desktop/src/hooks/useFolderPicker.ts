import { invoke } from '@tauri-apps/api/core';

export async function pickFolder(): Promise<string | null> {
  try {
    const result = await invoke<string | null>('pick_folder');
    return result ?? null;
  } catch {
    return null;
  }
}
