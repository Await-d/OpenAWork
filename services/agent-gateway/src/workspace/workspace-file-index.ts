/**
 * 工作区文件索引：为聊天输入框的 `@` 文件提及提供**递归展开**的扁平文件列表。
 *
 * 与 `/workspace/tree` 不同，这里不做层数限制（tree 的 MAX_DEPTH=4 /
 * MAX_ENTRIES=500 导致深层嵌套文件永远拿不到），只受总条目数上限约束，
 * 并按 BFS 顺序返回，让浅层文件优先出现。
 *
 * 全程 best-effort：任何目录读取失败都跳过，绝不向调用方抛错。忽略规则按
 * 根目录隔离：`getWorkspaceFileIndex` 从 `getWorkspaceIgnoreManager` 取该根的
 * 独立管理器，`collectWorkspaceFileIndex` 也可显式接收忽略断言。
 */

import { promises as fsp, type Dirent } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createAgentIgnoreManager, defaultIgnoreManager } from '@openAwork/agent-core';
import type { AgentIgnoreManager } from '@openAwork/agent-core';
import { WORKSPACE_FILE_INDEX_IGNORED_DIRS } from './workspace-ignored-dirs.js';

export const WORKSPACE_FILE_INDEX_DEFAULT_MAX_ENTRIES = 20000;
const WORKSPACE_FILE_INDEX_MAX_ENTRIES = 50000;
const WORKSPACE_FILE_INDEX_MIN_MAX_ENTRIES = 1000;

/** 缓存条目的存活时间：命中窗口内的重复查询不会再走文件系统。 */
export const WORKSPACE_FILE_INDEX_CACHE_TTL_MS = 15_000;
/** 进程内最多缓存的根目录数量，超出后按 `builtAt` 淘汰最旧的一个。 */
export const WORKSPACE_FILE_INDEX_CACHE_MAX_ENTRIES = 16;

export interface CollectWorkspaceFileIndexInput {
  rootPath: string;
  maxEntries?: number;
  shouldIgnore?: (absolutePath: string) => boolean;
}

export interface WorkspaceFileIndexResult {
  files: string[];
  truncated: boolean;
  visited: number;
}

/** 按根目录隔离的忽略管理器缓存，与文件索引缓存同上限。 */
const ignoreManagerCache = new Map<string, Promise<AgentIgnoreManager>>();

/**
 * 返回 `workspaceRoot` 专属的忽略管理器，加载过程按根去重并缓存。
 *
 * 每个管理器持有自己的 `projectRoot`，因此多个工作区根交替服务时互不污染。
 * 加载失败不永久缓存：删除条目后允许下一次重试。
 */
export async function getWorkspaceIgnoreManager(
  workspaceRoot: string,
): Promise<AgentIgnoreManager> {
  const cached = ignoreManagerCache.get(workspaceRoot);
  if (cached) {
    return cached;
  }

  const manager = createAgentIgnoreManager();
  const loadPromise = manager.loadRules(workspaceRoot).then(() => manager);
  ignoreManagerCache.set(workspaceRoot, loadPromise);
  while (ignoreManagerCache.size > WORKSPACE_FILE_INDEX_CACHE_MAX_ENTRIES) {
    const oldestKey = ignoreManagerCache.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    ignoreManagerCache.delete(oldestKey);
  }

  try {
    return await loadPromise;
  } catch (error) {
    // `Map` 插入顺序即缓存顺序；失败条目必须删除，否则重试永远命中拒绝态。
    ignoreManagerCache.delete(workspaceRoot);
    throw error;
  }
}

function clampMaxEntries(maxEntries: number | undefined): number {
  if (maxEntries === undefined) {
    return WORKSPACE_FILE_INDEX_DEFAULT_MAX_ENTRIES;
  }
  return Math.min(
    WORKSPACE_FILE_INDEX_MAX_ENTRIES,
    Math.max(WORKSPACE_FILE_INDEX_MIN_MAX_ENTRIES, maxEntries),
  );
}

/**
 * 广度优先遍历 `rootPath`，返回相对根目录、`/` 分隔的扁平文件路径列表。
 *
 * - 根层文件在前，随后逐层下降；同一目录内按 `name` 的 `localeCompare` 排序；
 * - 目录、符号链接、忽略集合命中项、`shouldIgnore` 断言命中项都不返回；
 * - `files.length === maxEntries` 后不再收集，若仍能发现下一个文件则
 *   `truncated: true`。
 */
export async function collectWorkspaceFileIndex(
  input: CollectWorkspaceFileIndexInput,
): Promise<WorkspaceFileIndexResult> {
  const { rootPath } = input;
  const maxEntries = clampMaxEntries(input.maxEntries);
  const shouldIgnore =
    input.shouldIgnore ?? ((path: string) => defaultIgnoreManager.shouldIgnore(path));
  const files: string[] = [];
  let visited = 0;

  // BFS：队列用 head 游标推进，避免大目录树下的 O(n²) shift 开销。
  const queue: string[] = [rootPath];
  let head = 0;

  while (head < queue.length) {
    const dirPath = queue[head]!;
    head += 1;

    let entries: Dirent[];
    try {
      entries = await fsp.readdir(dirPath, { withFileTypes: true });
    } catch {
      // 不可读目录：跳过，遍历继续。
      continue;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      visited += 1;
      if (WORKSPACE_FILE_INDEX_IGNORED_DIRS.has(entry.name)) continue;
      if (entry.isSymbolicLink()) continue;

      const entryPath = join(dirPath, entry.name);
      if (shouldIgnore(entryPath)) continue;

      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }
      if (!entry.isFile()) continue;

      if (files.length >= maxEntries) {
        return { files, truncated: true, visited };
      }
      files.push(relative(rootPath, entryPath).replaceAll('\\', '/'));
    }
  }

  return { files, truncated: false, visited };
}

