import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  captureWorkspaceReconcileSnapshot,
  collectWorkspaceReconcileDiffs,
} from '../../workspace/workspace-reconcile.js';

/**
 * `workspace-reconcile` 的事件循环契约回归。
 *
 * 背景：每条 bash 命令前后各做一次工作区快照 + diff。旧实现会在快照阶段对
 * **每个变更文件**各起一个 `git show` 读 HEAD 内容（before/after 两轮），
 * POSIX 上 `uv_spawn` 在主线程同步执行——脏工作区里一次命令可让网关事件循环
 * 硬阻塞 1 秒以上（实测 2000 个变更文件 = 1098ms），表现为「执行 bash 时整个
 * 应用卡死」。本测试用 PATH 上的 git 包装脚本记录子进程调用，断言：
 *   1. 快照阶段只跑 `status` / `diff --numstat`，**不得**出现 `show`；
 *   2. 仅当命令新增 / 删除了文件、diff 需要 HEAD 基线时才出现 `show`；
 *   3. before/after 双方都存在的普通内容修改完全不触发 `show`。
 */

const REAL_GIT = execFileSync('which', ['git'], { encoding: 'utf-8' }).trim();

let testRoot = '';
let workDir = '';
let binDir = '';
let gitCallLog = '';
let originalPath = '';

function runGit(args: string[]): void {
  execFileSync(REAL_GIT, args, { cwd: workDir, stdio: 'pipe' });
}

/** 容错版：仅用于测试前置清理（首次运行时 HEAD/索引可能尚不存在）。 */
function runGitQuiet(args: string[]): void {
  try {
    execFileSync(REAL_GIT, args, { cwd: workDir, stdio: 'pipe' });
  } catch {
    // 清理动作允许失败（例如未提交任何文件时的 `checkout -- .`）。
  }
}

function resetGitCallLog(): void {
  writeFileSync(gitCallLog, '');
}

function readGitCalls(): string[] {
  return existsSync(gitCallLog)
    ? execFileSync('cat', [gitCallLog], { encoding: 'utf-8' })
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    : [];
}

function readShowPaths(): string[] {
  return readGitCalls()
    .filter((call) => call.startsWith('show '))
    .map((call) => call.slice('show '.length).trim());
}

beforeAll(() => {
  testRoot = mkdtempSync(join(tmpdir(), 'openawork-reconcile-'));
  workDir = join(testRoot, 'workspace');
  binDir = join(testRoot, 'bin');
  mkdirSync(workDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });

  gitCallLog = join(testRoot, 'git-calls.log');
  writeFileSync(gitCallLog, '');
  const gitWrapper = join(binDir, 'git');
  writeFileSync(
    gitWrapper,
    `#!/bin/sh\necho "$@" >> ${JSON.stringify(gitCallLog)}\nexec ${JSON.stringify(REAL_GIT)} "$@"\n`,
  );
  chmodSync(gitWrapper, 0o755);

  originalPath = process.env['PATH'] ?? '';
  process.env['PATH'] = `${binDir}:${originalPath}`;

  runGit(['init', '-q']);
  runGit(['config', 'user.email', 'reconcile@test.local']);
  runGit(['config', 'user.name', 'reconcile-test']);
  rmSync(join(workDir, '.git', 'hooks'), { recursive: true, force: true });
});

afterAll(() => {
  process.env['PATH'] = originalPath;
  rmSync(testRoot, { recursive: true, force: true });
});

beforeEach(() => {
  // 重置工作区到干净状态
  runGitQuiet(['checkout', '--', '.']);
  runGitQuiet(['clean', '-fdq']);
  resetGitCallLog();
});

