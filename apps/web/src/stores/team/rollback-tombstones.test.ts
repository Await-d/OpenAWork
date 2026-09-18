import { beforeEach, describe, expect, it } from 'vitest';
import type { RollbackReceipt } from '@openAwork/web-client';
import {
  applyRollbackReceipt,
  clearRollbackScope,
  clearRollbackTombstones,
  filterActiveAuditEntries,
  useRollbackTombstoneStore,
} from './rollback-tombstones.js';

const CUTOFF_MS = 1_000;
const TOMBSTONE_MS = 2_000;

interface AuditEntry {
  id: string;
  sessionId?: string | null;
  fromSessionId?: string | null;
  toSessionId?: string | null;
  updatedAt?: number;
  timestamp?: number;
}

function buildReceipt(overrides: Partial<RollbackReceipt> = {}): RollbackReceipt {
  return {
    sessionId: 'root',
    cutoffMessageId: 'msg-cutoff',
    cutoffTimeMs: CUTOFF_MS,
    tombstoneAtMs: TOMBSTONE_MS,
    removedMessageIds: ['msg-cutoff', 'msg-after'],
    invalidatedClientRequestIds: ['req-1'],
    affectedSessionIds: ['root', 'child'],
    ...overrides,
  };
}

function auditEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 'entry',
    sessionId: 'root',
    updatedAt: CUTOFF_MS + 100,
    ...overrides,
  };
}

function activeIds(entries: AuditEntry[]): string[] {
  return filterActiveAuditEntries(entries, useRollbackTombstoneStore.getState().windows).map(
    (entry) => entry.id,
  );
}

