/**
 * SSH 远程工作区文件索引：为 SSH 绑定会话的 `@` 文件提及提供远端文件检索。
 *
 * 网关可能运行在 Windows，而会话工作区是远端 POSIX 路径，本地 fs 索引与
 * workspace 路径校验都不适用。本模块在远端执行一次 POSIX `find` 构建扁平
 * 文件列表，复用本地索引的条目结构（`buildWorkspaceFileIndexEntries`）与
 * 检索排序（`searchWorkspaceFileIndex`），缓存策略与本地索引保持一致
 * （TTL + 按 `builtAt` 淘汰）。
 *
 * 全程 best-effort：远端 `find` 失败（非零退出 / 超时 / 非 POSIX 远端）时
 * 返回空结果并记录警告，绝不向调用方抛错。
 */

import {
  buildWorkspaceFileIndexEntries,
  WORKSPACE_FILE_INDEX_CACHE_MAX_ENTRIES,
  WORKSPACE_FILE_INDEX_CACHE_TTL_MS,
  WORKSPACE_FILE_INDEX_DEFAULT_MAX_ENTRIES,
  type CachedWorkspaceFileIndex,
} from './workspace-file-index.js';
import { searchWorkspaceFileIndex } from './workspace-file-search.js';
import {
  resolveSshBoundSessionId,
  type SshRemoteExecutionContext,
} from '../tools/ssh-remote-execution.js';
import { peekSshService } from '../ssh/ssh-service.js';
import { IGNORED_NAMES } from '../tools/workspace-tools.js';

export interface SshWorkspaceSearchResult {
  root: string;
  files: string[];
  directories: string[];
  truncated: boolean;
  count: number;
}

/** 远端 `find` 的墙钟上限：与 executeRemoteGlob 的远端搜索超时一致。 */
const SSH_FILE_INDEX_FIND_TIMEOUT_MS = 20_000;

/** connectionId + baseDir 维度的远端索引缓存。 */
const sshFileIndexCache = new Map<string, CachedWorkspaceFileIndex>();

/**
 * 冷构建期间同一 connectionId + baseDir 的进行中远端 find。TTL 缓存只在构建
 * 完成时才写入，若不做合并，冷缓存下的并发请求会各自触发一次远端 find。
 */
const sshFileIndexInFlight = new Map<string, Promise<CachedWorkspaceFileIndex | null>>();

function sshFileIndexCacheKey(connectionId: string, baseDir: string): string {
  return `${connectionId}\u0000${baseDir}`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * 构造与 executeRemoteGlob 同款的远端 `find`：剪枝忽略目录、只列文件、
 * `head` 截断到本地索引的条目上限。
 */
function buildRemoteFindCommand(): string {
  const pruneExpression = [...IGNORED_NAMES]
    .map((name) => `-name ${shellQuote(name)}`)
    .join(' -o ');
  return `find . \\( ${pruneExpression} \\) -prune -o -type f -print | head -n ${WORKSPACE_FILE_INDEX_DEFAULT_MAX_ENTRIES}`;
}

/** 解析 `find . -print` 输出：去掉 `./` 前缀，容忍 `\r` 与空行。 */
function parseRemoteFindLine(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.startsWith('./')) {
    const relative = trimmed.slice(2);
    return relative.length > 0 ? relative : null;
  }
  const withoutLeadingSlash = trimmed.replace(/^\/+/, '');
  return withoutLeadingSlash.length > 0 ? withoutLeadingSlash : null;
}

function evictOldestSshIndexes(): void {
  while (sshFileIndexCache.size > WORKSPACE_FILE_INDEX_CACHE_MAX_ENTRIES) {
    let oldestKey: string | undefined;
    let oldestBuiltAt = Number.POSITIVE_INFINITY;
    for (const [key, cached] of sshFileIndexCache) {
      if (cached.builtAt < oldestBuiltAt) {
        oldestBuiltAt = cached.builtAt;
        oldestKey = key;
      }
    }
    if (oldestKey === undefined) return;
    sshFileIndexCache.delete(oldestKey);
  }
}

/**
 * 在远端构建一次索引。任何失败（非 POSIX 远端 / 非零退出 / 超时 / 通道异常）
 * 都返回 null 并记录警告，由调用方转成空结果。
 */
