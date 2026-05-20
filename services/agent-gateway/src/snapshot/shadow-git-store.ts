/**
 * Shadow Git Store
 * ────────────────
 *
 * 用 git 作为底层引擎为每个 workspace 维护一个独立的 shadow git repo
 * （独立 .git 目录），用于：
 *
 *  1. 原子快照（git write-tree 一个 hash 代表整个工作区状态）
 *  2. 高效 diff（git diff/numstat）
 *  3. delta 压缩存储（git pack）
 *  4. O(1) 精确恢复（git checkout {hash} -- {file}）
 *
 * 灵感来自 opencode 的 `packages/opencode/src/snapshot/index.ts`，
 * 但移除了 Effect 依赖、改用 Node 原生 child_process / fs/promises，
 * 并加入 OpenAWork 独有的：
 *
 *  - per-workspace Semaphore（并发安全）
 *  - 优雅降级（git 不可用时由调用方使用 fallback）
 *  - readFileAt（按 tree hash 读取文件内容，用于 preview）
 *  - restoreSelective（多文件批量恢复到指定 tree hash）
 *
 * 设计文档：docs/design/ultra-file-change-tracking.md
 */

import { execFile, spawn } from 'node:child_process';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { resolveGatewayDataDir } from '../infra/storage-paths.js';

const execFileAsync = promisify(execFile);

// ─── 公开类型 ───────────────────────────────────────────────────────────

/** Shadow git tree hash (git SHA-1, 40 hex chars). */
export type TreeHash = string;

export type FileChangeStatus = 'added' | 'deleted' | 'modified';

export interface ShadowGitFilePatch {
  file: string;
  status: FileChangeStatus;
}

export interface ShadowGitFileDiff {
  file: string;
  before: string;
  after: string;
  additions: number;
  deletions: number;
  status: FileChangeStatus;
  /** 是否为二进制文件（无法生成文本 diff） */
  binary?: boolean;
}

export interface ShadowGitCaptureOptions {
  /** 仅捕获指定文件子集（默认捕获所有变更） */
  files?: string[];
  /** 单个文件大小上限（字节），超过的文件不进入快照（默认 2MB） */
  fileSizeLimit?: number;
}

export interface ShadowGitRestoreSelectiveOptions {
  /** 是否在文件不存在于快照时删除当前工作区中的对应文件 */
  deleteMissing?: boolean;
}

export interface ShadowGitDiffOptions {
  /** 限定路径范围（gitignore-relative）。空表示整个工作区 */
  paths?: string[];
}

// ─── 内部状态 ───────────────────────────────────────────────────────────

const DEFAULT_FILE_SIZE_LIMIT = 2 * 1024 * 1024;

const GIT_CORE_ARGS = ['-c', 'core.longpaths=true', '-c', 'core.symlinks=true'];
const GIT_CFG_ARGS = ['-c', 'core.autocrlf=false', ...GIT_CORE_ARGS];
const GIT_QUOTE_ARGS = [...GIT_CFG_ARGS, '-c', 'core.quotepath=false'];

interface WorkspaceLock {
  /** Sequential mutex queue head. */
  tail: Promise<void>;
}

const locksByGitDir = new Map<string, WorkspaceLock>();
const initializedGitDirs = new Set<string>();

function acquire(gitDir: string): { release: () => void; wait: Promise<void> } {
  const existing = locksByGitDir.get(gitDir) ?? { tail: Promise.resolve() };
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const wait = existing.tail;
  locksByGitDir.set(gitDir, { tail: existing.tail.then(() => next) });
  return { release, wait };
}

async function withLock<T>(gitDir: string, fn: () => Promise<T>): Promise<T> {
  const { release, wait } = acquire(gitDir);
  try {
    await wait;
    return await fn();
  } finally {
    release();
  }
}

// ─── git 调用辅助 ────────────────────────────────────────────────────────

interface GitInvocationResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface GitInvocationInput {
  args: string[];
  cwd: string;
  stdin?: string;
  /** 限制 stdout 大小（字节），默认 16MB */
  maxBuffer?: number;
}

