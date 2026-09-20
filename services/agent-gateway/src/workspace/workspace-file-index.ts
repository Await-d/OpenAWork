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

/**
 * 索引「版本」——供前端轮询工作区是否变化，与缓存条目**解耦**。
 *
 * 缓存条目（`fileIndexCache`）会被 TTL 过期或容量淘汰删除，`builtAt` 又是墙钟
 * 时间、既不单调也会随条目一起消失。预览刷新需要的是一个**只增不减的进程内序号**：
 * 某根目录的索引一旦被（重）建或失效，它的版本就前进一次，即便缓存条目随后被
 * 淘汰，这个前进仍然可被观察到。
 *
 * 版本按 `normalizeCachePath(root)` 分根记录；某路径首次被读取时惰性登记为当前
 * 全局值。这样「从未建过索引的根」也不会被其他根目录的构建 / 失效波及——它只在
 * 自己真正变化时才前进，避免无关工作区触发预览刷新。
 */
let globalIndexVersion = 0;
const indexVersionByRoot = new Map<string, number>();

/** 单调推进全局序号，并把给定根目录的版本钉到新值。 */
function bumpIndexVersions(keys: Iterable<string>): void {
  globalIndexVersion += 1;
  for (const key of keys) {
    indexVersionByRoot.set(key, globalIndexVersion);
  }
}

/**
 * 返回索引版本：无参数给全局序号；给 `rootPath` 时给该根目录的版本。
 *
 * 未见过的根目录首次读取会被惰性登记为当前全局值，之后无关根目录的变化不会
 * 改变它——调用方据此判断「自己关心的根」是否真的变了。
 */
export function getWorkspaceFileIndexVersion(rootPath?: string): number {
  if (rootPath === undefined) {
    return globalIndexVersion;
  }
  const key = normalizeCachePath(rootPath);
  const known = indexVersionByRoot.get(key);
  if (known !== undefined) {
    return known;
  }
  indexVersionByRoot.set(key, globalIndexVersion);
  return globalIndexVersion;
}

/**
 * 把扁平相对路径列表构建成检索条目：文件条目 + 去重排序后的目录集合。
 *
 * 同时被本地索引与 SSH 远端索引复用，保证两端 `@` 检索的条目结构与排序一致。
 */
export function buildWorkspaceFileIndexEntries(relativePaths: readonly string[]): {
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
  // 每次（重）建都推进版本，让「首次构建」也能被版本轮询观察到。
  bumpIndexVersions([cacheKey]);
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
    // 全清：所有已知根目录版本整体前进，未登记者继续用全局序号兜底。
    bumpIndexVersions([...indexVersionByRoot.keys()]);
    return;
  }

  const normalizedTarget = normalizeCachePath(targetPath);
  const affectedRoots = new Set<string>([normalizedTarget]);
  for (const key of [...fileIndexCache.keys()]) {
    const normalizedKey = normalizeCachePath(key);
    if (
      isSamePathOrAncestor(normalizedKey, normalizedTarget) ||
      isSamePathOrAncestor(normalizedTarget, normalizedKey)
    ) {
      fileIndexCache.delete(key);
      affectedRoots.add(normalizedKey);
    }
  }
  // 失效目标常常是文件 / 子目录，而前端轮询的是工作区根：把所有「目标的祖先」
  // 版本一并推进，保证根路径的版本能反映子路径的变化（即使根的缓存已淘汰）。
  for (const key of indexVersionByRoot.keys()) {
    if (isSamePathOrAncestor(key, normalizedTarget)) {
      affectedRoots.add(key);
    }
  }
  bumpIndexVersions(affectedRoots);
}

export function __resetWorkspaceFileIndexCacheForTest(): void {
  fileIndexCache.clear();
  ignoreManagerCache.clear();
  indexVersionByRoot.clear();
  globalIndexVersion = 0;
}
