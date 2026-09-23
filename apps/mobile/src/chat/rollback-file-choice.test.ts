import { describe, expect, it } from 'vitest';
import type { SnapshotTreeEntry } from '@openAwork/web-client';
import type { MobileChatMessage } from './chat-message-content';
import {
  MOBILE_DETECTION_FAILED_REASON,
  MOBILE_NO_SNAPSHOT_REASON,
  MOBILE_SNAPSHOT_READ_FAILED_REASON,
  buildMobileRollbackAlertMessage,
  buildMobileRollbackChoiceModel,
  collectAffectedRequestIdsFromMessages,
  selectAffectedSnapshots,
  toTimestamp,
} from './rollback-file-choice';

function makeMessage(overrides: Partial<MobileChatMessage> & { id: string }): MobileChatMessage {
  return {
    role: 'assistant',
    content: overrides.id,
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<SnapshotTreeEntry> = {}): SnapshotTreeEntry {
  return {
    treeHash: 'tree-1',
    parentTreeHash: 'tree-parent',
    clientRequestId: 'req-1',
    scopeKind: 'turn',
    sourceKind: 'session_snapshot',
    guaranteeLevel: 'strong',
    filesChanged: 1,
    additions: 1,
    deletions: 0,
    toolName: null,
    toolCallId: null,
    createdAt: '2026-07-15T10:05:00.000Z',
    ...overrides,
  };
}

describe('toTimestamp', () => {
  it('SQLite datetime(now) 形态必须按 UTC 解析，ISO / 毫秒数保持原语义', () => {
    expect(toTimestamp('2026-07-15 10:05:00')).toBe(Date.UTC(2026, 6, 15, 10, 5, 0));
    expect(toTimestamp('2026-07-15T10:05:00.000Z')).toBe(Date.UTC(2026, 6, 15, 10, 5, 0));
    expect(toTimestamp(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(toTimestamp('not-a-date')).toBeNull();
    expect(toTimestamp(undefined)).toBeNull();
  });
});

describe('collectAffectedRequestIdsFromMessages', () => {
  it('只收集源消息及其之后的回合键并去重', () => {
    const messages: MobileChatMessage[] = [
      makeMessage({ id: 'u-1', role: 'user' }),
      makeMessage({ id: 'a-1', clientRequestIds: ['req-1'] }),
      makeMessage({ id: 'u-2', role: 'user' }),
      makeMessage({ id: 'a-2', clientRequestIds: ['req-2', 'req-1'] }),
    ];
    expect(collectAffectedRequestIdsFromMessages({ messages, sourceMessageId: 'u-2' })).toEqual([
      'req-2',
      'req-1',
    ]);
    expect(collectAffectedRequestIdsFromMessages({ messages, sourceMessageId: 'u-1' })).toEqual([
      'req-1',
      'req-2',
    ]);
  });

  it('源消息为 assistant 时包含它自己的回合键（inclusive 截断语义）', () => {
    const messages: MobileChatMessage[] = [
      makeMessage({ id: 'u-1', role: 'user' }),
      makeMessage({ id: 'a-1', clientRequestIds: ['req-1'] }),
      makeMessage({ id: 'u-2', role: 'user' }),
      makeMessage({ id: 'a-2', clientRequestIds: ['req-2'] }),
    ];
    expect(collectAffectedRequestIdsFromMessages({ messages, sourceMessageId: 'a-1' })).toEqual([
      'req-1',
      'req-2',
    ]);
  });

  it('缺源消息时返回空集合', () => {
    expect(
      collectAffectedRequestIdsFromMessages({ messages: [], sourceMessageId: 'missing' }),
    ).toEqual([]);
    expect(collectAffectedRequestIdsFromMessages({ messages: [] })).toEqual([]);
  });
});

describe('selectAffectedSnapshots', () => {
  it('有回合键时按 clientRequestId 精确匹配并按时间升序（输入为网关 DESC 顺序）', () => {
    const snapshots = [
      makeSnapshot({
        treeHash: 'late',
        clientRequestId: 'req-1',
        createdAt: '2026-07-15T10:09:00.000Z',
      }),
      makeSnapshot({
        treeHash: 'early',
        clientRequestId: 'req-1',
        createdAt: '2026-07-15T10:01:00.000Z',
      }),
      makeSnapshot({
        treeHash: 'other',
        clientRequestId: 'req-9',
        createdAt: '2026-07-15T10:02:00.000Z',
      }),
    ];
    const selected = selectAffectedSnapshots({
      messages: [],
      requestIds: ['req-1'],
      snapshots,
    });
    expect(selected.map((snapshot) => snapshot.treeHash)).toEqual(['early', 'late']);
  });

  it('回合键零命中时回退到时间过滤（与 Web 同口径，不得直接静默）', () => {
    const messages = [makeMessage({ id: 'u-1', role: 'user', createdAtMs: 1_000 })];
    const snapshots = [
      makeSnapshot({
        treeHash: 'after',
        clientRequestId: 'req-unknown',
        createdAt: '2026-07-15T10:00:00.000Z',
      }),
      makeSnapshot({
        treeHash: 'before',
        clientRequestId: 'req-unknown',
        createdAt: '1970-01-01T00:00:00.000Z',
      }),
    ];
    const selected = selectAffectedSnapshots({
      messages,
      requestIds: ['req-missing'],
      snapshots,
      sourceMessageId: 'u-1',
    });
    expect(selected.map((snapshot) => snapshot.treeHash)).toEqual(['after']);
  });

  it('同一回合内同秒并列时取更早者在前（DESC 输入翻转后稳定排序）', () => {
    const sameSecond = '2026-07-15 10:05:00';
    const stepOne = makeSnapshot({
      treeHash: 'step-1',
      clientRequestId: 'req-1',
      createdAt: sameSecond,
    });
    const stepTwo = makeSnapshot({
      treeHash: 'step-2',
      clientRequestId: 'req-1',
      createdAt: sameSecond,
    });
    const selected = selectAffectedSnapshots({
      messages: [],
      requestIds: ['req-1'],
      snapshots: [stepTwo, stepOne],
    });
    expect(selected.map((snapshot) => snapshot.treeHash)).toEqual(['step-1', 'step-2']);
  });

  it('无回合键也无时间时返回全部快照（保守）', () => {
    const snapshots = [makeSnapshot({ treeHash: 'a' }), makeSnapshot({ treeHash: 'b' })];
    expect(selectAffectedSnapshots({ messages: [], requestIds: [], snapshots })).toHaveLength(2);
  });
});

describe('buildMobileRollbackChoiceModel', () => {
  it('去重、汇总文件数、取最早快照的父树作为恢复基线', () => {
    const model = buildMobileRollbackChoiceModel({
      snapshots: [
        makeSnapshot({ treeHash: 'tree-1', parentTreeHash: 'tree-parent', filesChanged: 2 }),
        makeSnapshot({ treeHash: 'tree-1', parentTreeHash: 'tree-parent', filesChanged: 2 }),
        makeSnapshot({ treeHash: 'tree-2', parentTreeHash: 'tree-1', filesChanged: 3 }),
      ],
    });
    expect(model.changesDetected).toBe(true);
    expect(model.detectionIncomplete).toBe(false);
    expect(model.affectedSnapshots).toHaveLength(2);
    expect(model.fileCount).toBe(5);
    expect(model.restoreTargetTreeHash).toBe('tree-parent');
    expect(model.restoreUnavailableReason).toBeNull();
    expect(model.summaryText).toContain('2 个快照');
  });

  it('无父快照时给出不可恢复原因', () => {
    const model = buildMobileRollbackChoiceModel({
      snapshots: [makeSnapshot({ treeHash: 'tree-1', parentTreeHash: null })],
    });
    expect(model.restoreTargetTreeHash).toBeNull();
    expect(model.restoreUnavailableReason).toBe(MOBILE_NO_SNAPSHOT_REASON);
  });

  it('无证据且读取失败 → 检测不完整（「无法确认」，不是「无法恢复」）', () => {
    const model = buildMobileRollbackChoiceModel({
      snapshots: [],
      snapshotListFailed: true,
      diffLoadFailed: true,
    });
    expect(model.changesDetected).toBe(false);
    expect(model.detectionIncomplete).toBe(true);
    expect(model.restoreUnavailableReason).toBe(MOBILE_DETECTION_FAILED_REASON);
    expect(model.summaryText).toContain('无法确认');
  });

  it('有变更证据但快照列表失败 → 恢复不可用（无法保证完整恢复）', () => {
    const model = buildMobileRollbackChoiceModel({
      snapshots: [],
      snapshotListFailed: true,
      hasFileChangeEvidence: true,
    });
    expect(model.changesDetected).toBe(true);
    expect(model.detectionIncomplete).toBe(true);
    expect(model.restoreUnavailableReason).toBe(MOBILE_SNAPSHOT_READ_FAILED_REASON);
  });

  it('仅按 request 投影有证据时也判定为检测到变更', () => {
    const model = buildMobileRollbackChoiceModel({
      snapshots: [],
      hasFileChangeEvidence: true,
    });
    expect(model.changesDetected).toBe(true);
    expect(model.summaryText).toContain('检测到文件变更');
    expect(model.restoreUnavailableReason).toBe(MOBILE_NO_SNAPSHOT_REASON);
  });
});

describe('buildMobileRollbackAlertMessage', () => {
  it('有证据时包含摘要、不会自动恢复的声明与不可恢复原因', () => {
    const model = buildMobileRollbackChoiceModel({
      snapshots: [makeSnapshot({ treeHash: 'tree-1', parentTreeHash: null, filesChanged: 4 })],
    });
    const message = buildMobileRollbackAlertMessage(model);
    expect(message).toContain('1 个快照');
    expect(message).toContain('不会自动恢复这些文件变更');
    expect(message).toContain(MOBILE_NO_SNAPSHOT_REASON);
  });

  it('无证据时说明「无法确认」且不承诺恢复任何文件', () => {
    const model = buildMobileRollbackChoiceModel({
      snapshots: [],
      snapshotListFailed: true,
      diffLoadFailed: true,
    });
    const message = buildMobileRollbackAlertMessage(model);
    expect(message).toContain('无法确认');
    expect(message).toContain('继续操作不会恢复任何文件');
    expect(message).toContain(MOBILE_DETECTION_FAILED_REASON);
  });
});
