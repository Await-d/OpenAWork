/**
 * 回合回退的「作废窗口」——S3 团队面（handoff / 任务 / 事件 / 审计）的读取期过滤。
 *
 * 后端回退会硬删该回合的团队记录并广播 `session.messages.rolled_back`，但 WS 投递
 * 不保证顺序：晚到的事件仍可能把已删除的状态重新写回 store。因此除服务端删除外，
 * 前端必须保留作废窗口，在读取期把落在窗口内的记录挡掉（多端幂等失效）。
 *
 * 这里刻意**不做**任何 store 级删除：`useHandoffStore` / `useLayerStore` /
 * `useTeamNotificationStore` / `useClarificationStore` 只有全局 `clear()`，
 * 调用它会抹掉其它会话与团队的数据。
 */
import { create } from 'zustand';
import type { RollbackReceipt } from '@openAwork/web-client';

export interface RollbackVoidWindow {
  key: string;
  affectedSessionIds: ReadonlySet<string>;
  cutoffTimeMs: number;
  tombstoneAtMs: number;
}

/** 长生命周期页面上窗口数有界；超出后淘汰最旧的窗口。 */
const MAX_ROLLBACK_WINDOWS = 100;

interface RollbackTombstoneStoreState {
  windows: RollbackVoidWindow[];
  applyWindow: (window: RollbackVoidWindow) => void;
  clearScope: (sessionId: string) => void;
  clear: () => void;
}

export const useRollbackTombstoneStore = create<RollbackTombstoneStoreState>((set) => ({
  windows: [],
  applyWindow: (window) =>
    set((state) => {
      const existingIndex = state.windows.findIndex((existing) => existing.key === window.key);
      if (existingIndex < 0) {
        const next = [...state.windows, window];
        return {
          windows: next.length > MAX_ROLLBACK_WINDOWS ? next.slice(-MAX_ROLLBACK_WINDOWS) : next,
        };
      }
      const existing = state.windows[existingIndex];
      if (!existing) {
        return state;
      }
      // 同一 key（cutoffMessageId）描述的是同一次回退：时间边界以首次登记为准。
      // 重放（多标签页重复重试 / 广播重投）可能带来 `cutoffTimeMs ≈ tombstoneAtMs ≈ now`
      // 的幂等回执，若按 min/max 合并会把窗口右界推到 now，连紧随其后重发的新回合
      // 记录也一起挡掉。这里只允许受影响会话集合单调扩张（只会扩大过滤面，不会放宽
      // 时间窗口），时间戳一律保持首次值。
      const affectedSessionIds = new Set(existing.affectedSessionIds);
      for (const sessionId of window.affectedSessionIds) {
        affectedSessionIds.add(sessionId);
      }
      if (affectedSessionIds.size === existing.affectedSessionIds.size) {
        return state;
      }
      const merged: RollbackVoidWindow = {
        key: window.key,
        affectedSessionIds,
        cutoffTimeMs: existing.cutoffTimeMs,
        tombstoneAtMs: existing.tombstoneAtMs,
      };
      const windows = [...state.windows];
      windows[existingIndex] = merged;
      return { windows };
    }),
  clearScope: (sessionId) =>
    set((state) => {
      let changed = false;
      const windows: RollbackVoidWindow[] = [];
      for (const window of state.windows) {
        if (!window.affectedSessionIds.has(sessionId)) {
          windows.push(window);
          continue;
        }
        changed = true;
        const affectedSessionIds = new Set(window.affectedSessionIds);
        affectedSessionIds.delete(sessionId);
        if (affectedSessionIds.size > 0) {
          windows.push({ ...window, affectedSessionIds });
        }
      }
      return changed ? { windows } : state;
    }),
  clear: () => set({ windows: [] }),
}));

/**
 * 判断回执是否为「空操作」。
 *
 * `applied === false` 是网关对幂等重放的显式标记；旧网关没有该字段，
 * 用「没有删除消息、也没有失效请求」兜底识别。两者都必须拒绝登记：这类回执的
 * `cutoffTimeMs ≈ tombstoneAtMs ≈ now`，按普通回执合并会把窗口右界推到 now，
 * 误伤重发回合的记录（多标签页重复重试是明确支持的场景）。
 */
function isNoopRollbackReceipt(receipt: RollbackReceipt): boolean {
  if (receipt.applied === false) {
    return true;
  }
  return receipt.removedMessageIds.length === 0 && receipt.invalidatedClientRequestIds.length === 0;
}

export function applyRollbackReceipt(receipt: RollbackReceipt): void {
  if (isNoopRollbackReceipt(receipt)) {
    return;
  }
  useRollbackTombstoneStore.getState().applyWindow({
    key: receipt.cutoffMessageId,
    affectedSessionIds: new Set(receipt.affectedSessionIds),
    cutoffTimeMs: receipt.cutoffTimeMs,
    tombstoneAtMs: receipt.tombstoneAtMs,
  });
}

export function clearRollbackScope(sessionId: string): void {
  useRollbackTombstoneStore.getState().clearScope(sessionId);
}

export function clearRollbackTombstones(): void {
  useRollbackTombstoneStore.getState().clear();
}

export function useRollbackVoidWindows(): readonly RollbackVoidWindow[] {
  return useRollbackTombstoneStore((state) => state.windows);
}

interface RollbackFilterableEntry {
  sessionId?: string | null;
  fromSessionId?: string | null;
  toSessionId?: string | null;
  updatedAt?: number;
  timestamp?: number;
}

function resolveEntryTimeMs(entry: RollbackFilterableEntry): number | undefined {
  if (typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt)) {
    return entry.updatedAt;
  }
  if (typeof entry.timestamp === 'number' && Number.isFinite(entry.timestamp)) {
    return entry.timestamp;
  }
  return undefined;
}

function isEntryVoidedByWindow(
  entry: RollbackFilterableEntry,
  window: RollbackVoidWindow,
): boolean {
  const timeMs = resolveEntryTimeMs(entry);
  if (timeMs === undefined || timeMs < window.cutoffTimeMs || timeMs >= window.tombstoneAtMs) {
    return false;
  }
  return (
    (entry.sessionId != null && window.affectedSessionIds.has(entry.sessionId)) ||
    (entry.fromSessionId != null && window.affectedSessionIds.has(entry.fromSessionId)) ||
    (entry.toSessionId != null && window.affectedSessionIds.has(entry.toSessionId))
  );
}

/**
 * 读取期过滤：条目任一会话 id 命中窗口的 `affectedSessionIds`，且时间落在
 * `[cutoffTimeMs, tombstoneAtMs)` 内即视为已作废。无法归属会话或时间的条目保留
 * （宁可多显示，不可误删历史）。
 */
export function filterActiveAuditEntries<
  T extends {
    sessionId?: string | null;
    fromSessionId?: string | null;
    toSessionId?: string | null;
    updatedAt?: number;
    timestamp?: number;
  },
>(entries: readonly T[], windows: readonly RollbackVoidWindow[]): T[] {
  if (windows.length === 0) {
    return [...entries];
  }
  return entries.filter((entry) => !windows.some((window) => isEntryVoidedByWindow(entry, window)));
}
