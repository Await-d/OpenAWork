import { useSyncExternalStore } from 'react';

export type BrowserOpenMode = 'newTab' | 'currentTab';
interface BrowserOpenRequest {
  readonly url: string;
  readonly mode: BrowserOpenMode;
}

// 仅在本次运行中保留动作；URL 持久化不能表达重复打开或新标签语义。
const pending = new Map<string, BrowserOpenRequest>();
const listeners = new Set<() => void>();
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function requestBrowserOpen(workspace: string, url: string, mode: BrowserOpenMode): void {
  pending.set(workspace, { url, mode });
  for (const listener of listeners) listener();
}

export function useBrowserOpenRequest(workspace: string | null | undefined) {
  return useSyncExternalStore(subscribe, () => (workspace ? pending.get(workspace) : undefined));
}

/** 同步认领，StrictMode effect 重放 / 其他实例不能再次执行。 */
export function consumeBrowserOpenRequest(workspace: string, request: BrowserOpenRequest): boolean {
  if (pending.get(workspace) !== request) return false;
  pending.delete(workspace);
  return true;
}
