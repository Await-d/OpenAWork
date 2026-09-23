import { describe, expect, it } from 'vitest';
import type { SessionFileDiffEntry, SnapshotTreeEntry } from '@openAwork/web-client';
import {
  createAssistantTraceContent,
  type ChatMessage,
} from '../../conversation-runtime/messages/support.js';
import {
  buildAffectedChangeDetection,
  collectAffectedFileChangesFromTrace,
  collectAffectedRequestIds,
  deriveRestoreUnavailableReason,
  filterAffectedSnapshotsByTimestamp,
  formatAffectedChangeSummary,
  mergeAffectedFileChanges,
  sortSnapshotsByCreatedAt,
  summarizeAffectedChanges,
  toAffectedFileEntriesFromDiffs,
  toAffectedFileEntriesFromSnapshotFiles,
  toTimestamp,
  type AffectedFileEntry,
} from './affected-changes.js';

function makeUserMessage(id: string, createdAt: string): ChatMessage {
  return { id, role: 'user', content: id, createdAt };
}

function makeAssistantMessage(input: {
  id: string;
  createdAt: string;
  requestId: string;
  file?: string;
  additions?: number;
  deletions?: number;
}): ChatMessage {
  return {
    id: input.id,
    role: 'assistant',
    createdAt: input.createdAt,
    content: createAssistantTraceContent({
      text: 'done',
      toolCalls: [
        {
          toolCallId: `tool-${input.requestId}`,
          toolName: 'write_file',
          input: {},
          clientRequestId: input.requestId,
          status: 'completed',
        },
      ],
      modifiedFilesSummary: {
        type: 'modified_files_summary',
        title: '变更',
        summary: '变更摘要',
        files: [
          {
            file: input.file ?? 'changed.ts',
            before: 'before',
            after: 'after',
            additions: input.additions ?? 1,
            deletions: input.deletions ?? 0,
            clientRequestId: input.requestId,
          },
        ],
      },
    }),
  };
}

function makeSnapshot(overrides: Partial<SnapshotTreeEntry> = {}): SnapshotTreeEntry {
  return {
    treeHash: 'tree-default',
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

describe('collectAffectedRequestIds', () => {
  it('收集源消息之后所有 assistant 回合的请求键并去重', () => {
    const messages = [
      makeUserMessage('u-1', '2026-07-15T10:00:00.000Z'),
      makeAssistantMessage({
        id: 'a-1',
        createdAt: '2026-07-15T10:01:00.000Z',
        requestId: 'req-1',
      }),
      makeUserMessage('u-2', '2026-07-15T10:02:00.000Z'),
      makeAssistantMessage({
        id: 'a-2',
        createdAt: '2026-07-15T10:03:00.000Z',
        requestId: 'req-2',
      }),
      makeAssistantMessage({
        id: 'a-3',
        createdAt: '2026-07-15T10:04:00.000Z',
        requestId: 'req-1',
      }),
    ];

    expect(collectAffectedRequestIds({ messages, sourceMessageId: 'u-1' })).toEqual([
      'req-1',
      'req-2',
    ]);
    expect(collectAffectedRequestIds({ messages, sourceMessageId: 'u-2' })).toEqual([
      'req-2',
      'req-1',
    ]);
  });

  it('源消息缺失或未提供时返回空集合', () => {
    const messages = [
      makeUserMessage('u-1', '2026-07-15T10:00:00.000Z'),
      makeAssistantMessage({
        id: 'a-1',
        createdAt: '2026-07-15T10:01:00.000Z',
        requestId: 'req-1',
      }),
    ];
    expect(collectAffectedRequestIds({ messages, sourceMessageId: 'missing' })).toEqual([]);
    expect(collectAffectedRequestIds({ messages })).toEqual([]);
  });

  it('源消息为 assistant 时包含它自己的回合键（inclusive 截断语义）', () => {
    const messages = [
      makeUserMessage('u-1', '2026-07-15T10:00:00.000Z'),
      makeAssistantMessage({
        id: 'a-1',
        createdAt: '2026-07-15T10:01:00.000Z',
        requestId: 'req-1',
      }),
      makeUserMessage('u-2', '2026-07-15T10:02:00.000Z'),
      makeAssistantMessage({
        id: 'a-2',
        createdAt: '2026-07-15T10:03:00.000Z',
        requestId: 'req-2',
      }),
    ];
    expect(collectAffectedRequestIds({ messages, sourceMessageId: 'a-1' })).toEqual([
      'req-1',
      'req-2',
    ]);
  });
});

describe('collectAffectedFileChangesFromTrace', () => {
  it('从受影响回合的 trace 变更摘要提取文件条目', () => {
    const messages = [
      makeUserMessage('u-1', '2026-07-15T10:00:00.000Z'),
      makeAssistantMessage({
        id: 'a-1',
        createdAt: '2026-07-15T10:01:00.000Z',
        requestId: 'req-1',
        file: 'src/a.ts',
        additions: 3,
        deletions: 2,
      }),
      makeUserMessage('u-2', '2026-07-15T10:02:00.000Z'),
      makeAssistantMessage({
        id: 'a-2',
        createdAt: '2026-07-15T10:03:00.000Z',
        requestId: 'req-2',
        file: 'src/b.ts',
      }),
    ];

    const entries = collectAffectedFileChangesFromTrace({ messages, sourceMessageId: 'u-2' });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      file: 'src/b.ts',
      additions: 1,
      deletions: 0,
      requestId: 'req-2',
    });
  });

  it('源消息之后没有 assistant 消息时返回空数组', () => {
    const messages = [makeUserMessage('u-1', '2026-07-15T10:00:00.000Z')];
    expect(collectAffectedFileChangesFromTrace({ messages, sourceMessageId: 'u-1' })).toEqual([]);
  });
});

