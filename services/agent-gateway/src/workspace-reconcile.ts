import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FileDiffContent } from '@openAwork/shared';
import type { WorkspaceReviewChange } from './workspace-review.js';
import { listWorkspaceReviewChanges } from './workspace-review.js';

interface WorkspaceReconcileSnapshotEntry {
  change: WorkspaceReviewChange;
  currentContent: string;
  headContent: string;
}

export type WorkspaceReconcileSnapshot = ReadonlyMap<string, WorkspaceReconcileSnapshotEntry>;

export async function captureWorkspaceReconcileSnapshot(
  workspaceRoot: string,
): Promise<WorkspaceReconcileSnapshot> {
  const changes = await listWorkspaceReviewChanges(workspaceRoot);
  const entries = await Promise.all(
    changes.map(async (change) => {
      const headPath = change.oldPath ?? change.path;
      const headContent =
        change.status === 'added' ? '' : await readGitHeadContent(workspaceRoot, headPath);
      const currentContent =
        change.status === 'deleted'
          ? ''
          : await readWorkspaceFileContent(workspaceRoot, change.path);
      return [
        change.path,
        {
          change,
          currentContent,
          headContent,
        } satisfies WorkspaceReconcileSnapshotEntry,
      ] as const;
    }),
  );
  return new Map(entries);
}

export async function collectWorkspaceReconcileDiffs(input: {
  after: WorkspaceReconcileSnapshot;
  before: WorkspaceReconcileSnapshot;
  workspaceRoot: string;
}): Promise<FileDiffContent[]> {
  const diffs: FileDiffContent[] = [];
  const candidatePaths = new Set<string>([...input.before.keys(), ...input.after.keys()]);

  for (const path of candidatePaths) {
    const beforeEntry = input.before.get(path);
    const afterEntry = input.after.get(path);
    const beforeContent = beforeEntry?.currentContent ?? afterEntry?.headContent ?? '';
    const afterContent = afterEntry?.currentContent ?? beforeEntry?.headContent ?? '';

    if (
      beforeContent === afterContent &&
      buildChangeSignature(beforeEntry?.change) === buildChangeSignature(afterEntry?.change)
    ) {
      continue;
    }

    if (beforeContent.length === 0 && afterContent.length === 0) {
      continue;
    }

    const effectiveStatus = afterEntry?.change.status ?? 'modified';

    diffs.push({
      file: afterEntry?.change.path ?? beforeEntry?.change.path ?? path,
      before: beforeContent,
      after: afterContent,
      additions: countAddedLines(beforeContent, afterContent),
      deletions: countRemovedLines(beforeContent, afterContent),
      status:
        effectiveStatus === 'added'
          ? 'added'
          : effectiveStatus === 'deleted'
            ? 'deleted'
            : 'modified',
      sourceKind: 'workspace_reconcile',
      guaranteeLevel: 'weak',
    });
  }

  return diffs;
}

function buildChangeSignature(change: WorkspaceReviewChange | undefined): string {
  if (!change) {
    return 'missing';
  }

  return JSON.stringify([
    change.path,
    change.status,
    change.oldPath ?? null,
    change.linesAdded ?? null,
    change.linesDeleted ?? null,
  ]);
}

async function readWorkspaceFileContent(
  workspaceRoot: string,
  relativePath: string,
): Promise<string> {
  try {
    return await readFile(join(workspaceRoot, relativePath), 'utf-8');
  } catch {
    return '';
  }
}

async function readGitHeadContent(workspaceRoot: string, relativePath: string): Promise<string> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);

  try {
    const { stdout } = (await execFileAsync('git', ['show', `HEAD:${relativePath}`], {
      cwd: workspaceRoot,
      maxBuffer: 4 * 1024 * 1024,
    })) as { stdout: string };
    return stdout;
  } catch {
    return '';
  }
}

function countAddedLines(before: string, after: string): number {
  const beforeLines = toComparableLines(before);
  const afterLines = toComparableLines(after);
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
  const beforeLines = toComparableLines(before);
  const afterLines = toComparableLines(after);
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

function toComparableLines(value: string): string[] {
  const lines = value.split(/\r?\n/);
  if (lines.at(-1) === '') {
    lines.pop();
  }
  return lines;
}