async function runGit(input: GitInvocationInput): Promise<GitInvocationResult> {
  const maxBuffer = input.maxBuffer ?? 16 * 1024 * 1024;

  // execFile (promisified) does not handle stdin via `input`, so when we need
  // to write to stdin we fall back to `spawn` and accumulate buffers manually.
  if (input.stdin !== undefined) {
    return runGitWithStdin({ ...input, maxBuffer });
  }

  try {
    const result = await execFileAsync('git', input.args, {
      cwd: input.cwd,
      maxBuffer,
    });
    return { exitCode: 0, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      code?: string | number;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
    };
    return {
      exitCode: typeof err.code === 'number' ? err.code : 1,
      stdout: err.stdout ? err.stdout.toString() : '',
      stderr: err.stderr ? err.stderr.toString() : (err.message ?? ''),
    };
  }
}

function runGitWithStdin(
  input: GitInvocationInput & { maxBuffer: number },
): Promise<GitInvocationResult> {
  return new Promise((resolve) => {
    const child = spawn('git', input.args, { cwd: input.cwd });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutSize = 0;
    let stderrSize = 0;
    let killed = false;

    const fail = (message: string) => {
      if (killed) return;
      killed = true;
      child.kill('SIGKILL');
      resolve({ exitCode: 1, stdout: '', stderr: message });
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutSize += chunk.length;
      if (stdoutSize > input.maxBuffer) {
        fail('git stdout exceeded maxBuffer');
        return;
      }
      stdoutChunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrSize += chunk.length;
      if (stderrSize > input.maxBuffer) {
        fail('git stderr exceeded maxBuffer');
        return;
      }
      stderrChunks.push(chunk);
    });
    child.on('error', (err) => fail(err.message));
    child.on('close', (code) => {
      if (killed) return;
      resolve({
        exitCode: typeof code === 'number' ? code : 1,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
      });
    });

    child.stdin.on('error', () => {
      // Ignore: child may have closed stdin first (e.g. exited early)
    });
    if (input.stdin !== undefined) {
      child.stdin.end(input.stdin);
    } else {
      child.stdin.end();
    }
  });
}

// ─── 工作区路径 → shadow gitdir ─────────────────────────────────────────

/**
 * 为指定 workspace 计算 shadow git dir 的绝对路径。
 *
 * - 同一个 workspaceRoot 在不同 process 之间稳定地映射到同一个 gitdir
 * - 路径形式：{dataDir}/snapshots/{sha256(workspaceRoot).slice(0,16)}
 */
export function resolveShadowGitDir(workspaceRoot: string): string {
  const hash = createHash('sha256').update(workspaceRoot).digest('hex').slice(0, 16);
  return join(resolveGatewayDataDir(), 'snapshots', hash);
}

function gitArgsForRepo(gitDir: string, workTree: string, cmd: readonly string[]): string[] {
  return ['--git-dir', gitDir, '--work-tree', workTree, ...cmd];
}

// ─── ShadowGitStore 接口 ────────────────────────────────────────────────

export interface ShadowGitStore {
  isAvailable(): Promise<boolean>;
  init(workspaceRoot: string): Promise<void>;
  capture(workspaceRoot: string, options?: ShadowGitCaptureOptions): Promise<TreeHash>;
  diff(
    workspaceRoot: string,
    from: TreeHash,
    to?: TreeHash,
    options?: ShadowGitDiffOptions,
  ): Promise<ShadowGitFilePatch[]>;
  diffFull(
    workspaceRoot: string,
    from: TreeHash,
    to: TreeHash,
    options?: ShadowGitDiffOptions,
  ): Promise<ShadowGitFileDiff[]>;
  readFileAt(workspaceRoot: string, hash: TreeHash, filePath: string): Promise<string | null>;
  restoreFile(workspaceRoot: string, hash: TreeHash, filePath: string): Promise<void>;
  restoreAll(workspaceRoot: string, hash: TreeHash): Promise<void>;
  restoreSelective(
    workspaceRoot: string,
    hash: TreeHash,
    files: string[],
    options?: ShadowGitRestoreSelectiveOptions,
  ): Promise<void>;
  gc(workspaceRoot: string): Promise<void>;
}

