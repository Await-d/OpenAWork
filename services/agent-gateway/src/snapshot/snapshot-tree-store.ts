/**
 * Snapshot Tree Store
 * ───────────────────
 *
 * SQLite 表 `snapshot_trees` 的访问层，记录每个 step / turn 对应的
 * shadow git tree hash 以及上下游链路：
 *
 *   tree_hash + parent_tree_hash 形成因果链，可以从任意 tree 回溯到 baseline。
 *
 * 与现有的 `session_snapshots`（按 clientRequestId 索引、files_json 大字段）
 * 共存：双写阶段 snapshot_trees 提供精细化 step-level 数据，
 * session_snapshots 仍由 routes/sessions.ts 的 restore 流程使用。
 */

import type {
  FileChangeGuaranteeLevel,
  FileChangeSourceKind,
  FileDiffContent,
  ToolCallObservabilityAnnotation,
} from '@openAwork/shared';

import { sqliteAll, sqliteGet, sqliteRun } from '../infra/db.js';

import type { TreeHash } from './shadow-git-store.js';

// ─── 类型 ──────────────────────────────────────────────────────────────

export type SnapshotTreeScopeKind = 'baseline' | 'step' | 'turn' | 'restore' | 'manual';

export interface SnapshotTreeRecord {
  id: number;
  sessionId: string;
  userId: string;
  clientRequestId: string | null;
  treeHash: TreeHash;
  parentTreeHash: TreeHash | null;
  scopeKind: SnapshotTreeScopeKind;
  sourceKind: FileChangeSourceKind;
  guaranteeLevel: FileChangeGuaranteeLevel;
  filesChanged: number;
  additions: number;
  deletions: number;
  toolName: string | null;
  toolCallId: string | null;
  observability: ToolCallObservabilityAnnotation | null;
  createdAt: string;
}

export interface SnapshotTreeFileEntry {
  filePath: string;
  status: 'added' | 'deleted' | 'modified';
  additions: number;
  deletions: number;
}

export interface PersistSnapshotTreeInput {
  sessionId: string;
  userId: string;
  clientRequestId?: string | null;
  treeHash: TreeHash;
  parentTreeHash?: TreeHash | null;
  scopeKind: SnapshotTreeScopeKind;
  sourceKind?: FileChangeSourceKind;
  guaranteeLevel?: FileChangeGuaranteeLevel;
  toolName?: string | null;
  toolCallId?: string | null;
  observability?: ToolCallObservabilityAnnotation | null;
  fileDiffs: FileDiffContent[];
}

// ─── 持久化 ────────────────────────────────────────────────────────────

/**
 * 写入一个新的 snapshot tree 记录及其涉及的文件条目。
 *
 * 幂等：以 (session_id, tree_hash) 为唯一键，重复插入时合并文件条目。
 */