describe('mergeAffectedFileChanges', () => {
  it('按路径去重且优先级为 diff > trace > snapshot，结果按路径排序', () => {
    const snapshotEntry: AffectedFileEntry = {
      file: 'b.ts',
      additions: 1,
      deletions: 0,
      status: 'modified',
    };
    const traceEntry: AffectedFileEntry = {
      file: 'b.ts',
      additions: 9,
      deletions: 9,
      requestId: 'req-trace',
    };
    const diffEntry: AffectedFileEntry = {
      file: 'b.ts',
      additions: 2,
      deletions: 1,
      requestId: 'req-diff',
      status: 'added',
    };

    const merged = mergeAffectedFileChanges({
      snapshotFiles: [snapshotEntry],
      traceFiles: [traceEntry],
      diffFiles: [diffEntry],
    });

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ requestId: 'req-diff', additions: 2, status: 'added' });
  });

  it('不同路径全部保留', () => {
    const merged = mergeAffectedFileChanges({
      traceFiles: [{ file: 'a.ts', additions: 1, deletions: 0 }],
      diffFiles: [{ file: 'c.ts', additions: 1, deletions: 1 }],
    });
    expect(merged.map((entry) => entry.file)).toEqual(['a.ts', 'c.ts']);
  });
});

describe('summarizeAffectedChanges / formatAffectedChangeSummary', () => {
  it('汇总文件数与增删行数，请求键去重保序', () => {
    const summary = summarizeAffectedChanges([
      { file: 'a.ts', additions: 2, deletions: 1, requestId: 'req-1' },
      { file: 'b.ts', additions: 3, deletions: 4, requestId: 'req-1' },
      { file: 'c.ts', additions: 1, deletions: 0, requestId: 'req-2' },
    ]);
    expect(summary).toEqual({
      fileCount: 3,
      totalAdditions: 6,
      totalDeletions: 5,
      requestIds: ['req-1', 'req-2'],
    });
    expect(formatAffectedChangeSummary(summary)).toBe('3 个文件 · +6 / -5');
  });
});

describe('buildAffectedChangeDetection', () => {
  it('文件或快照任一非空即判定检测到变更', () => {
    expect(
      buildAffectedChangeDetection({
        files: [{ file: 'a.ts', additions: 1, deletions: 0 }],
        snapshots: [],
      }).changesDetected,
    ).toBe(true);
    expect(
      buildAffectedChangeDetection({ files: [], snapshots: [makeSnapshot()] }).changesDetected,
    ).toBe(true);
    const empty = buildAffectedChangeDetection({ files: [], snapshots: [] });
    expect(empty.changesDetected).toBe(false);
    expect(empty.detectionIncomplete).toBe(false);
  });

  it('保留 detectionIncomplete 标记', () => {
    expect(
      buildAffectedChangeDetection({ files: [], snapshots: [], detectionIncomplete: true })
        .detectionIncomplete,
    ).toBe(true);
  });
});

describe('deriveRestoreUnavailableReason', () => {
  it('按优先级返回原因，可恢复时为 null', () => {
    expect(
      deriveRestoreUnavailableReason({
        detailLoadFailed: true,
        parentTreeHash: null,
        filePathCount: 0,
      }),
    ).toContain('读取受影响文件列表失败');
    expect(
      deriveRestoreUnavailableReason({
        detailLoadFailed: false,
        parentTreeHash: null,
        filePathCount: 2,
      }),
    ).toContain('没有可用快照');
    expect(
      deriveRestoreUnavailableReason({
        detailLoadFailed: false,
        parentTreeHash: 'tree-parent',
        filePathCount: 0,
      }),
    ).toContain('没有可恢复的文件记录');
    expect(
      deriveRestoreUnavailableReason({
        detailLoadFailed: false,
        parentTreeHash: 'tree-parent',
        filePathCount: 1,
      }),
    ).toBeNull();
  });
});