// ─── 实现 ──────────────────────────────────────────────────────────────

class ShadowGitStoreImpl implements ShadowGitStore {
  private gitAvailable: boolean | undefined;

  async isAvailable(): Promise<boolean> {
    if (this.gitAvailable !== undefined) return this.gitAvailable;
    const result = await runGit({ args: ['--version'], cwd: process.cwd() });
    this.gitAvailable = result.exitCode === 0 && /git version/.test(result.stdout);
    return this.gitAvailable;
  }

  async init(workspaceRoot: string): Promise<void> {
    const gitDir = resolveShadowGitDir(workspaceRoot);
    if (initializedGitDirs.has(gitDir)) return;

    await withLock(gitDir, async () => {
      if (initializedGitDirs.has(gitDir)) return;
      await mkdir(gitDir, { recursive: true });

      // git init 失败时不 throw，让 capture 阶段统一报错
      const initResult = await runGit({
        args: ['init', '--bare', gitDir],
        cwd: workspaceRoot,
      });
      if (initResult.exitCode !== 0) {
        throw new Error(`shadow git init failed: ${initResult.stderr.trim()}`);
      }

      // 关键 config（与 opencode 一致）
      const configs: Array<[string, string]> = [
        ['core.autocrlf', 'false'],
        ['core.longpaths', 'true'],
        ['core.symlinks', 'true'],
        ['core.fsmonitor', 'false'],
        ['gc.auto', '0'],
        ['gc.autoDetach', 'false'],
      ];
      for (const [key, value] of configs) {
        await runGit({
          args: ['--git-dir', gitDir, 'config', key, value],
          cwd: workspaceRoot,
        });
      }

      initializedGitDirs.add(gitDir);
    });
  }

  async capture(workspaceRoot: string, options?: ShadowGitCaptureOptions): Promise<TreeHash> {
    await this.init(workspaceRoot);
    const gitDir = resolveShadowGitDir(workspaceRoot);
    const limit = options?.fileSizeLimit ?? DEFAULT_FILE_SIZE_LIMIT;

    return withLock(gitDir, async () => {
      // 同步 .gitignore：从 source repo 读取 info/exclude（如有）
      await syncExcludeRules(gitDir, workspaceRoot);

      // 收集候选文件
      const candidates = await listCandidateFiles({
        gitDir,
        workspaceRoot,
        explicitFiles: options?.files,
      });

      if (candidates.length > 0) {
        // 过滤：超大文件
        const allowed = await filterBySize({
          workspaceRoot,
          files: candidates,
          limit,
        });

        if (allowed.length > 0) {
          const stageResult = await runGit({
            args: gitArgsForRepo(gitDir, workspaceRoot, [
              ...GIT_CFG_ARGS,
              'add',
              '--all',
              '--sparse',
              '--pathspec-from-file=-',
              '--pathspec-file-nul',
              '--',
            ]),
            cwd: workspaceRoot,
            stdin: allowed.join('\0') + '\0',
          });
          if (stageResult.exitCode !== 0) {
            // stage 失败不致命：write-tree 仍可能产生有效 hash
            console.warn('[shadow-git] git add warning:', stageResult.stderr.trim());
          }
        }
      }

      const writeTreeResult = await runGit({
        args: gitArgsForRepo(gitDir, workspaceRoot, ['write-tree']),
        cwd: workspaceRoot,
      });
      if (writeTreeResult.exitCode !== 0) {
        throw new Error(`shadow git write-tree failed: ${writeTreeResult.stderr.trim()}`);
      }

      const hash = writeTreeResult.stdout.trim();
      if (!/^[0-9a-f]{40,64}$/.test(hash)) {
        throw new Error(`shadow git produced invalid tree hash: ${hash}`);
      }
      return hash;
    });
  }