export function persistSnapshotTree(input: PersistSnapshotTreeInput): SnapshotTreeRecord {
  const sourceKind: FileChangeSourceKind = input.sourceKind ?? 'session_snapshot';
  const guaranteeLevel: FileChangeGuaranteeLevel = input.guaranteeLevel ?? 'strong';

  const additions = input.fileDiffs.reduce((sum, diff) => sum + diff.additions, 0);
  const deletions = input.fileDiffs.reduce((sum, diff) => sum + diff.deletions, 0);

  // 1. 幂等插入主表
  sqliteRun(
    `INSERT INTO snapshot_trees
       (session_id, user_id, client_request_id, tree_hash, parent_tree_hash,
        scope_kind, source_kind, guarantee_level,
        files_changed, additions, deletions, tool_name, tool_call_id,
        observability_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(session_id, tree_hash) DO UPDATE SET
       parent_tree_hash = COALESCE(excluded.parent_tree_hash, snapshot_trees.parent_tree_hash),
       scope_kind = excluded.scope_kind,
       source_kind = excluded.source_kind,
       guarantee_level = excluded.guarantee_level,
       files_changed = excluded.files_changed,
       additions = excluded.additions,
       deletions = excluded.deletions,
       tool_name = COALESCE(excluded.tool_name, snapshot_trees.tool_name),
       tool_call_id = COALESCE(excluded.tool_call_id, snapshot_trees.tool_call_id),
       observability_json = COALESCE(excluded.observability_json, snapshot_trees.observability_json)
    `,
    [
      input.sessionId,
      input.userId,
      input.clientRequestId ?? null,
      input.treeHash,
      input.parentTreeHash ?? null,
      input.scopeKind,
      sourceKind,
      guaranteeLevel,
      input.fileDiffs.length,
      additions,
      deletions,
      input.toolName ?? null,
      input.toolCallId ?? null,
      input.observability ? JSON.stringify(input.observability) : null,
    ],
  );

  const created = getSnapshotTreeByHash({
    sessionId: input.sessionId,
    treeHash: input.treeHash,
  });
  if (!created) {
    throw new Error('Failed to persist snapshot_tree: row not found after insert');
  }

  // 2. 写入文件条目（先清空已有，再插入新的）
  sqliteRun('DELETE FROM snapshot_file_entries WHERE snapshot_tree_id = ?', [created.id]);
  for (const diff of input.fileDiffs) {
    sqliteRun(
      `INSERT INTO snapshot_file_entries
         (snapshot_tree_id, file_path, status, additions, deletions)
       VALUES (?, ?, ?, ?, ?)`,
      [created.id, diff.file, diff.status ?? 'modified', diff.additions, diff.deletions],
    );
  }

  return created;
}

// ─── 查询 ──────────────────────────────────────────────────────────────

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

export function getSnapshotTreeByHash(input: {
  sessionId: string;
  treeHash: TreeHash;
}): SnapshotTreeRecord | null {
  const row = sqliteGet<SnapshotTreeRow>(
    `SELECT * FROM snapshot_trees
     WHERE session_id = ? AND tree_hash = ?
     LIMIT 1`,
    [input.sessionId, input.treeHash],
  );
  return row ? mapRow(row) : null;
}

export function listSnapshotTreesForSession(input: {
  sessionId: string;
  userId: string;
  limit?: number;
}): SnapshotTreeRecord[] {
  const rows = sqliteAll<SnapshotTreeRow>(
    `SELECT * FROM snapshot_trees
     WHERE session_id = ? AND user_id = ?
     ORDER BY created_at DESC, id DESC
     ${input.limit ? `LIMIT ${Math.max(1, Math.floor(input.limit))}` : ''}
    `,
    [input.sessionId, input.userId],
  );
  return rows.map(mapRow);
}

/**
 * 返回 session 中最近的一个 snapshot tree（按 created_at DESC, id DESC）。
 * 用于在 stream-runtime 中确定新 capture 的 parent_tree_hash。
 */
export function getLatestSnapshotTreeForSession(input: {
  sessionId: string;
  userId: string;
}): SnapshotTreeRecord | null {
  const row = sqliteGet<SnapshotTreeRow>(
    `SELECT * FROM snapshot_trees
     WHERE session_id = ? AND user_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [input.sessionId, input.userId],
  );
  return row ? mapRow(row) : null;
}

export function listSnapshotTreesForRequest(input: {
  sessionId: string;
  userId: string;
  clientRequestId: string;
}): SnapshotTreeRecord[] {
  const rows = sqliteAll<SnapshotTreeRow>(
    `SELECT * FROM snapshot_trees
     WHERE session_id = ? AND user_id = ? AND client_request_id = ?
     ORDER BY created_at ASC, id ASC`,
    [input.sessionId, input.userId, input.clientRequestId],
  );
  return rows.map(mapRow);
}

export function listSnapshotFileEntries(snapshotTreeId: number): SnapshotTreeFileEntry[] {
  const rows = sqliteAll<SnapshotFileEntryRow>(
    `SELECT snapshot_tree_id, file_path, status, additions, deletions
     FROM snapshot_file_entries
     WHERE snapshot_tree_id = ?
     ORDER BY file_path ASC`,
    [snapshotTreeId],
  );
  return rows.map((row) => ({
    filePath: row.file_path,
    status: row.status,
    additions: row.additions,
    deletions: row.deletions,
  }));
}

/**
 * 返回指定时间点之前（含）最近的一个 snapshot tree。
 * 用于 "恢复到某个时间点" 功能。
 */
export function getSnapshotTreeAtOrBefore(input: {
  sessionId: string;
  userId: string;
  /** ISO 8601 datetime string (UTC) */
  timestamp: string;
}): SnapshotTreeRecord | null {
  const row = sqliteGet<SnapshotTreeRow>(
    `SELECT * FROM snapshot_trees
     WHERE session_id = ? AND user_id = ? AND created_at <= ?
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [input.sessionId, input.userId, input.timestamp],
  );
  return row ? mapRow(row) : null;
}