export interface WorkspaceFileIndexEntry {
  relativePath: string;
  label: string;
  lowerLabel: string;
  lowerPath: string;
  depth: number;
}

export interface CachedWorkspaceFileIndex {
  rootPath: string;
  files: readonly WorkspaceFileIndexEntry[];
  directories: readonly string[];
  truncated: boolean;
  builtAt: number;
}

export interface GetWorkspaceFileIndexInput {
  rootPath: string;
  /** 忽略规则所属的工作区根；缺省时回退到 `rootPath`。 */
  ignoreRoot?: string;
  now?: number;
}

const fileIndexCache = new Map<string, CachedWorkspaceFileIndex>();

function normalizeCachePath(path: string): string {
  const normalized = resolve(path).replaceAll('\\', '/').replace(/\/+$/, '');
  return normalized === '' ? '/' : normalized;
}

function isSamePathOrAncestor(candidatePath: string, targetPath: string): boolean {
  if (candidatePath === targetPath) {
    return true;
  }
  return targetPath.startsWith(candidatePath === '/' ? '/' : `${candidatePath}/`);
}

function buildWorkspaceFileIndexEntries(relativePaths: readonly string[]): {
  files: WorkspaceFileIndexEntry[];
  directories: string[];
} {
  const files: WorkspaceFileIndexEntry[] = [];
  const directories = new Set<string>();

  for (const relativePath of relativePaths) {
    const segments = relativePath.split('/').filter((segment) => segment.length > 0);
    const label = segments[segments.length - 1];
    if (label === undefined) {
      continue;
    }

    files.push({
      relativePath,
      label,
      lowerLabel: label.toLowerCase(),
      lowerPath: relativePath.toLowerCase(),
      depth: segments.length,
    });

    for (let depth = 1; depth < segments.length; depth += 1) {
      directories.add(segments.slice(0, depth).join('/'));
    }
  }

  return {
    files,
    directories: Array.from(directories).sort((left, right) => left.localeCompare(right)),
  };
}

function evictOldestCachedIndexes(): void {
  while (fileIndexCache.size > WORKSPACE_FILE_INDEX_CACHE_MAX_ENTRIES) {
    let oldestKey: string | undefined;
    let oldestBuiltAt = Number.POSITIVE_INFINITY;
    for (const [key, cached] of fileIndexCache) {
      if (cached.builtAt < oldestBuiltAt) {
        oldestBuiltAt = cached.builtAt;
        oldestKey = key;
      }
    }
    if (oldestKey === undefined) {
      return;
    }
    fileIndexCache.delete(oldestKey);
  }
}

/**
 * 返回 `rootPath` 的缓存索引：TTL 内直接复用，过期后重新遍历。
 *
 * `now` 可注入，测试据此验证命中 / 过期，无需真实等待。缓存只存在于进程
 * 内存中，超过 `WORKSPACE_FILE_INDEX_CACHE_MAX_ENTRIES` 时淘汰 `builtAt`
 * 最小的根目录；不做磁盘持久化，也没有后台刷新。
 */
export async function getWorkspaceFileIndex(
  input: GetWorkspaceFileIndexInput,
): Promise<CachedWorkspaceFileIndex> {
  const { rootPath } = input;
  const now = input.now ?? Date.now();
  const cacheKey = normalizeCachePath(rootPath);
  const cached = fileIndexCache.get(cacheKey);
  if (cached && now - cached.builtAt < WORKSPACE_FILE_INDEX_CACHE_TTL_MS) {
    return cached;
  }

  const ignoreManager = await getWorkspaceIgnoreManager(input.ignoreRoot ?? rootPath);
  const collected = await collectWorkspaceFileIndex({
    rootPath,
    shouldIgnore: (absolutePath) => ignoreManager.shouldIgnore(absolutePath),
  });
  const { files, directories } = buildWorkspaceFileIndexEntries(collected.files);
  const built: CachedWorkspaceFileIndex = {
    rootPath,
    files,
    directories,
    truncated: collected.truncated,
    builtAt: now,
  };
  fileIndexCache.set(cacheKey, built);
  evictOldestCachedIndexes();
  return built;
}

/**
 * 失效 `targetPath` 命中（自身 / 祖先 / 子孙）的缓存根目录；无参数时清空全部。
 *
 * 先 `resolve` 再按“分隔符结尾”做前缀比较，避免 `/foo` 误伤 `/foobar`。
 */
export function invalidateWorkspaceFileIndex(targetPath?: string): void {
  if (targetPath === undefined) {
    fileIndexCache.clear();
    return;
  }

  const normalizedTarget = normalizeCachePath(targetPath);
  for (const key of [...fileIndexCache.keys()]) {
    const normalizedKey = normalizeCachePath(key);
    if (
      isSamePathOrAncestor(normalizedKey, normalizedTarget) ||
      isSamePathOrAncestor(normalizedTarget, normalizedKey)
    ) {
      fileIndexCache.delete(key);
    }
  }
}

export function __resetWorkspaceFileIndexCacheForTest(): void {
  fileIndexCache.clear();
  ignoreManagerCache.clear();
}