async function buildSshWorkspaceFileIndex(
  context: SshRemoteExecutionContext,
): Promise<CachedWorkspaceFileIndex | null> {
  // 非 POSIX 远端（例如 Windows OpenSSH 的 `C:\...` home）无法用 POSIX find，
  // 直接按「无索引」处理。
  if (!context.baseDir.startsWith('/')) {
    console.warn(
      `[ssh-workspace-file-index] 远端工作目录不是 POSIX 绝对路径，跳过远端索引：${context.baseDir}`,
    );
    return null;
  }

  const command = `cd ${shellQuote(context.baseDir)} && ${buildRemoteFindCommand()}`;
  let stdout: string;
  let stdoutTruncated = false;
  try {
    const result = await context.proxy.execCommand(command, {
      timeoutMs: SSH_FILE_INDEX_FIND_TIMEOUT_MS,
    });
    if (result.timedOut || result.exitCode !== 0) {
      const detail = result.timedOut ? 'timeout' : `exit ${result.exitCode}`;
      console.warn(
        `[ssh-workspace-file-index] 远端 find 执行失败（${detail}），返回空索引：${context.baseDir}`,
      );
      return null;
    }
    stdout = result.stdout;
    stdoutTruncated = result.stdoutTruncated === true;
  } catch (error) {
    console.warn(
      '[ssh-workspace-file-index] 远端 find 执行异常，返回空索引：',
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }

  const lines = stdout.split('\n');
  // 传输层截断时尾部可能是不完整的一行：丢弃它，否则会产出伪条目。
  if (stdoutTruncated) lines.pop();

  const relativePaths: string[] = [];
  for (const line of lines) {
    const relativePath = parseRemoteFindLine(line);
    if (relativePath !== null) relativePaths.push(relativePath);
  }

  const { files, directories } = buildWorkspaceFileIndexEntries(relativePaths);
  return {
    rootPath: context.baseDir,
    files,
    directories,
    // `head` 截断到上限即视为可能被截断：无法区分「恰好 N 个」与「超过 N 个」；
    // 传输层截断同样强制标记，避免把部分索引报成完整。
    truncated: stdoutTruncated || relativePaths.length >= WORKSPACE_FILE_INDEX_DEFAULT_MAX_ENTRIES,
    builtAt: Date.now(),
  };
}

/** TTL 内复用缓存，过期或未命中则远端重建，并按 `builtAt` 淘汰最旧条目。 */
async function getSshWorkspaceFileIndex(
  context: SshRemoteExecutionContext,
): Promise<CachedWorkspaceFileIndex | null> {
  const cacheKey = sshFileIndexCacheKey(context.connectionId, context.baseDir);
  const now = Date.now();
  const cached = sshFileIndexCache.get(cacheKey);
  if (cached && now - cached.builtAt < WORKSPACE_FILE_INDEX_CACHE_TTL_MS) {
    return cached;
  }

  // 冷构建期间合并并发请求：同一个 key 只跑一次远端 find。TTL 缓存也就在
  // 这个 chain 里写，失败（null）不落缓存，下一次请求仍会重试。
  const inFlight = sshFileIndexInFlight.get(cacheKey);
  if (inFlight) return inFlight;

  const pending = buildSshWorkspaceFileIndex(context)
    .then((built) => {
      if (built) {
        sshFileIndexCache.set(cacheKey, built);
        evictOldestSshIndexes();
      }
      return built;
    })
    .finally(() => {
      sshFileIndexInFlight.delete(cacheKey);
    });
  sshFileIndexInFlight.set(cacheKey, pending);
  return pending;
}

/**
 * 在远端索引上检索：返回相对 `context.baseDir` 的文件与目录，排序复用本地
 * `searchWorkspaceFileIndex`。索引不可用时返回空结果（`truncated: false`）。
 */
export async function searchSshWorkspaceFileIndex(input: {
  context: SshRemoteExecutionContext;
  query: string;
  limit: number;
}): Promise<SshWorkspaceSearchResult> {
  const { context, query, limit } = input;
  const index = await getSshWorkspaceFileIndex(context);
  if (!index) {
    return { root: context.baseDir, files: [], directories: [], truncated: false, count: 0 };
  }

  const { files, directories } = searchWorkspaceFileIndex({ index, query, limit });
  return {
    root: context.baseDir,
    files: [...files],
    directories: [...directories],
    truncated: index.truncated,
    count: files.length + directories.length,
  };
}

/**
 * 失效 `sessionId`（沿父链解析到的绑定会话）对应连接下的全部远端索引。
 *
 * 未绑定 SSH / 无 service 时静默跳过；任何失败都不得影响工具执行，故内部吞错。
 */
export function invalidateSshWorkspaceFileIndexForSession(sessionId: string): void {
  try {
    const boundSessionId = resolveSshBoundSessionId(sessionId);
    if (!boundSessionId) return;
    const connectionId = peekSshService()?.getBindings().getConnectionId(boundSessionId);
    if (!connectionId) return;

    const prefix = `${connectionId}\u0000`;
    for (const key of [...sshFileIndexCache.keys()]) {
      if (key.startsWith(prefix)) sshFileIndexCache.delete(key);
    }
  } catch (error) {
    console.warn(
      '[ssh-workspace-file-index] 失效 SSH 文件索引失败，已忽略：',
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function resetSshWorkspaceFileIndexCacheForTest(): void {
  sshFileIndexCache.clear();
  sshFileIndexInFlight.clear();
}
