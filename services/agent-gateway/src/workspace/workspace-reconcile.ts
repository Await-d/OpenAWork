import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { FileDiffContent } from '@openAwork/shared';
import { logGatewayWarn } from '../infra/gateway-logger.js';
import { countLineChanges, normalizeLineEndings } from './line-change-stats.js';
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

/**
 * 快照预算：每条 bash 命令前后各跑一次，必须给脏工作区设上限。
 *
 * 超限时直接返回空快照（放弃本次文件 diff），而不是读一半文件：
 * 部分快照会让 before/after 的「一侧缺失」判定失真，反而报出错误的
 * 新增/删除。日志只告警，不影响 bash 结果。
 */
export const MAX_RECONCILE_FILES = 400;
export const MAX_RECONCILE_TOTAL_BYTES = 8 * 1024 * 1024;

export async function captureWorkspaceReconcileSnapshot(
  workspaceRoot: string,
): Promise<WorkspaceReconcileSnapshot> {
  const changes = await listWorkspaceReviewChanges(workspaceRoot);
  if (changes.length > MAX_RECONCILE_FILES) {
    logGatewayWarn(
      `[workspace-reconcile] changed files (${changes.length}) exceed ${MAX_RECONCILE_FILES}; skip file-diff snapshot for ${workspaceRoot}`,
    );
    return new Map();
  }

  let totalBytes = 0;
  await Promise.all(
    changes.map(async (change) => {
      if (change.status === 'deleted') return;
      try {
        const info = await stat(join(workspaceRoot, change.path));
        totalBytes += info.size;
      } catch {
        // 读不到 size 的文件交给 readWorkspaceFileContent 的失败兜底。
      }
    }),
  );
  if (totalBytes > MAX_RECONCILE_TOTAL_BYTES) {
    logGatewayWarn(
      `[workspace-reconcile] changed file bytes (${totalBytes}) exceed ${MAX_RECONCILE_TOTAL_BYTES}; skip file-diff snapshot for ${workspaceRoot}`,
    );
    return new Map();
  }

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

    // 内容判等按换行符归一化后的文本比较：纯 CRLF / LF 改写不是内容改动，
    // 不该产出一条「modified」条目（展示用的 before/after 仍保留原始文本）。
    const contentsEquivalent =
      normalizeLineEndings(beforeContent) === normalizeLineEndings(afterContent);
    if (
      contentsEquivalent &&
      buildChangeSignature(beforeEntry?.change) === buildChangeSignature(afterEntry?.change)
    ) {
      continue;
    }

    if (beforeContent.length === 0 && afterContent.length === 0) {
      continue;
    }

    const effectiveStatus = afterEntry?.change.status ?? 'modified';
    const { additions, deletions } = countLineChanges(beforeContent, afterContent);

    diffs.push({
      file: afterEntry?.change.path ?? beforeEntry?.change.path ?? path,
      before: beforeContent,
      after: afterContent,
      additions,
      deletions,
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

// 行级计数与 EOL 归一化统一由 `./line-change-stats.js` 提供：这两份重复的
// 「错位即双计」实现都已删除，避免再次漂移出 116/116 这类失真数字。