  async diff(
    workspaceRoot: string,
    from: TreeHash,
    to?: TreeHash,
    options?: ShadowGitDiffOptions,
  ): Promise<ShadowGitFilePatch[]> {
    const gitDir = resolveShadowGitDir(workspaceRoot);

    return withLock(gitDir, async () => {
      const diffArgs = to
        ? [...GIT_QUOTE_ARGS, 'diff', '--no-ext-diff', '--name-status', '--no-renames', from, to]
        : [
            ...GIT_QUOTE_ARGS,
            'diff',
            '--cached',
            '--no-ext-diff',
            '--name-status',
            '--no-renames',
            from,
          ];

      if (options?.paths?.length) {
        diffArgs.push('--', ...options.paths);
      }

      const result = await runGit({
        args: gitArgsForRepo(gitDir, workspaceRoot, diffArgs),
        cwd: workspaceRoot,
      });

      if (result.exitCode !== 0) {
        throw new Error(`shadow git diff failed: ${result.stderr.trim()}`);
      }

      return parseNameStatus(result.stdout);
    });
  }

  async diffFull(
    workspaceRoot: string,
    from: TreeHash,
    to: TreeHash,
    options?: ShadowGitDiffOptions,
  ): Promise<ShadowGitFileDiff[]> {
    const gitDir = resolveShadowGitDir(workspaceRoot);

    return withLock(gitDir, async () => {
      const baseArgs = [
        ...GIT_QUOTE_ARGS,
        'diff',
        '--no-ext-diff',
        '--no-renames',
        '--numstat',
        from,
        to,
      ];
      if (options?.paths?.length) baseArgs.push('--', ...options.paths);

      const numstatResult = await runGit({
        args: gitArgsForRepo(gitDir, workspaceRoot, baseArgs),
        cwd: workspaceRoot,
      });
      if (numstatResult.exitCode !== 0) {
        throw new Error(`shadow git diff (numstat) failed: ${numstatResult.stderr.trim()}`);
      }

      const statusArgs = [
        ...GIT_QUOTE_ARGS,
        'diff',
        '--no-ext-diff',
        '--name-status',
        '--no-renames',
        from,
        to,
      ];
      if (options?.paths?.length) statusArgs.push('--', ...options.paths);

      const statusResult = await runGit({
        args: gitArgsForRepo(gitDir, workspaceRoot, statusArgs),
        cwd: workspaceRoot,
      });
      if (statusResult.exitCode !== 0) {
        throw new Error(`shadow git diff (status) failed: ${statusResult.stderr.trim()}`);
      }

      const statusByFile = new Map<string, FileChangeStatus>();
      for (const patch of parseNameStatus(statusResult.stdout)) {
        statusByFile.set(patch.file, patch.status);
      }

      const numstatRows = parseNumstat(numstatResult.stdout);
      const diffs: ShadowGitFileDiff[] = [];

      for (const row of numstatRows) {
        const status = statusByFile.get(row.file) ?? 'modified';
        const before =
          status === 'added'
            ? ''
            : await readBlobAtRef({ gitDir, workspaceRoot, ref: `${from}:${row.file}` });
        const after =
          status === 'deleted'
            ? ''
            : await readBlobAtRef({ gitDir, workspaceRoot, ref: `${to}:${row.file}` });

        diffs.push({
          file: row.file,
          before,
          after,
          additions: row.additions,
          deletions: row.deletions,
          status,
          ...(row.binary ? { binary: true } : {}),
        });
      }

      return diffs;
    });
  }

  async readFileAt(
    workspaceRoot: string,
    hash: TreeHash,
    filePath: string,
  ): Promise<string | null> {
    const gitDir = resolveShadowGitDir(workspaceRoot);
    const result = await runGit({
      args: gitArgsForRepo(gitDir, workspaceRoot, [...GIT_CFG_ARGS, 'show', `${hash}:${filePath}`]),
      cwd: workspaceRoot,
    });
    if (result.exitCode === 0) return result.stdout;
    // 文件在该 hash 下不存在
    return null;
  }

