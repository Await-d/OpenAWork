import type {
  FileBackupRef,
  FileChangeGuaranteeLevel,
  FileChangeSourceKind,
  FileDiffContent,
} from '@openAwork/shared';
import { sqliteAll, sqliteRun } from './db.js';

interface SessionSnapshotRow {
  client_request_id: string;
  summary_json: string;
  files_json: string;
  created_at: string;
}

export type SessionSnapshotScopeKind = 'request' | 'backup' | 'scope' | 'unknown';

export interface SessionSnapshotSummary {
  additions: number;
  backupAfterRefs: FileBackupRef[];
  backupBeforeRefs: FileBackupRef[];
  deletions: number;
  files: number;
  guaranteeLevel?: FileChangeGuaranteeLevel;
  requestIds: string[];
  scopeKind: SessionSnapshotScopeKind;
  sourceKinds: FileChangeSourceKind[];
  toolCallIds: string[];
  toolNames: string[];
}

export interface SessionSnapshotRecord {
  clientRequestId?: string;
  createdAt: string;
  files: FileDiffContent[];
  scopeKind: SessionSnapshotScopeKind;
  snapshotRef: string;
  summary: SessionSnapshotSummary;
}

const REQUEST_SNAPSHOT_REF_PREFIX = 'req:';

export function createRequestSnapshotRef(clientRequestId: string): string {
  return `${REQUEST_SNAPSHOT_REF_PREFIX}${clientRequestId}`;
}