describe('captureWorkspaceReconcileSnapshot / collectWorkspaceReconcileDiffs 事件循环契约', () => {
  it('快照阶段不得逐文件 spawn `git show`（HEAD 改为按需读取）', async () => {
    for (let index = 0; index < 8; index += 1) {
      writeFileSync(join(workDir, `file-${index}.txt`), 'base\n');
    }
    runGit(['add', '-A']);
    runGit(['commit', '-qm', 'seed files']);

    // 命令前：8 个文件干净
    resetGitCallLog();
    const before = await captureWorkspaceReconcileSnapshot(workDir);
    expect(readGitCalls().some((call) => call.startsWith('show '))).toBe(false);

    // 命令模拟：修改其中 5 个文件（仍为 modified，未新增/删除）
    for (let index = 0; index < 5; index += 1) {
      writeFileSync(join(workDir, `file-${index}.txt`), `changed-${index}\n`);
    }

    resetGitCallLog();
    const after = await captureWorkspaceReconcileSnapshot(workDir);
    expect(readGitCalls().some((call) => call.startsWith('show '))).toBe(false);

    const diffs = await collectWorkspaceReconcileDiffs({
      after,
      before,
      workspaceRoot: workDir,
    });

    // 命令改动的 5 个文件（命令前干净、before 快照无条目）需要 HEAD 作为
    // before 基线：只对这 5 个文件按需读取，且 before 内容来自 HEAD。
    expect(readShowPaths().sort()).toEqual(
      Array.from({ length: 5 }, (_, index) => `HEAD:file-${index}.txt`).sort(),
    );
    expect(diffs.map((diff) => diff.file).sort()).toEqual(
      Array.from({ length: 5 }, (_, index) => `file-${index}.txt`).sort(),
    );
    expect(diffs.every((diff) => diff.status === 'modified')).toBe(true);
    const first = diffs.find((diff) => diff.file === 'file-0.txt');
    expect(first?.before).toBe('base\n');
    expect(first?.after).toBe('changed-0\n');
  });

  it('命令新增 / 删除文件时才按需读 HEAD 基线，且 diff 语义与旧实现一致', async () => {
    writeFileSync(join(workDir, 'kept.txt'), 'kept-base\n');
    writeFileSync(join(workDir, 'will-be-deleted.txt'), 'delete-me\n');
    runGit(['add', '-A']);
    runGit(['commit', '-qm', 'seed delete case']);

    resetGitCallLog();
    const before = await captureWorkspaceReconcileSnapshot(workDir);

    // 命令模拟：新增一个文件 + 删除一个已提交文件
    writeFileSync(join(workDir, 'brand-new.txt'), 'new-content\n');
    rmSync(join(workDir, 'will-be-deleted.txt'));

    resetGitCallLog();
    const after = await captureWorkspaceReconcileSnapshot(workDir);
    expect(readGitCalls().some((call) => call.startsWith('show '))).toBe(false);

    const diffs = await collectWorkspaceReconcileDiffs({
      after,
      before,
      workspaceRoot: workDir,
    });

    const byFile = new Map(diffs.map((diff) => [diff.file, diff]));
    expect(byFile.get('brand-new.txt')?.status).toBe('added');
    expect(byFile.get('brand-new.txt')?.before).toBe('');
    expect(byFile.get('brand-new.txt')?.after).toBe('new-content\n');

    const deleted = byFile.get('will-be-deleted.txt');
    expect(deleted?.status).toBe('deleted');
    // 删除文件的 before 基线来自 HEAD（按需读取）
    expect(deleted?.before).toBe('delete-me\n');
    expect(deleted?.after).toBe('');

    // 仅删除场景需要 HEAD；新增的未跟踪文件不需要
    expect(readShowPaths()).toEqual(['HEAD:will-be-deleted.txt']);
  });

  it('同一脏工作区重复执行命令不会重复读 HEAD（第二组快照零 `git show`）', async () => {
    for (let index = 0; index < 6; index += 1) {
      writeFileSync(join(workDir, `dirty-${index}.txt`), 'base\n');
    }
    runGit(['add', '-A']);
    runGit(['commit', '-qm', 'seed dirty case']);
    for (let index = 0; index < 6; index += 1) {
      writeFileSync(join(workDir, `dirty-${index}.txt`), `dirty-${index}\n`);
    }

    resetGitCallLog();
    const first = await captureWorkspaceReconcileSnapshot(workDir);
    const second = await captureWorkspaceReconcileSnapshot(workDir);
    const diffs = await collectWorkspaceReconcileDiffs({
      after: second,
      before: first,
      workspaceRoot: workDir,
    });

    expect(diffs).toEqual([]);
    expect(readGitCalls().some((call) => call.startsWith('show '))).toBe(false);
  });
});