describe('filterAffectedSnapshotsByTimestamp / sortSnapshotsByCreatedAt', () => {
  it('只保留源消息时间之后（含）的快照', () => {
    const snapshots = [
      makeSnapshot({ treeHash: 'before', createdAt: '2026-07-15T09:59:00.000Z' }),
      makeSnapshot({ treeHash: 'after', createdAt: '2026-07-15T10:01:00.000Z' }),
      makeSnapshot({ treeHash: 'unknown', createdAt: 'not-a-date' }),
    ];
    const messages = [makeUserMessage('u-1', '2026-07-15T10:00:00.000Z')];
    const filtered = filterAffectedSnapshotsByTimestamp({
      snapshots,
      messages,
      sourceMessageId: 'u-1',
    });
    expect(filtered.map((snapshot) => snapshot.treeHash)).toEqual(['after', 'unknown']);
  });

  it('缺少源消息时保留全部快照', () => {
    const snapshots = [makeSnapshot({ treeHash: 'a' })];
    expect(
      filterAffectedSnapshotsByTimestamp({ snapshots, messages: [] }).map((s) => s.treeHash),
    ).toEqual(['a']);
  });

  it('按时间升序排序，时间缺失时按请求顺序回退', () => {
    const snapshots = [
      makeSnapshot({ treeHash: 'late', createdAt: '2026-07-15T10:05:00.000Z' }),
      makeSnapshot({ treeHash: 'early', createdAt: '2026-07-15T10:01:00.000Z' }),
    ];
    const sorted = sortSnapshotsByCreatedAt({
      snapshots,
      originalOrder: snapshots,
      inputOrder: 'desc',
    });
    expect(sorted.map((snapshot) => snapshot.treeHash)).toEqual(['early', 'late']);
  });

  it('SQLite datetime(now) 形态必须按 UTC 解析（不得按本地时区偏移）', () => {
    expect(toTimestamp('2026-07-15 10:05:00')).toBe(Date.UTC(2026, 6, 15, 10, 5, 0));
    expect(toTimestamp('2026-07-15 10:05:00.250')).toBe(Date.UTC(2026, 6, 15, 10, 5, 0, 250));
    // 带时区后缀的 ISO 串保持原语义
    expect(toTimestamp('2026-07-15T10:05:00.000Z')).toBe(Date.UTC(2026, 6, 15, 10, 5, 0));
    expect(toTimestamp(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(toTimestamp('not-a-date')).toBeNull();
  });

  it('同一 request 内同秒并列时，request-scoped（ASC）取更早者在前', () => {
    const sameSecond = '2026-07-15 10:05:00';
    const stepOne = makeSnapshot({
      treeHash: 'step-1',
      parentTreeHash: 'tree-parent',
      clientRequestId: 'req-1',
      createdAt: sameSecond,
    });
    const stepTwo = makeSnapshot({
      treeHash: 'step-2',
      parentTreeHash: 'step-1',
      clientRequestId: 'req-1',
      createdAt: sameSecond,
    });
    // 网关 request-scoped 列表 = created_at ASC, id ASC
    const sorted = sortSnapshotsByCreatedAt({
      snapshots: [stepOne, stepTwo],
      originalOrder: [stepOne, stepTwo],
      requestOrderById: new Map([['req-1', 0]]),
      inputOrder: 'asc',
    });
    expect(sorted.map((snapshot) => snapshot.treeHash)).toEqual(['step-1', 'step-2']);
  });

  it('同一 request 内同秒并列时，session-scoped（DESC）同样取更早者在前', () => {
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
    // 网关 session-scoped 列表 = created_at DESC, id DESC
    const sorted = sortSnapshotsByCreatedAt({
      snapshots: [stepTwo, stepOne],
      originalOrder: [stepTwo, stepOne],
      inputOrder: 'desc',
    });
    expect(sorted.map((snapshot) => snapshot.treeHash)).toEqual(['step-1', 'step-2']);
  });
});

describe('toAffectedFileEntriesFromDiffs / toAffectedFileEntriesFromSnapshotFiles', () => {
  it('diff 条目优先取 requestId，缺失时回退 clientRequestId', () => {
    const diffs = [
      {
        file: 'src/a.ts',
        additions: 2,
        deletions: 1,
        status: 'modified',
        requestId: 'req-a',
      },
      {
        file: 'src/b.ts',
        additions: 1,
        deletions: 0,
        clientRequestId: 'req-b',
      },
    ] as SessionFileDiffEntry[];
    const entries = toAffectedFileEntriesFromDiffs(diffs);
    expect(entries).toEqual([
      { file: 'src/a.ts', status: 'modified', additions: 2, deletions: 1, requestId: 'req-a' },
      { file: 'src/b.ts', additions: 1, deletions: 0, requestId: 'req-b' },
    ]);
  });

  it('快照文件条目把 filePath 映射为 file', () => {
    const entries = toAffectedFileEntriesFromSnapshotFiles([
      { filePath: 'src/c.ts', status: 'added', additions: 4, deletions: 0 },
    ]);
    expect(entries).toEqual([{ file: 'src/c.ts', status: 'added', additions: 4, deletions: 0 }]);
  });
});
