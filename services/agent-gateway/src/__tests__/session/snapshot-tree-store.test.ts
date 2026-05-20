import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileDiffContent } from '@openAwork/shared';

// ─── In-memory db mock ────────────────────────────────────────────────

interface SnapshotTreeRow {
  id: number;
  session_id: string;
  user_id: string;
  client_request_id: string | null;
  tree_hash: string;
  parent_tree_hash: string | null;
  scope_kind: string;
  source_kind: string;
  guarantee_level: string;
  files_changed: number;
  additions: number;
  deletions: number;
  tool_name: string | null;
  tool_call_id: string | null;
  observability_json: string | null;
  created_at: string;
}

interface SnapshotFileEntryRow {
  snapshot_tree_id: number;
  file_path: string;
  status: 'added' | 'deleted' | 'modified';
  additions: number;
  deletions: number;
}

let nextId = 0;
let trees: SnapshotTreeRow[] = [];
let entries: SnapshotFileEntryRow[] = [];

function nowIso(): string {
  return new Date().toISOString().replace('T', ' ').replace(/\..+$/, '');
}

vi.mock('../../infra/db.js', () => ({
  sqliteRun: (sql: string, params: unknown[] = []) => {
    if (/INSERT\s+INTO\s+snapshot_trees/i.test(sql)) {
      const [
        sessionId,
        userId,
        clientRequestId,
        treeHash,
        parentTreeHash,
        scopeKind,
        sourceKind,
        guaranteeLevel,
        filesChanged,
        additions,
        deletions,
        toolName,
        toolCallId,
        observabilityJson,
      ] = params as Array<unknown>;

      const existing = trees.find(
        (row) => row.session_id === sessionId && row.tree_hash === treeHash,
      );
      if (existing) {
        existing.parent_tree_hash = (parentTreeHash as string | null) ?? existing.parent_tree_hash;
        existing.scope_kind = scopeKind as string;
        existing.source_kind = sourceKind as string;
        existing.guarantee_level = guaranteeLevel as string;
        existing.files_changed = filesChanged as number;
        existing.additions = additions as number;
        existing.deletions = deletions as number;
        existing.tool_name = (toolName as string | null) ?? existing.tool_name;
        existing.tool_call_id = (toolCallId as string | null) ?? existing.tool_call_id;
        existing.observability_json =
          (observabilityJson as string | null) ?? existing.observability_json;
        return;
      }

      nextId += 1;
      trees.push({
        id: nextId,
        session_id: sessionId as string,
        user_id: userId as string,
        client_request_id: clientRequestId as string | null,
        tree_hash: treeHash as string,
        parent_tree_hash: parentTreeHash as string | null,
        scope_kind: scopeKind as string,
        source_kind: sourceKind as string,
        guarantee_level: guaranteeLevel as string,
        files_changed: filesChanged as number,
        additions: additions as number,
        deletions: deletions as number,
        tool_name: toolName as string | null,
        tool_call_id: toolCallId as string | null,
        observability_json: observabilityJson as string | null,
        created_at: nowIso(),
      });
      return;
    }

    if (/DELETE\s+FROM\s+snapshot_file_entries\s+WHERE\s+snapshot_tree_id\s+=\s+\?/i.test(sql)) {
      const [snapshotTreeId] = params as [number];
      entries = entries.filter((row) => row.snapshot_tree_id !== snapshotTreeId);
      return;
    }

    if (/DELETE\s+FROM\s+snapshot_file_entries\s+WHERE\s+snapshot_tree_id\s+IN/i.test(sql)) {
      const [sessionId] = params as [string];
      const ids = new Set(trees.filter((row) => row.session_id === sessionId).map((row) => row.id));
      entries = entries.filter((row) => !ids.has(row.snapshot_tree_id));
      return;
    }

    if (/INSERT\s+INTO\s+snapshot_file_entries/i.test(sql)) {
      const [snapshotTreeId, filePath, status, additions, deletions] = params as [
        number,
        string,
        SnapshotFileEntryRow['status'],
        number,
        number,
      ];
      entries.push({
        snapshot_tree_id: snapshotTreeId,
        file_path: filePath,
        status,
        additions,
        deletions,
      });
      return;
    }

    if (/DELETE\s+FROM\s+snapshot_trees\s+WHERE\s+session_id\s+=\s+\?/i.test(sql)) {
      const [sessionId] = params as [string];
      trees = trees.filter((row) => row.session_id !== sessionId);
      return;
    }
  },
  sqliteGet: (sql: string, params: unknown[] = []) => {
    if (/FROM\s+snapshot_trees/i.test(sql)) {
      const [sessionId, treeHash] = params as [string, string];
      return trees.find((row) => row.session_id === sessionId && row.tree_hash === treeHash);
    }
    return undefined;
  },
  sqliteAll: (sql: string, params: unknown[] = []) => {
    if (
      /FROM\s+snapshot_trees\s+WHERE\s+session_id\s+=\s+\?\s+AND\s+user_id\s+=\s+\?\s+AND\s+client_request_id\s+=\s+\?/i.test(
        sql,
      )
    ) {
      const [sessionId, userId, clientRequestId] = params as [string, string, string];
      return trees
        .filter(
          (row) =>
            row.session_id === sessionId &&
            row.user_id === userId &&
            row.client_request_id === clientRequestId,
        )
        .sort((a, b) => a.id - b.id);
    }
    if (/FROM\s+snapshot_trees\s+WHERE\s+session_id\s+=\s+\?\s+AND\s+user_id\s+=\s+\?/i.test(sql)) {
      const [sessionId, userId] = params as [string, string];
      return trees
        .filter((row) => row.session_id === sessionId && row.user_id === userId)
        .sort((a, b) => b.id - a.id);
    }
    if (/FROM\s+snapshot_file_entries/i.test(sql)) {
      const [snapshotTreeId] = params as [number];
      return entries
        .filter((row) => row.snapshot_tree_id === snapshotTreeId)
        .sort((a, b) => a.file_path.localeCompare(b.file_path));
    }
    return [];
  },
  sqliteTransaction: (fn: () => void) => fn(),
}));