  async restoreFile(workspaceRoot: string, hash: TreeHash, filePath: string): Promise<void> {
    const gitDir = resolveShadowGitDir(workspaceRoot);
    return withLock(gitDir, async () => {
      const checkout = await runGit({
        args: gitArgsForRepo(gitDir, workspaceRoot, [
          ...GIT_CORE_ARGS,
          'checkout',
          hash,
          '--',
          filePath,
        ]),
        cwd: workspaceRoot,
      });
      if (checkout.exitCode === 0) return;

      // 文件在快照中不存在 → 删除当前工作区中的对应文件
      const tree = await runGit({
        args: gitArgsForRepo(gitDir, workspaceRoot, [
          ...GIT_CORE_ARGS,
          'ls-tree',
          hash,
          '--',
          filePath,
        ]),
        cwd: workspaceRoot,
      });
      if (tree.exitCode === 0 && tree.stdout.trim().length === 0) {
        await unlink(join(workspaceRoot, filePath)).catch(() => undefined);
        return;
      }
      throw new Error(`shadow git restoreFile failed: ${checkout.stderr.trim()}`);
    });
  }

  async restoreAll(workspaceRoot: string, hash: TreeHash): Promise<void> {
    const gitDir = resolveShadowGitDir(workspaceRoot);
    return withLock(gitDir, async () => {
      const readTree = await runGit({
        args: gitArgsForRepo(gitDir, workspaceRoot, [...GIT_CORE_ARGS, 'read-tree', hash]),
        cwd: workspaceRoot,
      });
      if (readTree.exitCode !== 0) {
        throw new Error(`shadow git read-tree failed: ${readTree.stderr.trim()}`);
      }
      const checkout = await runGit({
        args: gitArgsForRepo(gitDir, workspaceRoot, [
          ...GIT_CORE_ARGS,
          'checkout-index',
          '-a',
          '-f',
        ]),
        cwd: workspaceRoot,
      });
      if (checkout.exitCode !== 0) {
        throw new Error(`shadow git checkout-index failed: ${checkout.stderr.trim()}`);
      }
    });
  }

  async restoreSelective(
    workspaceRoot: string,
    hash: TreeHash,
    files: string[],
    options?: ShadowGitRestoreSelectiveOptions,
  ): Promise<void> {
    if (files.length === 0) return;
    const gitDir = resolveShadowGitDir(workspaceRoot);

    return withLock(gitDir, async () => {
      // 1. 一次性查询所有目标文件在快照中是否存在
      const lsResult = await runGit({
        args: gitArgsForRepo(gitDir, workspaceRoot, [
          ...GIT_CORE_ARGS,
          'ls-tree',
          '--name-only',
          hash,
          '--',
          ...files,
        ]),
        cwd: workspaceRoot,
      });
      const existing = new Set(
        lsResult.stdout
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
      );

      // 2. 对存在的文件：批量 checkout
      const present = files.filter((f) => existing.has(f));
      if (present.length > 0) {
        const checkout = await runGit({
          args: gitArgsForRepo(gitDir, workspaceRoot, [
            ...GIT_CORE_ARGS,
            'checkout',
            hash,
            '--',
            ...present,
          ]),
          cwd: workspaceRoot,
        });
        if (checkout.exitCode !== 0) {
          throw new Error(`shadow git restoreSelective checkout failed: ${checkout.stderr.trim()}`);
        }
      }

      // 3. 对不存在的文件：可选删除
      if (options?.deleteMissing) {
        const missing = files.filter((f) => !existing.has(f));
        for (const file of missing) {
          await unlink(join(workspaceRoot, file)).catch(() => undefined);
        }
      }
    });
  }

  async gc(workspaceRoot: string): Promise<void> {
    const gitDir = resolveShadowGitDir(workspaceRoot);
    return withLock(gitDir, async () => {
      try {
        const dirStat = await stat(gitDir);
        if (!dirStat.isDirectory()) return;
      } catch {
        return;
      }
      const result = await runGit({
        args: gitArgsForRepo(gitDir, workspaceRoot, ['gc', '--prune=7.days']),
        cwd: workspaceRoot,
      });
      if (result.exitCode !== 0) {
        // gc 失败不致命
        console.warn('[shadow-git] gc warning:', result.stderr.trim());
      }
    });
  }
}

// ─── 工厂 ──────────────────────────────────────────────────────────────

let cachedStore: ShadowGitStoreImpl | null = null;

export function createShadowGitStore(): ShadowGitStore {
  if (!cachedStore) cachedStore = new ShadowGitStoreImpl();
  return cachedStore;
}