export function persistSessionSnapshot(input: {
  sessionId: string;
  userId: string;
  snapshotRef: string;
  fileDiffs: FileDiffContent[];
}): void {
  if (input.fileDiffs.length === 0) {
    return;
  }
  const summary = buildSnapshotSummary(input.snapshotRef, input.fileDiffs);
  sqliteRun(
    `INSERT OR REPLACE INTO session_snapshots
     (session_id, user_id, client_request_id, summary_json, files_json, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    [
      input.sessionId,
      input.userId,
      input.snapshotRef,
      JSON.stringify(summary),
      JSON.stringify(input.fileDiffs),
    ],
  );
}

export function listSessionSnapshots(input: {
  sessionId: string;
  userId: string;
}): SessionSnapshotRecord[] {
  return sqliteAll<SessionSnapshotRow>(
    `SELECT client_request_id, summary_json, files_json, created_at
     FROM session_snapshots
     WHERE session_id = ? AND user_id = ?
     ORDER BY created_at DESC, client_request_id DESC`,
    [input.sessionId, input.userId],
  ).flatMap((row) => {
    if (
      typeof row.client_request_id !== 'string' ||
      typeof row.summary_json !== 'string' ||
      typeof row.files_json !== 'string' ||
      typeof row.created_at !== 'string'
    ) {
      return [];
    }

    try {
      const files = parseFileDiffContents(JSON.parse(row.files_json) as unknown);
      if (files.length === 0) {
        return [];
      }
      const parsedSummary = parseSessionSnapshotSummary(
        JSON.parse(row.summary_json) as unknown,
        row.client_request_id,
        files,
      );
      const scope = parseSnapshotScope(row.client_request_id);
      return [
        {
          snapshotRef: row.client_request_id,
          clientRequestId: scope.clientRequestId,
          scopeKind: scope.scopeKind,
          summary: parsedSummary,
          files,
          createdAt: row.created_at,
        },
      ];
    } catch {
      return [];
    }
  });
}

export function listRequestSnapshots(input: {
  clientRequestId: string;
  sessionId: string;
  userId: string;
}): SessionSnapshotRecord[] {
  return listSessionSnapshots({ sessionId: input.sessionId, userId: input.userId }).filter(
    (snapshot) => snapshot.clientRequestId === input.clientRequestId,
  );
}

export function getSessionSnapshotByRef(input: {
  sessionId: string;
  snapshotRef: string;
  userId: string;
}): SessionSnapshotRecord | null {
  return (
    listSessionSnapshots({ sessionId: input.sessionId, userId: input.userId }).find(
      (snapshot) => snapshot.snapshotRef === input.snapshotRef,
    ) ?? null
  );
}

export function compareSessionSnapshots(input: {
  from: SessionSnapshotRecord;
  to: SessionSnapshotRecord;
}) {
  const fromByFile = new Map(input.from.files.map((file) => [file.file, file]));
  const toByFile = new Map(input.to.files.map((file) => [file.file, file]));
  const files = Array.from(new Set([...fromByFile.keys(), ...toByFile.keys()])).sort();

  return files.map((file) => {
    const fromFile = fromByFile.get(file);
    const toFile = toByFile.get(file);
    const before = fromFile?.after ?? '';
    const after = toFile?.after ?? '';
    return {
      file,
      before,
      after,
      fromExists: Boolean(fromFile),
      toExists: Boolean(toFile),
      changed: before !== after,
      fromStatus: fromFile?.status,
      toStatus: toFile?.status,
    };
  });
}

function buildSnapshotSummary(
  snapshotRef: string,
  fileDiffs: FileDiffContent[],
): SessionSnapshotSummary {
  return {
    files: fileDiffs.length,
    additions: fileDiffs.reduce((sum, item) => sum + item.additions, 0),
    deletions: fileDiffs.reduce((sum, item) => sum + item.deletions, 0),
    scopeKind: parseSnapshotScope(snapshotRef).scopeKind,
    requestIds: uniqueStrings(fileDiffs.map((item) => item.requestId)),
    toolCallIds: uniqueStrings(fileDiffs.map((item) => item.toolCallId)),
    toolNames: uniqueStrings(fileDiffs.map((item) => item.toolName)),
    sourceKinds: uniqueSourceKinds(fileDiffs.map((item) => item.sourceKind)),
    guaranteeLevel: deriveWeakestGuaranteeLevel(fileDiffs.map((item) => item.guaranteeLevel)),
    backupBeforeRefs: uniqueBackupRefs(fileDiffs.map((item) => item.backupBeforeRef)),
    backupAfterRefs: uniqueBackupRefs(fileDiffs.map((item) => item.backupAfterRef)),
  };
}

function parseSessionSnapshotSummary(
  value: unknown,
  snapshotRef: string,
  fileDiffs: FileDiffContent[],
): SessionSnapshotSummary {
  const fallback = buildSnapshotSummary(snapshotRef, fileDiffs);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fallback;
  }

  const record = value as Record<string, unknown>;
  return {
    files: typeof record['files'] === 'number' ? record['files'] : fallback.files,
    additions: typeof record['additions'] === 'number' ? record['additions'] : fallback.additions,
    deletions: typeof record['deletions'] === 'number' ? record['deletions'] : fallback.deletions,
    scopeKind: parseSnapshotScopeKind(record['scopeKind']) ?? fallback.scopeKind,
    requestIds: Array.isArray(record['requestIds'])
      ? uniqueStrings(record['requestIds'])
      : fallback.requestIds,
    toolCallIds: Array.isArray(record['toolCallIds'])
      ? uniqueStrings(record['toolCallIds'])
      : fallback.toolCallIds,
    toolNames: Array.isArray(record['toolNames'])
      ? uniqueStrings(record['toolNames'])
      : fallback.toolNames,
    sourceKinds: Array.isArray(record['sourceKinds'])
      ? uniqueSourceKinds(record['sourceKinds'])
      : fallback.sourceKinds,
    guaranteeLevel: isFileChangeGuaranteeLevel(record['guaranteeLevel'])
      ? record['guaranteeLevel']
      : fallback.guaranteeLevel,
    backupBeforeRefs: Array.isArray(record['backupBeforeRefs'])
      ? uniqueBackupRefs(record['backupBeforeRefs'].map((item) => parseFileBackupRef(item)))
      : fallback.backupBeforeRefs,
    backupAfterRefs: Array.isArray(record['backupAfterRefs'])
      ? uniqueBackupRefs(record['backupAfterRefs'].map((item) => parseFileBackupRef(item)))
      : fallback.backupAfterRefs,
  };
}

function parseSnapshotScope(snapshotRef: string): {
  clientRequestId?: string;
  scopeKind: SessionSnapshotScopeKind;
} {
  if (snapshotRef.startsWith(REQUEST_SNAPSHOT_REF_PREFIX)) {
    return {
      clientRequestId: snapshotRef.slice(REQUEST_SNAPSHOT_REF_PREFIX.length),
      scopeKind: 'request',
    };
  }
  if (snapshotRef.startsWith('backup:')) {
    return { scopeKind: 'backup' };
  }
  if (snapshotRef.startsWith('scope:')) {
    return { scopeKind: 'scope' };
  }
  return { clientRequestId: snapshotRef, scopeKind: 'request' };
}

function parseSnapshotScopeKind(value: unknown): SessionSnapshotScopeKind | undefined {
  return value === 'request' || value === 'backup' || value === 'scope' || value === 'unknown'
    ? value
    : undefined;
}

function parseFileDiffContents(value: unknown): FileDiffContent[] {
  return Array.isArray(value) ? value.flatMap((item) => parseFileDiffContent(item)) : [];
}

function parseFileDiffContent(value: unknown): FileDiffContent[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }

  const record = value as Record<string, unknown>;
  if (
    typeof record['file'] !== 'string' ||
    typeof record['before'] !== 'string' ||
    typeof record['after'] !== 'string' ||
    typeof record['additions'] !== 'number' ||
    typeof record['deletions'] !== 'number'
  ) {
    return [];
  }

  return [
    {
      file: record['file'],
      before: record['before'],
      after: record['after'],
      additions: record['additions'],
      deletions: record['deletions'],
      status:
        record['status'] === 'added' ||
        record['status'] === 'deleted' ||
        record['status'] === 'modified'
          ? record['status']
          : undefined,
      clientRequestId:
        typeof record['clientRequestId'] === 'string' ? record['clientRequestId'] : undefined,
      requestId: typeof record['requestId'] === 'string' ? record['requestId'] : undefined,
      toolName: typeof record['toolName'] === 'string' ? record['toolName'] : undefined,
      toolCallId: typeof record['toolCallId'] === 'string' ? record['toolCallId'] : undefined,
      sourceKind: isFileChangeSourceKind(record['sourceKind']) ? record['sourceKind'] : undefined,
      guaranteeLevel: isFileChangeGuaranteeLevel(record['guaranteeLevel'])
        ? record['guaranteeLevel']
        : undefined,
      backupBeforeRef: parseFileBackupRef(record['backupBeforeRef']),
      backupAfterRef: parseFileBackupRef(record['backupAfterRef']),
    },
  ];
}

function parseFileBackupRef(value: unknown): FileBackupRef | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (typeof record['backupId'] !== 'string') {
    return undefined;
  }
  if (
    record['kind'] !== 'before_write' &&
    record['kind'] !== 'after_write' &&
    record['kind'] !== 'snapshot_base'
  ) {
    return undefined;
  }

  return {
    backupId: record['backupId'],
    kind: record['kind'],
    storagePath: typeof record['storagePath'] === 'string' ? record['storagePath'] : undefined,
    artifactId: typeof record['artifactId'] === 'string' ? record['artifactId'] : undefined,
    contentHash: typeof record['contentHash'] === 'string' ? record['contentHash'] : undefined,
  };
}

function uniqueStrings(values: unknown[]): string[] {
  return Array.from(
    new Set(
      values.filter((value): value is string => typeof value === 'string' && value.length > 0),
    ),
  );
}

function uniqueSourceKinds(values: unknown[]): FileChangeSourceKind[] {
  return Array.from(new Set(values.filter(isFileChangeSourceKind)));
}

function uniqueBackupRefs(values: Array<FileBackupRef | undefined>): FileBackupRef[] {
  const entries = new Map<string, FileBackupRef>();
  values.forEach((value) => {
    if (!value) {
      return;
    }
    entries.set(`${value.kind}:${value.backupId}`, value);
  });
  return Array.from(entries.values());
}

function deriveWeakestGuaranteeLevel(
  values: Array<FileChangeGuaranteeLevel | undefined>,
): FileChangeGuaranteeLevel | undefined {
  const unique = Array.from(new Set(values.filter(isFileChangeGuaranteeLevel)));
  if (unique.includes('weak')) {
    return 'weak';
  }
  if (unique.includes('medium')) {
    return 'medium';
  }
  if (unique.includes('strong')) {
    return 'strong';
  }
  return undefined;
}

function isFileChangeSourceKind(value: unknown): value is FileChangeSourceKind {
  return (
    value === 'structured_tool_diff' ||
    value === 'session_snapshot' ||
    value === 'restore_replay' ||
    value === 'workspace_reconcile' ||
    value === 'manual_revert'
  );
}

function isFileChangeGuaranteeLevel(value: unknown): value is FileChangeGuaranteeLevel {
  return value === 'strong' || value === 'medium' || value === 'weak';
}
