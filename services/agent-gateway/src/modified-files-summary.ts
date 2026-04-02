import type {
  FileBackupRef,
  FileChangeGuaranteeLevel,
  FileChangeSourceKind,
  FileDiffContent,
  ModifiedFilesSummaryContent,
  ToolCallObservabilityAnnotation,
} from '@openAwork/shared';

export function traceFileDiffs(input: {
  clientRequestId: string;
  diffs: FileDiffContent[];
  guaranteeLevel?: FileChangeGuaranteeLevel;
  observability?: ToolCallObservabilityAnnotation;
  requestId: string;
  sourceKind?: FileChangeSourceKind;
  toolCallId: string;
  toolName: string;
}): FileDiffContent[] {
  return input.diffs.map((diff) => ({
    ...diff,
    clientRequestId: diff.clientRequestId ?? input.clientRequestId,
    requestId: diff.requestId ?? input.requestId,
    toolName: diff.toolName ?? input.toolName,
    toolCallId: diff.toolCallId ?? input.toolCallId,
    sourceKind: diff.sourceKind ?? input.sourceKind ?? 'structured_tool_diff',
    guaranteeLevel: diff.guaranteeLevel ?? input.guaranteeLevel ?? 'medium',
    observability: diff.observability ?? input.observability,
  }));
}

export function collectFileDiffsFromToolOutput(output: unknown): FileDiffContent[] {
  if (!output || typeof output !== 'object') {
    return [];
  }

  const record = output as Record<string, unknown>;
  const sources = [
    record['filediff'],
    ...(Array.isArray(record['diffs']) ? record['diffs'] : []),
    ...(Array.isArray(record['files']) ? record['files'] : []),
  ];

  return sources.flatMap((item) => toFileDiff(item));
}

export function mergeFileDiffs(
  current: Map<string, FileDiffContent>,
  nextDiffs: FileDiffContent[],
): void {
  nextDiffs.forEach((diff) => {
    current.set(diff.file, diff);
  });
}

export function buildModifiedFilesSummaryContent(
  fileDiffs: Map<string, FileDiffContent>,
): ModifiedFilesSummaryContent | null {
  if (fileDiffs.size === 0) {
    return null;
  }

  const files = Array.from(fileDiffs.values());
  const sample = files
    .slice(0, 3)
    .map((file) => `${trimFilePath(file.file)} · +${file.additions} / -${file.deletions}`);

  return {
    type: 'modified_files_summary',
    title: `本轮修改了 ${files.length} 个文件`,
    summary: sample.join(' · '),
    files,
  };
}

function toFileDiff(value: unknown): FileDiffContent[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }

  const record = value as Record<string, unknown>;
  const file =
    readString(record['file']) ??
    readString(record['relativePath']) ??
    readString(record['movePath']) ??
    readString(record['filePath']) ??
    readString(record['path']);
  const before = typeof record['before'] === 'string' ? record['before'] : '';
  const after = typeof record['after'] === 'string' ? record['after'] : '';
  if (!file || (before.length === 0 && after.length === 0)) {
    return [];
  }

  const additions =
    typeof record['additions'] === 'number' ? record['additions'] : countAddedLines(before, after);
  const deletions =
    typeof record['deletions'] === 'number'
      ? record['deletions']
      : countRemovedLines(before, after);
  const action = readString(record['action']);
  const status =
    record['status'] === 'added' ||
    record['status'] === 'deleted' ||
    record['status'] === 'modified'
      ? record['status']
      : action === 'add'
        ? 'added'
        : action === 'delete'
          ? 'deleted'
          : action === 'update' || action === 'move'
            ? 'modified'
            : undefined;

  return [
    {
      file,
      before,
      after,
      additions,
      deletions,
      status,
      clientRequestId: readString(record['clientRequestId']),
      requestId: readString(record['requestId']),
      toolName: readString(record['toolName']),
      toolCallId: readString(record['toolCallId']),
      sourceKind: isFileChangeSourceKind(record['sourceKind']) ? record['sourceKind'] : undefined,
      guaranteeLevel: isFileChangeGuaranteeLevel(record['guaranteeLevel'])
        ? record['guaranteeLevel']
        : undefined,
      backupBeforeRef: parseFileBackupRef(record['backupBeforeRef']),
      backupAfterRef: parseFileBackupRef(record['backupAfterRef']),
      observability: parseToolCallObservability(record['observability']),
    },
  ];
}

function parseToolCallObservability(value: unknown): ToolCallObservabilityAnnotation | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const parsed: ToolCallObservabilityAnnotation = {};
  if (typeof record['presentedToolName'] === 'string') {
    parsed.presentedToolName = record['presentedToolName'];
  }
  if (typeof record['canonicalToolName'] === 'string') {
    parsed.canonicalToolName = record['canonicalToolName'];
  }
  if (
    record['toolSurfaceProfile'] === 'openawork' ||
    record['toolSurfaceProfile'] === 'claude_code_simple' ||
    record['toolSurfaceProfile'] === 'claude_code_default'
  ) {
    parsed.toolSurfaceProfile = record['toolSurfaceProfile'];
  }
  if (typeof record['adapterVersion'] === 'string') {
    parsed.adapterVersion = record['adapterVersion'];
  }

  return Object.keys(parsed).length > 0 ? parsed : undefined;
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
    storagePath: readString(record['storagePath']),
    artifactId: readString(record['artifactId']),
    contentHash: readString(record['contentHash']),
  };
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

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function trimFilePath(value: string): string {
  const parts = value.split('/').filter(Boolean);
  return parts.slice(-2).join('/') || value;
}

function countAddedLines(before: string, after: string): number {
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  let additions = 0;
  let beforeIndex = 0;
  let afterIndex = 0;
  while (beforeIndex < beforeLines.length || afterIndex < afterLines.length) {
    const beforeLine = beforeLines[beforeIndex];
    const afterLine = afterLines[afterIndex];
    if (beforeLine === afterLine && beforeLine !== undefined) {
      beforeIndex += 1;
      afterIndex += 1;
      continue;
    }
    if (afterLine !== undefined) {
      additions += 1;
      afterIndex += 1;
    }
    if (beforeLine !== undefined) {
      beforeIndex += 1;
    }
  }
  return additions;
}

function countRemovedLines(before: string, after: string): number {
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  let deletions = 0;
  let beforeIndex = 0;
  let afterIndex = 0;
  while (beforeIndex < beforeLines.length || afterIndex < afterLines.length) {
    const beforeLine = beforeLines[beforeIndex];
    const afterLine = afterLines[afterIndex];
    if (beforeLine === afterLine && beforeLine !== undefined) {
      beforeIndex += 1;
      afterIndex += 1;
      continue;
    }
    if (beforeLine !== undefined) {
      deletions += 1;
      beforeIndex += 1;
    }
    if (afterLine !== undefined) {
      afterIndex += 1;
    }
  }
  return deletions;
}