/** 测试用：重置内部缓存。 */
export function __resetShadowGitStoreForTests(): void {
  cachedStore = null;
  initializedGitDirs.clear();
  locksByGitDir.clear();
}

// ─── 辅助函数 ───────────────────────────────────────────────────────────

async function syncExcludeRules(gitDir: string, _workspaceRoot: string): Promise<void> {
  // 写一个空的 info/exclude（将来可叠加用户自定义规则）
  const target = join(gitDir, 'info', 'exclude');
  await mkdir(dirname(target), { recursive: true }).catch(() => undefined);
  try {
    await writeFile(target, '\n', 'utf8');
  } catch {
    /* noop */
  }
}

interface ListCandidateFilesInput {
  gitDir: string;
  workspaceRoot: string;
  explicitFiles?: string[];
}

async function listCandidateFiles(input: ListCandidateFilesInput): Promise<string[]> {
  if (input.explicitFiles && input.explicitFiles.length > 0) {
    return Array.from(new Set(input.explicitFiles));
  }

  const [tracked, untracked] = await Promise.all([
    runGit({
      args: gitArgsForRepo(input.gitDir, input.workspaceRoot, [
        ...GIT_QUOTE_ARGS,
        'diff-files',
        '--name-only',
        '-z',
        '--',
        '.',
      ]),
      cwd: input.workspaceRoot,
    }),
    runGit({
      args: gitArgsForRepo(input.gitDir, input.workspaceRoot, [
        ...GIT_QUOTE_ARGS,
        'ls-files',
        '--others',
        '--exclude-standard',
        '-z',
        '--',
        '.',
      ]),
      cwd: input.workspaceRoot,
    }),
  ]);

  const merged = new Set<string>();
  for (const value of [...tracked.stdout.split('\0'), ...untracked.stdout.split('\0')]) {
    if (value.trim().length > 0) merged.add(value);
  }
  return Array.from(merged);
}

interface FilterBySizeInput {
  workspaceRoot: string;
  files: string[];
  limit: number;
}

async function filterBySize(input: FilterBySizeInput): Promise<string[]> {
  const allowed: string[] = [];
  await Promise.all(
    input.files.map(async (file) => {
      try {
        const fullPath = join(input.workspaceRoot, file);
        const fileStat = await stat(fullPath);
        if (!fileStat.isFile()) return;
        const size = typeof fileStat.size === 'bigint' ? Number(fileStat.size) : fileStat.size;
        if (size <= input.limit) allowed.push(file);
      } catch {
        // 文件已不存在等情况，跳过
      }
    }),
  );
  return allowed;
}

function parseNameStatus(text: string): ShadowGitFilePatch[] {
  const result: ShadowGitFilePatch[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const [code, file] = line.split(/\t+/);
    if (!code || !file) continue;
    const status: FileChangeStatus = code.startsWith('A')
      ? 'added'
      : code.startsWith('D')
        ? 'deleted'
        : 'modified';
    result.push({ file, status });
  }
  return result;
}

interface NumstatRow {
  file: string;
  additions: number;
  deletions: number;
  binary: boolean;
}

function parseNumstat(text: string): NumstatRow[] {
  const rows: NumstatRow[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split(/\t+/);
    if (parts.length < 3) continue;
    const [adds, dels, file] = parts;
    if (!file) continue;
    const binary = adds === '-' && dels === '-';
    rows.push({
      file,
      additions: binary ? 0 : Number.parseInt(adds ?? '0', 10) || 0,
      deletions: binary ? 0 : Number.parseInt(dels ?? '0', 10) || 0,
      binary,
    });
  }
  return rows;
}

interface ReadBlobInput {
  gitDir: string;
  workspaceRoot: string;
  ref: string;
}

async function readBlobAtRef(input: ReadBlobInput): Promise<string> {
  const result = await runGit({
    args: gitArgsForRepo(input.gitDir, input.workspaceRoot, [...GIT_CFG_ARGS, 'show', input.ref]),
    cwd: input.workspaceRoot,
  });
  return result.exitCode === 0 ? result.stdout : '';
}
