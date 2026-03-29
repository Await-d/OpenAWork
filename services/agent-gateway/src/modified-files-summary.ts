import type { FileDiffContent, ModifiedFilesSummaryContent } from '@openAwork/shared';

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
    },
  ];
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