describe('rollback-tombstones', () => {
  beforeEach(() => {
    clearRollbackTombstones();
  });

  describe('applyRollbackReceipt', () => {
    it('首次应用回执时按 cutoffMessageId 建立作废窗口', () => {
      applyRollbackReceipt(buildReceipt());

      const windows = useRollbackTombstoneStore.getState().windows;
      expect(windows).toHaveLength(1);
      expect(windows[0]?.key).toBe('msg-cutoff');
      expect(windows[0]?.affectedSessionIds).toEqual(new Set(['root', 'child']));
      expect(windows[0]?.cutoffTimeMs).toBe(CUTOFF_MS);
      expect(windows[0]?.tombstoneAtMs).toBe(TOMBSTONE_MS);
    });

    it('重复应用同一回执时保持幂等，并合并新增的受影响会话但不放宽时间边界', () => {
      applyRollbackReceipt(buildReceipt());
      applyRollbackReceipt(buildReceipt());
      expect(useRollbackTombstoneStore.getState().windows).toHaveLength(1);

      applyRollbackReceipt(
        buildReceipt({
          affectedSessionIds: ['root', 'grandchild'],
          tombstoneAtMs: TOMBSTONE_MS + 500,
        }),
      );

      const windows = useRollbackTombstoneStore.getState().windows;
      expect(windows).toHaveLength(1);
      expect(windows[0]?.affectedSessionIds).toEqual(new Set(['root', 'child', 'grandchild']));
      // 同一 cutoffMessageId 描述同一次回退：时间边界以首次登记为准，
      // 重放携带的更晚时间戳不得放宽窗口（否则会挡掉重发的回合）。
      expect(windows[0]?.cutoffTimeMs).toBe(CUTOFF_MS);
      expect(windows[0]?.tombstoneAtMs).toBe(TOMBSTONE_MS);
    });

    it('不同 cutoffMessageId 的回执各自独立', () => {
      applyRollbackReceipt(buildReceipt());
      applyRollbackReceipt(buildReceipt({ cutoffMessageId: 'msg-2' }));

      expect(useRollbackTombstoneStore.getState().windows).toHaveLength(2);
    });
  });

  describe('空操作回执（幂等重放）', () => {
    it('applied === false 的回执不建立作废窗口', () => {
      applyRollbackReceipt(
        buildReceipt({
          applied: false,
          cutoffTimeMs: TOMBSTONE_MS + 1_000,
          tombstoneAtMs: TOMBSTONE_MS + 2_000,
        }),
      );

      expect(useRollbackTombstoneStore.getState().windows).toEqual([]);
    });

    it('无 applied 字段但无删除、无失效的回执被忽略（旧网关兜底）', () => {
      applyRollbackReceipt(
        buildReceipt({ removedMessageIds: [], invalidatedClientRequestIds: [] }),
      );

      expect(useRollbackTombstoneStore.getState().windows).toEqual([]);
    });

    it('applied === true 的真实回执正常建立窗口', () => {
      applyRollbackReceipt(buildReceipt({ applied: true }));

      const windows = useRollbackTombstoneStore.getState().windows;
      expect(windows).toHaveLength(1);
      expect(windows[0]?.cutoffTimeMs).toBe(CUTOFF_MS);
      expect(windows[0]?.tombstoneAtMs).toBe(TOMBSTONE_MS);
    });

    it('已建窗口后重放空操作回执，窗口右界不被推到现在、重发回合不被误伤', () => {
      applyRollbackReceipt(buildReceipt());
      applyRollbackReceipt(
        buildReceipt({
          applied: false,
          cutoffTimeMs: TOMBSTONE_MS + 1_000,
          tombstoneAtMs: TOMBSTONE_MS + 2_000,
          removedMessageIds: [],
          invalidatedClientRequestIds: [],
        }),
      );

      const windows = useRollbackTombstoneStore.getState().windows;
      expect(windows).toHaveLength(1);
      expect(windows[0]?.cutoffTimeMs).toBe(CUTOFF_MS);
      expect(windows[0]?.tombstoneAtMs).toBe(TOMBSTONE_MS);
      expect(
        activeIds([auditEntry({ id: 'resent-turn', updatedAt: TOMBSTONE_MS + 1_500 })]),
      ).toEqual(['resent-turn']);
    });
  });

  describe('filterActiveAuditEntries 的窗口边界', () => {
    beforeEach(() => {
      applyRollbackReceipt(buildReceipt());
    });

    it('时间恰好等于 cutoffTimeMs 的条目被作废（下界闭）', () => {
      expect(activeIds([auditEntry({ updatedAt: CUTOFF_MS })])).toEqual([]);
    });

    it('时间恰好等于 tombstoneAtMs 的条目保留（上界开）', () => {
      expect(activeIds([auditEntry({ updatedAt: TOMBSTONE_MS })])).toEqual(['entry']);
    });

    it('窗口内（含下界、不含上界）的条目被作废', () => {
      const entries = [
        auditEntry({ id: 'before', updatedAt: CUTOFF_MS - 1 }),
        auditEntry({ id: 'inside-low', updatedAt: CUTOFF_MS }),
        auditEntry({ id: 'inside-high', updatedAt: TOMBSTONE_MS - 1 }),
        auditEntry({ id: 'at-tombstone', updatedAt: TOMBSTONE_MS }),
      ];
      expect(activeIds(entries)).toEqual(['before', 'at-tombstone']);
    });

    it('缺少 updatedAt 时回退到 timestamp 判定', () => {
      const entries = [
        { id: 'voided-by-timestamp', sessionId: 'root', timestamp: CUTOFF_MS + 1 },
        { id: 'kept-by-timestamp', sessionId: 'root', timestamp: CUTOFF_MS - 1 },
      ];
      expect(activeIds(entries)).toEqual(['kept-by-timestamp']);
    });
  });

  describe('跨会话隔离', () => {
    beforeEach(() => {
      applyRollbackReceipt(buildReceipt());
    });

    it('不受影响会话的同期条目保留', () => {
      const entries = [
        auditEntry({ id: 'other-session', sessionId: 'unrelated', updatedAt: CUTOFF_MS + 10 }),
        auditEntry({ id: 'affected-session', sessionId: 'child', updatedAt: CUTOFF_MS + 10 }),
      ];
      expect(activeIds(entries)).toEqual(['other-session']);
    });

    it('fromSessionId / toSessionId 命中也视为作废', () => {
      const entries = [
        {
          id: 'handoff-from',
          fromSessionId: 'root',
          toSessionId: 'child',
          updatedAt: CUTOFF_MS + 10,
        },
        {
          id: 'handoff-to',
          fromSessionId: 'other',
          toSessionId: 'root',
          updatedAt: CUTOFF_MS + 10,
        },
        {
          id: 'handoff-outside',
          fromSessionId: 'other',
          toSessionId: 'other-2',
          updatedAt: CUTOFF_MS + 10,
        },
      ];
      expect(activeIds(entries)).toEqual(['handoff-outside']);
    });
  });

  describe('晚到事件兜底', () => {
    it('回执应用后晚到的旧回合事件被读取期过滤挡掉', () => {
      applyRollbackReceipt(buildReceipt());

      const lateEvent: AuditEntry = {
        id: 'late-failed-handoff',
        sessionId: 'root',
        timestamp: TOMBSTONE_MS - 1,
      };
      expect(activeIds([lateEvent])).toEqual([]);

      const freshEvent: AuditEntry = {
        id: 'fresh-handoff',
        sessionId: 'root',
        timestamp: TOMBSTONE_MS,
      };
      expect(activeIds([freshEvent])).toEqual(['fresh-handoff']);
    });

    it('无法归属会话或时间的条目保留', () => {
      applyRollbackReceipt(buildReceipt());
      const entries = [
        { id: 'no-session', updatedAt: CUTOFF_MS + 10 },
        { id: 'no-time', sessionId: 'root' },
      ];
      expect(activeIds(entries)).toEqual(['no-session', 'no-time']);
    });

    it('没有作废窗口时返回全部条目', () => {
      const entries = [auditEntry({ id: 'a' }), auditEntry({ id: 'b', sessionId: 'other' })];
      expect(activeIds(entries)).toEqual(['a', 'b']);
    });
  });

  describe('clearRollbackScope', () => {
    it('只移除指定会话，保留窗口中其它受影响会话', () => {
      applyRollbackReceipt(buildReceipt());

      clearRollbackScope('child');

      const windows = useRollbackTombstoneStore.getState().windows;
      expect(windows).toHaveLength(1);
      expect(windows[0]?.affectedSessionIds).toEqual(new Set(['root']));
      expect(activeIds([auditEntry({ sessionId: 'child' })])).toEqual(['entry']);
    });

    it('窗口内会话全部被清除后丢弃空窗口', () => {
      applyRollbackReceipt(buildReceipt({ affectedSessionIds: ['root'] }));

      clearRollbackScope('root');

      expect(useRollbackTombstoneStore.getState().windows).toEqual([]);
      expect(activeIds([auditEntry()])).toEqual(['entry']);
    });
  });
});
