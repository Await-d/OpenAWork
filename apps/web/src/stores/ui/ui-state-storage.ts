import { createJSONStorage } from 'zustand/middleware';

/**
 * uiState 的节流 localStorage 适配器（抽屉：合并高频写、pagehide 时同步落盘）。
 */
const FLUSH_DELAY_MS = 200;
/** 本地持久化键名：工作台状态同步写入 / 读取快照时复用同一个键。 */
export const UI_STATE_STORAGE_KEY = 'openAwork-ui-state';
let pendingKey: string | null = null;
let pendingValue: string | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export function flushPending(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (pendingKey !== null && pendingValue !== null) {
    try {
      window.localStorage.setItem(pendingKey, pendingValue);
    } catch {
      /* quota / SecurityError — surface in console only */
    }
  }
  pendingKey = null;
  pendingValue = null;
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushPending);
  window.addEventListener('beforeunload', flushPending);
}

export const throttledStorage = createJSONStorage(() => ({
  getItem: (name: string): string | null => {
    if (pendingKey === name && pendingValue !== null) return pendingValue;
    try {
      return window.localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name: string, value: string): void => {
    pendingKey = name;
    pendingValue = value;
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flushPending, FLUSH_DELAY_MS);
  },
  removeItem: (name: string): void => {
    if (pendingKey === name) {
      pendingKey = null;
      pendingValue = null;
    }
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    try {
      window.localStorage.removeItem(name);
    } catch {
      /* ignore */
    }
  },
}));
