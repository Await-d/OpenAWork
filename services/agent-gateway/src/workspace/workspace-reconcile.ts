import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FileDiffContent } from '@openAwork/shared';
import type { WorkspaceReviewChange } from './workspace-review.js';
import { listWorkspaceReviewChanges } from './workspace-review.js';

interface WorkspaceReconcileSnapshotEntry {
  change: WorkspaceReviewChange;
  currentContent: string;
  /**
   * 该路径是否存在「可读的 HEAD 版本」语义（原 `headContent` 是否可能非空）。
   *
   * 快照阶段**刻意不读** HEAD 内容：`git show` 是逐文件子进程，而 POSIX 上
   * `uv_spawn` 在主线程同步执行——脏工作区（几百～几千个变更文件）时每个 bash
   * 命令前后各一轮，会在事件循环上累计数百 ms～数秒的硬阻塞（整个网关/UI 卡死）。
   * HEAD 内容改为在 `collectWorkspaceReconcileDiffs` 里仅对「一侧缺失」的候选
   * 路径按需读取（通常只有命令新增/删除的那几个文件）。
   */
  canReadHead: boolean;
}

export type WorkspaceReconcileSnapshot = ReadonlyMap<string, WorkspaceReconcileSnapshotEntry>;

export async function captureWorkspaceReconcileSnapshot(
  workspaceRoot: string,
): Promise<WorkspaceReconcileSnapshot> {
  const changes = await listWorkspaceReviewChanges(workspaceRoot);
  const entries = await Promise.all(
    changes.map(async (change) => {
      const canReadHead = change.status !== 'added';
      const currentContent =
        change.status === 'deleted'
          ? ''
          : await readWorkspaceFileContent(workspaceRoot, change.path);
      return [
        change.path,
        {
          change,
          currentContent,
          canReadHead,
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

  // 预取需要 HEAD 基线的路径：仅「一侧缺失且该侧可读 HEAD」（命令新增 / 删除
  // 文件；命令只改内容时为 0 个）。并发上限避免 spawn 风暴在事件循环上硬阻塞。
  const headPathsNeeded = new Set<string>();
  const headPathFor = (entry: WorkspaceReconcileSnapshotEntry | undefined): string | undefined => {
    if (!entry || !entry.canReadHead) {
      return undefined;
    }
    return entry.change.oldPath ?? entry.change.path;
  };
  for (const path of candidatePaths) {
    const beforeEntry = input.before.get(path);
    const afterEntry = input.after.get(path);
    if (!beforeEntry) {
      const needed = headPathFor(afterEntry);
      if (needed !== undefined) headPathsNeeded.add(needed);
    }
    if (!afterEntry) {
      const needed = headPathFor(beforeEntry);
      if (needed !== undefined) headPathsNeeded.add(needed);
    }
  }
  const headContents = await readGitHeadContentsBounded(input.workspaceRoot, [...headPathsNeeded]);

  for (const path of candidatePaths) {
    const beforeEntry = input.before.get(path);
    const afterEntry = input.after.get(path);
    // 一侧缺失（命令新增 / 删除）时才用按需读取的 HEAD 内容作为对侧基线，
    // 语义与旧实现的 `headContent` 兜底一致，但快照阶段不再逐文件 `git show`。
    const beforeContent = beforeEntry
      ? beforeEntry.currentContent
      : readBatchedHeadContent(headContents, headPathFor(afterEntry));
    const afterContent = afterEntry
      ? afterEntry.currentContent
      : readBatchedHeadContent(headContents, headPathFor(beforeEntry));

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

/** 批量读取时每个 `git show` 子进程的并发上限：避免 spawn 风暴阻塞事件循环。 */
const HEAD_CONTENT_READ_CONCURRENCY = 8;

async function readGitHeadContentsBounded(
  workspaceRoot: string,
  relativePaths: readonly string[],
): Promise<Map<string, string>> {
  const contents = new Map<string, string>();
  if (relativePaths.length === 0) {
    return contents;
  }

  const queue = [...relativePaths];
  const workers = Array.from(
    { length: Math.min(HEAD_CONTENT_READ_CONCURRENCY, queue.length) },
    async () => {
      for (;;) {
        const next = queue.shift();
        if (next === undefined) {
          return;
        }
        contents.set(next, await readGitHeadContent(workspaceRoot, next));
      }
    },
  );
  await Promise.all(workers);
  return contents;
}

function readBatchedHeadContent(
  contents: ReadonlyMap<string, string>,
  headPath: string | undefined,
): string {
  if (headPath === undefined) {
    return '';
  }
  return contents.get(headPath) ?? '';
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
