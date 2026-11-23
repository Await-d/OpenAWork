import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { createMessageLimitsClient } from '@openAwork/web-client';
import type { MessageLimitsSnapshot } from '@openAwork/web-client';

export const DEFAULT_MESSAGE_MAX_CHARS = 32768;
interface LimitsState {
  snapshot: MessageLimitsSnapshot | null;
  loading: boolean;
  error: string | null;
}
interface Entry {
  state: LimitsState;
  listeners: Set<() => void>;
  revision: number;
  pending: Promise<void> | null;
  writes: number;
}
const entries = new Map<string, Entry>();
const MAX_CACHED_SCOPES = 16;
export const MESSAGE_LIMITS_POLL_MS = 30_000;
const EMPTY: LimitsState = { snapshot: null, loading: false, error: null };

function pruneEntries() {
  for (const [key, entry] of entries) {
    if (entries.size <= MAX_CACHED_SCOPES) break;
    if (entry.listeners.size === 0 && !entry.pending && entry.writes === 0) entries.delete(key);
  }
}

function getEntry(key: string): Entry {
  let entry = entries.get(key);
  if (!entry) {
    entry = { state: EMPTY, listeners: new Set(), revision: 0, pending: null, writes: 0 };
  }
  entries.delete(key);
  entries.set(key, entry);
  return entry;
}
function publish(entry: Entry, state: LimitsState) {
  entry.state = state;
  entry.listeners.forEach((notify) => notify());
}
function publishSaved(entry: Entry, snapshot: MessageLimitsSnapshot) {
  entry.revision += 1;
  publish(entry, { snapshot, loading: false, error: null });
}
async function refresh(entry: Entry, gatewayUrl: string, token: string): Promise<void> {
  if (entry.pending) return entry.pending;
  const revision = ++entry.revision;
  publish(entry, { ...entry.state, loading: true, error: null });
  const request = Promise.resolve().then(async () => {
    try {
      const snapshot = await createMessageLimitsClient(gatewayUrl).read(token);
      if (entry.revision === revision) publish(entry, { snapshot, loading: false, error: null });
    } catch (error) {
      if (entry.revision === revision) {
        publish(entry, {
          ...entry.state,
          loading: false,
          error: error instanceof Error ? error.message : '读取消息字符上限失败，请重试。',
        });
      }
    } finally {
      entry.pending = null;
      pruneEntries();
    }
  });
  entry.pending = request;
  return request;
}

export function validateMessageMaxChars(value: string, min = 1024, max = 200000): string | null {
  const number = Number(value);
  return /^\d+$/.test(value) && Number.isSafeInteger(number) && number >= min && number <= max
    ? null
    : `请输入 ${min.toLocaleString()} 至 ${max.toLocaleString()} 之间的整数。`;
}

/** 实时配置缓存：权限与数据都绑定网关、账号及 token，切换身份同步换快照。 */
export function useMessageLimits(gatewayUrl: string, token: string | null, user = '') {
  const scope = JSON.stringify([gatewayUrl.replace(/\/+$/, ''), user, token]);
  const entry = useMemo(() => getEntry(scope), [scope]);
  const subscribe = useCallback(
    (notify: () => void) => {
      entry.listeners.add(notify);
      entries.set(scope, entry);
      pruneEntries();
      return () => {
        entry.listeners.delete(notify);
        pruneEntries();
      };
    },
    [entry, scope],
  );
  const getSnapshot = useCallback(() => entry.state, [entry]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const reload = useCallback(() => {
    if (token) void refresh(entry, gatewayUrl, token);
  }, [entry, gatewayUrl, token]);
  useEffect(() => {
    reload();
    const reloadVisible = () => {
      if (document.visibilityState === 'visible') reload();
    };
    const timer = window.setInterval(reloadVisible, MESSAGE_LIMITS_POLL_MS);
    window.addEventListener('focus', reloadVisible);
    document.addEventListener('visibilitychange', reloadVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', reloadVisible);
      document.removeEventListener('visibilitychange', reloadVisible);
    };
  }, [reload]);
  const save = useCallback(
    async (maxChars: number) => {
      if (!token || !entry.state.snapshot?.canEdit) return false;
      entry.writes += 1;
      try {
        const snapshot = await createMessageLimitsClient(gatewayUrl).write(token, maxChars);
        // 使保存前的读取失效，避免晚到的旧配置覆盖成功的写入。
        publishSaved(entry, snapshot);
        window.dispatchEvent(new Event('openawork:message-limits-saved'));
        return true;
      } finally {
        entry.writes -= 1;
        pruneEntries();
      }
    },
    [entry, gatewayUrl, token],
  );
  useEffect(() => {
    window.addEventListener('openawork:message-limits-saved', reload);
    return () => window.removeEventListener('openawork:message-limits-saved', reload);
  }, [reload]);
  return {
    ...state,
    scope,
    reload,
    save,
    maxChars: state.snapshot?.maxChars ?? DEFAULT_MESSAGE_MAX_CHARS,
  };
}