import {
  deleteSnapshotTreesForSession,
  getSnapshotTreeByHash,
  listSnapshotFileEntries,
  listSnapshotTreesForRequest,
  listSnapshotTreesForSession,
  persistSnapshotTree,
  traceSnapshotTreeChain,
} from '../../snapshot/snapshot-tree-store.js';

beforeEach(() => {
  nextId = 0;
  trees = [];
  entries = [];
});

afterEach(() => {
  vi.useRealTimers();
});

function makeDiff(file: string, additions = 5, deletions = 2): FileDiffContent {
  return {
    file,
    before: 'before',
    after: 'after',
    additions,
    deletions,
    status: 'modified',
  };
}

describe('snapshot-tree-store', () => {
  it('persistSnapshotTree writes tree row and file entries', () => {
    const record = persistSnapshotTree({
      sessionId: 'sess-1',
      userId: 'user-1',
      clientRequestId: 'req-1',
      treeHash: 'aaa',
      parentTreeHash: null,
      scopeKind: 'step',
      sourceKind: 'session_snapshot',
      guaranteeLevel: 'strong',
      fileDiffs: [makeDiff('a.ts'), makeDiff('b.ts')],
    });

    expect(record.id).toBeGreaterThan(0);
    expect(record.filesChanged).toBe(2);
    expect(record.additions).toBe(10);
    expect(record.deletions).toBe(4);
    expect(record.guaranteeLevel).toBe('strong');

    const persisted = getSnapshotTreeByHash({ sessionId: 'sess-1', treeHash: 'aaa' });
    expect(persisted?.treeHash).toBe('aaa');

    const fileEntries = listSnapshotFileEntries(record.id);
    expect(fileEntries).toHaveLength(2);
    expect(fileEntries.map((e) => e.filePath)).toEqual(['a.ts', 'b.ts']);
  });

  it('persistSnapshotTree is idempotent on (session_id, tree_hash)', () => {
    const first = persistSnapshotTree({
      sessionId: 'sess-1',
      userId: 'user-1',
      treeHash: 'bbb',
      scopeKind: 'step',
      fileDiffs: [makeDiff('a.ts')],
    });

    const second = persistSnapshotTree({
      sessionId: 'sess-1',
      userId: 'user-1',
      treeHash: 'bbb',
      scopeKind: 'turn',
      fileDiffs: [makeDiff('a.ts'), makeDiff('b.ts')],
    });

    expect(first.id).toBe(second.id);
    expect(second.scopeKind).toBe('turn');
    expect(second.filesChanged).toBe(2);

    const fileEntries = listSnapshotFileEntries(second.id);
    expect(fileEntries).toHaveLength(2);
  });

  it('listSnapshotTreesForSession returns rows in DESC order', () => {
    persistSnapshotTree({
      sessionId: 'sess-2',
      userId: 'user-1',
      treeHash: 'h1',
      scopeKind: 'step',
      fileDiffs: [],
    });
    persistSnapshotTree({
      sessionId: 'sess-2',
      userId: 'user-1',
      treeHash: 'h2',
      parentTreeHash: 'h1',
      scopeKind: 'step',
      fileDiffs: [],
    });

    const list = listSnapshotTreesForSession({ sessionId: 'sess-2', userId: 'user-1' });
    expect(list.map((t) => t.treeHash)).toEqual(['h2', 'h1']);
  });

  it('listSnapshotTreesForRequest returns rows in ASC order', () => {
    persistSnapshotTree({
      sessionId: 'sess-3',
      userId: 'user-1',
      clientRequestId: 'req-1',
      treeHash: 'r1',
      scopeKind: 'step',
      fileDiffs: [],
    });
    persistSnapshotTree({
      sessionId: 'sess-3',
      userId: 'user-1',
      clientRequestId: 'req-1',
      treeHash: 'r2',
      parentTreeHash: 'r1',
      scopeKind: 'step',
      fileDiffs: [],
    });

    const list = listSnapshotTreesForRequest({
      sessionId: 'sess-3',
      userId: 'user-1',
      clientRequestId: 'req-1',
    });
    expect(list.map((t) => t.treeHash)).toEqual(['r1', 'r2']);
  });

  it('traceSnapshotTreeChain follows parent links until baseline', () => {
    persistSnapshotTree({
      sessionId: 'sess-4',
      userId: 'user-1',
      treeHash: 't0',
      scopeKind: 'baseline',
      fileDiffs: [],
    });
    persistSnapshotTree({
      sessionId: 'sess-4',
      userId: 'user-1',
      treeHash: 't1',
      parentTreeHash: 't0',
      scopeKind: 'step',
      fileDiffs: [],
    });
    persistSnapshotTree({
      sessionId: 'sess-4',
      userId: 'user-1',
      treeHash: 't2',
      parentTreeHash: 't1',
      scopeKind: 'step',
      fileDiffs: [],
    });

    const chain = traceSnapshotTreeChain({ sessionId: 'sess-4', treeHash: 't2' });
    expect(chain.map((t) => t.treeHash)).toEqual(['t2', 't1', 't0']);
  });

  it('traceSnapshotTreeChain stops on cycle without infinite loop', () => {
    persistSnapshotTree({
      sessionId: 'sess-5',
      userId: 'user-1',
      treeHash: 'a',
      parentTreeHash: 'b',
      scopeKind: 'step',
      fileDiffs: [],
    });
    persistSnapshotTree({
      sessionId: 'sess-5',
      userId: 'user-1',
      treeHash: 'b',
      parentTreeHash: 'a',
      scopeKind: 'step',
      fileDiffs: [],
    });

    const chain = traceSnapshotTreeChain({ sessionId: 'sess-5', treeHash: 'a' });
    expect(chain.map((t) => t.treeHash)).toEqual(['a', 'b']);
  });

  it('deleteSnapshotTreesForSession removes rows and entries', () => {
    const record = persistSnapshotTree({
      sessionId: 'sess-6',
      userId: 'user-1',
      treeHash: 'x1',
      scopeKind: 'step',
      fileDiffs: [makeDiff('a.ts')],
    });

    deleteSnapshotTreesForSession('sess-6');

    expect(getSnapshotTreeByHash({ sessionId: 'sess-6', treeHash: 'x1' })).toBeNull();
    expect(listSnapshotFileEntries(record.id)).toHaveLength(0);
  });
});