/**
 * 从指定 tree 回溯到 baseline，返回链中所有 tree（按从最新到最旧）。
 */
export function traceSnapshotTreeChain(input: {
  sessionId: string;
  treeHash: TreeHash;
  /** 防止循环引用导致死循环（默认 1000） */
  maxDepth?: number;
}): SnapshotTreeRecord[] {
  const max = input.maxDepth ?? 1000;
  const visited = new Set<string>();
  const chain: SnapshotTreeRecord[] = [];

  let cursor: TreeHash | null = input.treeHash;
  while (cursor && chain.length < max && !visited.has(cursor)) {
    visited.add(cursor);
    const row = getSnapshotTreeByHash({ sessionId: input.sessionId, treeHash: cursor });
    if (!row) break;
    chain.push(row);
    cursor = row.parentTreeHash;
  }

  return chain;
}

// ─── 删除（用于 session 删除联动） ─────────────────────────────────────

export function deleteSnapshotTreesForSession(sessionId: string): void {
  sqliteRun(
    `DELETE FROM snapshot_file_entries
     WHERE snapshot_tree_id IN (SELECT id FROM snapshot_trees WHERE session_id = ?)`,
    [sessionId],
  );
  sqliteRun('DELETE FROM snapshot_trees WHERE session_id = ?', [sessionId]);
}

// ─── 内部 ──────────────────────────────────────────────────────────────

function mapRow(row: SnapshotTreeRow): SnapshotTreeRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    userId: row.user_id,
    clientRequestId: row.client_request_id,
    treeHash: row.tree_hash,
    parentTreeHash: row.parent_tree_hash,
    scopeKind: parseScopeKind(row.scope_kind),
    sourceKind: parseSourceKind(row.source_kind),
    guaranteeLevel: parseGuaranteeLevel(row.guarantee_level),
    filesChanged: row.files_changed,
    additions: row.additions,
    deletions: row.deletions,
    toolName: row.tool_name,
    toolCallId: row.tool_call_id,
    observability: parseObservability(row.observability_json),
    createdAt: row.created_at,
  };
}

function parseScopeKind(value: string): SnapshotTreeScopeKind {
  return value === 'baseline' ||
    value === 'step' ||
    value === 'turn' ||
    value === 'restore' ||
    value === 'manual'
    ? value
    : 'step';
}

function parseSourceKind(value: string): FileChangeSourceKind {
  return value === 'structured_tool_diff' ||
    value === 'session_snapshot' ||
    value === 'restore_replay' ||
    value === 'workspace_reconcile' ||
    value === 'manual_revert'
    ? value
    : 'session_snapshot';
}

function parseGuaranteeLevel(value: string): FileChangeGuaranteeLevel {
  return value === 'strong' || value === 'medium' || value === 'weak' ? value : 'medium';
}

function parseObservability(value: string | null): ToolCallObservabilityAnnotation | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    /* noop */
  }
  return null;
}
