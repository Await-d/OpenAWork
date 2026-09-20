import { promises as fsp, type Dirent, type Stats } from 'node:fs';
import { join, resolve } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { JwtPayload } from '../infra/auth.js';
import { requireAuth } from '../infra/auth.js';
import { ApiError } from '../infra/error-response.js';
import { parseBody, parseQuery } from '../infra/parse-request.js';
import { createSSHToolProxy, defaultIgnoreManager } from '@openAwork/agent-core';
import {
  WORKSPACE_ACCESS_MODE,
  WORKSPACE_ACCESS_RESTRICTED,
  WORKSPACE_BROWSER_ROOT,
  WORKSPACE_ROOT,
  WORKSPACE_ROOTS,
} from '../infra/db.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import {
  assertWorkspacePathSupportedByCurrentHost,
  isWorkspaceAbsolutePath,
  validateWorkspacePath,
  validateWorkspaceRelativePath,
  isPathWithinRoot,
  isSamePath,
} from '../workspace/workspace-paths.js';
import {
  resolveWorkspaceEntryPathForRequest,
  ensureIgnoreRulesLoadedForPath,
  getSessionWorkingDirectoryForUser,
  resolveWorkspaceRootForPath,
} from '../workspace/workspace-safety.js';
import {
  getWorkspaceFileIndex,
  getWorkspaceFileIndexVersion,
  getWorkspaceIgnoreManager,
  invalidateWorkspaceFileIndex,
} from '../workspace/workspace-file-index.js';
import {
  searchWorkspaceFileIndex,
  WORKSPACE_FILE_SEARCH_DEFAULT_LIMIT,
  WORKSPACE_FILE_SEARCH_MAX_LIMIT,
} from '../workspace/workspace-file-search.js';
import {
  resolveRemotePath,
  resolveSshRemoteExecutionContext,
  type SshRemoteExecutionContext,
} from '../tools/ssh-remote-execution.js';
import { searchSshWorkspaceFileIndex } from '../workspace/ssh-workspace-file-index.js';
import {
  classifySshPreviewError,
  contentTypeForPath,
  isRemotePathWithinRoot,
  readRemoteBinaryFile,
  readRemoteTextFile,
  resolveSshPreviewContext,
  type SshPreviewResolution,
} from '../workspace/ssh-workspace-preview.js';
import { getSshService } from '../ssh/ssh-service.js';
import { requireOwnedSshSession } from '../ssh/ssh-session-ownership.js';
import { normalizeSshRemoteWorkingDirectory } from '../session/session-workspace-metadata.js';
import { isPathInUserAllowlist } from '../workspace/user-workspace-allowlist.js';
import { createWorkspaceRequestThrottle } from '../workspace/workspace-request-throttle.js';
import {
  getWorkspaceReviewDiff,
  listWorkspaceReviewChanges,
  revertWorkspaceReviewPath,
} from '../workspace/workspace-review.js';

/**
 * Reject workspace operations that target a path outside the user's
 * registered workspace set. Used as a second-level check on top of
 * `validateWorkspacePath` (which only enforces the global
 * `WORKSPACE_ROOTS` whitelist) to prevent one logged-in user from
 * reading another user's project just because both happen to live
 * under the same root. Returns true when access is allowed.
 */
function checkUserWorkspaceAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  safePath: string,
): boolean {
  // In unrestricted mode the global WORKSPACE_ROOTS check (via
  // validateWorkspacePath) is sufficient — the per-user allowlist
  // only makes sense when access IS restricted and multiple users
  // share the same root.
  if (!WORKSPACE_ACCESS_RESTRICTED) {
    return true;
  }
  const user = request.user as JwtPayload | undefined;
  if (!user?.sub) {
    reply.status(401).send({ error: '未授权或登录已失效。' });
    return false;
  }
  if (!isPathInUserAllowlist(user.sub, safePath)) {
    reply.status(403).send({ error: WORKSPACE_ERROR_MESSAGES.userWorkspaceForbidden });
    return false;
  }
  return true;
}

interface FileTreeNode {
  path: string;
  name: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
}

const WORKSPACE_ERROR_MESSAGES = {
  forbiddenPath: '工作区路径不在允许范围内。',
  forbiddenWorkspaceRoot: '指定的工作区根目录不在允许范围内。',
  pathOutsideWorkspace: '目标路径超出当前工作区范围。',
  forbiddenByIgnoreRules: '目标路径已被工作区忽略规则拦截。',
  workspaceRootOperationForbidden: '不能直接操作工作区根目录。',
  sessionWorkspaceUnavailable: '当前会话未绑定工作区或工作区不可用。',
  userWorkspaceForbidden: '当前账号无权访问该工作区路径。',
  pathNotDirectory: '目标路径不是文件夹。',
  pathDoesNotExist: '目标路径不存在。',
  fileNotFound: '目标文件不存在。',
  pathNotFile: '目标路径不是文件。',
  fileTooLargeForPreview: '文件体积超过预览限制，暂不支持预览。',
  fileWriteFailed: '写入文件失败。',
  parentDirectoryInvalid: '父目录无效。',
  parentDirectoryNotFound: '父目录不存在。',
  fileAlreadyExists: '目标文件已存在。',
  targetPathIsDirectory: '目标路径是文件夹，无法创建文件。',
  createFileFailed: '创建文件失败。',
  directoryAlreadyExists: '目标文件夹已存在。',
  createDirectoryFailed: '创建文件夹失败。',
  renameFailed: '重命名/移动文件失败。',
  deleteFailed: '删除文件或目录失败。',
  invalidReviewFilePath: '目标文件路径无效。',
  searchRateLimited: '文件搜索请求过于频繁，请稍后再试。',
} as const;

const IGNORED = new Set(['node_modules', '.git', 'dist', '.next', '__pycache__', '.DS_Store']);
const MAX_ENTRIES = 500;
const MAX_DEPTH = 4;
const MAX_FILE_BYTES = 100 * 1024;
const MAX_SEARCH_RESULTS = 50;
const MAX_SEARCH_FILE_BYTES = 512 * 1024;

/**
 * Sliding-window budget for `GET /workspace/files/search`, keyed per
 * authenticated user + resolved workspace root. The web client debounces mention
 * lookups by 120ms, so a fast typist can reach ~300 requests/min; the budget is
 * set well above that to avoid throttling normal typing, while still bounding an
 * authenticated flood (each request can force one full workspace walk).
 */
export const WORKSPACE_FILE_SEARCH_RATE_LIMIT = 600;
export const WORKSPACE_FILE_SEARCH_RATE_WINDOW_MS = 60_000;

/**
 * Shared in-process throttle for the file-search endpoint. Exported so tests
 * can reset the state (`workspaceFileSearchThrottle.reset()`) instead of
 * leaking budget between suites.
 */
export const workspaceFileSearchThrottle = createWorkspaceRequestThrottle({
  limit: WORKSPACE_FILE_SEARCH_RATE_LIMIT,
  windowMs: WORKSPACE_FILE_SEARCH_RATE_WINDOW_MS,
});

function assertWorkspacePathSupportedByRequestHost(path: string): void {
  if (!isWorkspaceAbsolutePath(path)) {
    return;
  }

  try {
    assertWorkspacePathSupportedByCurrentHost(path);
  } catch (error) {
    throw ApiError.badRequest(
      error instanceof Error ? error.message : '当前设备无法访问该工作区路径。',
    );
  }
}

function validateWorkspacePathForRequest(path: string): string | null {
  assertWorkspacePathSupportedByRequestHost(path);
  return validateWorkspacePath(path);
}

async function readTree(
  dirPath: string,
  depth: number,
  counter: { count: number },
): Promise<FileTreeNode[]> {
  if (depth <= 0 || counter.count >= MAX_ENTRIES) return [];

  let entries: Dirent[];
  try {
    entries = await fsp.readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const nodes: FileTreeNode[] = [];

  for (const entry of entries) {
    if (IGNORED.has(entry.name)) continue;
    if (counter.count >= MAX_ENTRIES) break;

    const fullPath = join(dirPath, entry.name);
    if (defaultIgnoreManager.shouldIgnore(fullPath)) continue;
    const isDirectory = entry.isDirectory();
    counter.count++;

    const node: FileTreeNode = {
      path: fullPath,
      name: entry.name,
      type: isDirectory ? 'directory' : 'file',
    };

    if (isDirectory) {
      node.children = await readTree(fullPath, depth - 1, counter);
    }

    nodes.push(node);
  }

  return nodes.sort((left, right) => {
    if (left.type === right.type) return left.name.localeCompare(right.name);
    return left.type === 'directory' ? -1 : 1;
  });
}

function resolveScopedWorkspacePath(input: {
  path: string;
  sessionId?: string;
  userId: string;
  workspaceRoot?: string;
}): { safePath: string | null; scopeRoot: string | null; missingSessionWorkspace: boolean } {
  if (input.sessionId) {
    const scopeRoot = getSessionWorkingDirectoryForUser(input.sessionId, input.userId);
    if (!scopeRoot) {
      return { safePath: null, scopeRoot: null, missingSessionWorkspace: true };
    }
    assertWorkspacePathSupportedByRequestHost(scopeRoot);
    assertWorkspacePathSupportedByRequestHost(input.path);
    return {
      safePath: resolveWorkspaceEntryPathForRequest({
        path: input.path,
        sessionId: input.sessionId,
        userId: input.userId,
      }),
      scopeRoot,
      missingSessionWorkspace: false,
    };
  }

  assertWorkspacePathSupportedByRequestHost(input.path);
  const scopeRoot = input.workspaceRoot
    ? validateWorkspacePathForRequest(input.workspaceRoot)
    : null;
  return {
    safePath: resolveWorkspaceEntryPathForRequest({
      path: input.path,
      userId: input.userId,
      workspaceRoot: input.workspaceRoot,
    }),
    scopeRoot,
    missingSessionWorkspace: false,
  };
}

export async function workspaceRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/workspace/root',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'workspace.root.get');
      const roots = WORKSPACE_ACCESS_RESTRICTED ? WORKSPACE_ROOTS : [WORKSPACE_BROWSER_ROOT];
      const root = WORKSPACE_ACCESS_RESTRICTED ? WORKSPACE_ROOT : WORKSPACE_BROWSER_ROOT;
      step.succeed(undefined, {
        mode: WORKSPACE_ACCESS_MODE,
        restricted: WORKSPACE_ACCESS_RESTRICTED,
        roots: roots.length,
      });
      return reply.send({
        accessMode: WORKSPACE_ACCESS_MODE,
        restricted: WORKSPACE_ACCESS_RESTRICTED,
        root,
        roots,
      });
    },
  );

  app.get(
    '/workspace/validate',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'workspace.validate');
      const schema = z.object({ path: z.string() });

      const parseStep = child('parse-query');
      const parsed = parseQuery(schema, request.query);
      parseStep.succeed();

      const pathStep = child('path-safety');
      const safePath = validateWorkspacePathForRequest(parsed.path);
      if (!safePath) {
        pathStep.fail('forbidden path');
        step.fail('forbidden path');
        return reply.status(403).send({
          valid: false,
          path: parsed.path,
          error: WORKSPACE_ERROR_MESSAGES.forbiddenPath,
        });
      }
      pathStep.succeed();
      if (!checkUserWorkspaceAccess(request, reply, safePath)) return;
      await ensureIgnoreRulesLoadedForPath(safePath);
      if (defaultIgnoreManager.shouldIgnore(safePath)) {
        step.fail('ignored path');
        return reply.status(403).send({
          valid: false,
          path: safePath,
          error: WORKSPACE_ERROR_MESSAGES.forbiddenByIgnoreRules,
        });
      }
      await ensureIgnoreRulesLoadedForPath(safePath);

      const statStep = child('stat');
      try {
        const stat = await fsp.stat(safePath);
        if (!stat.isDirectory()) {
          statStep.fail('not a directory');
          step.succeed(undefined, { valid: false });
          return reply.send({
            valid: false,
            path: safePath,
            error: WORKSPACE_ERROR_MESSAGES.pathNotDirectory,
          });
        }
        statStep.succeed(undefined, { isDirectory: true });
        step.succeed(undefined, { valid: true });
        return reply.send({ valid: true, path: safePath });
      } catch {
        statStep.fail('path does not exist');
        step.succeed(undefined, { valid: false });
        return reply.send({
          valid: false,
          path: safePath,
          error: WORKSPACE_ERROR_MESSAGES.pathDoesNotExist,
        });
      }
    },
  );

  app.get(
    '/workspace/tree',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'workspace.tree');
      const schema = z.object({
        path: z.string(),
        depth: z.coerce.number().int().min(1).max(MAX_DEPTH).default(2),
      });

      const parseStep = child('parse-query');
      const parsed = parseQuery(schema, request.query);
      parseStep.succeed(undefined, { depth: parsed.depth });

      const pathStep = child('path-safety');
      const safePath = validateWorkspacePathForRequest(parsed.path);
      if (!safePath) {
        pathStep.fail('forbidden path');
        step.fail('forbidden path');
        return reply.status(403).send({
          nodes: [],
          error: WORKSPACE_ERROR_MESSAGES.forbiddenPath,
        });
      }
      pathStep.succeed();
      if (!checkUserWorkspaceAccess(request, reply, safePath)) return;
      await ensureIgnoreRulesLoadedForPath(safePath);
      if (defaultIgnoreManager.shouldIgnore(safePath)) {
        step.fail('ignored path');
        return reply.status(403).send({
          nodes: [],
          error: WORKSPACE_ERROR_MESSAGES.forbiddenByIgnoreRules,
        });
      }
      await ensureIgnoreRulesLoadedForPath(safePath);

      const statStep = child('stat');
      try {
        const stat = await fsp.stat(safePath);
        if (!stat.isDirectory()) {
          statStep.fail('not a directory');
          step.fail('not a directory');
          return reply.status(400).send({
            nodes: [],
            error: WORKSPACE_ERROR_MESSAGES.pathNotDirectory,
          });
        }
        statStep.succeed(undefined, { isDirectory: true });
      } catch {
        statStep.fail('path not found');
        step.fail('path not found');
        return reply.status(404).send({
          nodes: [],
          error: WORKSPACE_ERROR_MESSAGES.pathDoesNotExist,
        });
      }

      const readStep = child('read-tree', undefined, {
        depth: parsed.depth,
        maxDepth: MAX_DEPTH,
        maxEntries: MAX_ENTRIES,
      });
      const counter = { count: 0 };
      const nodes = await readTree(safePath, parsed.depth, counter);
      readStep.succeed(undefined, { returnedNodes: nodes.length, visitedEntries: counter.count });
      step.succeed(undefined, { returnedNodes: nodes.length, visitedEntries: counter.count });

      return reply.send({ nodes });
    },
  );

  /**
   * GET /workspace/files/search?path=&q=&limit=
   *
   * 在缓存索引上做服务端检索，服务端分开返回 `files` 与 `directories`：
   * 浏览模式（`q` 为空或带 `/`）目录在前、再按片段排序；搜索模式按相关性
   * 排序（精确 > 前缀 > 子串 > 路径子串），同分时文件优先、浅层优先。
   * UI 负责先渲染目录行再渲染文件行。只返回相对路径。
   */
  app.get(
    '/workspace/files/search',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'workspace.files.search');
      const user = request.user as JwtPayload;
      const schema = z.object({
        path: z.string(),
        q: z.string().max(200).optional(),
        limit: z.coerce.number().int().min(1).max(WORKSPACE_FILE_SEARCH_MAX_LIMIT).optional(),
        sessionId: z.string().min(1).optional(),
        sshConnectionId: z.string().min(1).optional(),
      });

      const parseStep = child('parse-query');
      const parsed = parseQuery(schema, request.query);
      const query = parsed.q ?? '';
      const limit = parsed.limit ?? WORKSPACE_FILE_SEARCH_DEFAULT_LIMIT;
      parseStep.succeed(undefined, { query, limit });

      // SSH 绑定会话：在远端索引上检索，必须早于任何本地路径校验返回，否则
      // Windows 网关会把远端 POSIX 工作区误判为跨主机路径而抛错。
      if (parsed.sessionId) {
        // 先解析 SSH 绑定：客户端现在对每个会话都带 sessionId（含本地会话）。
        // 只有确认是 SSH 绑定会话时做归属校验；未绑定的（unbound）他人 / 本地
        // 会话继续走本地逻辑，不再被误判为越权 SSH 会话。
        const resolution = await resolveSshRemoteExecutionContext(parsed.sessionId);
        if (resolution.kind !== 'unbound') {
          // sessionId 完全由客户端提供，而远端解析器读 `sessions` 行时不带用户
          // 过滤、绑定注册表又是全局的：不先做归属校验，任何登录用户都能借他人
          // 的 SSH 绑定会话读到对方的远端工作区列表。
          try {
            requireOwnedSshSession(user.sub, parsed.sessionId);
          } catch {
            step.fail('session forbidden');
            return reply.status(404).send({
              files: [],
              directories: [],
              truncated: false,
              error: '会话不存在或无权访问。',
            });
          }
          if (resolution.kind === 'unavailable') {
            const reasonLabel =
              resolution.reason === 'error' ? '连接失败（error）' : '未连接（disconnected）';
            step.fail('ssh unavailable');
            return reply.status(409).send({
              files: [],
              directories: [],
              truncated: false,
              error: `会话绑定的 SSH 连接 ${resolution.hostLabel} 当前不可用：${reasonLabel}，无法检索远程工作区文件。请先在设置 → 开发者工具 → SSH 远程连接中恢复该连接后重试。`,
            });
          }
          // 远端索引构建前先扣限流预算：冷启动会执行一次远端 find，被拒绝的
          // 请求绝不能触发它。键按连接 + 远端根隔离，与本地根互不干扰。
          const sshStep = child('ssh-search', undefined, {
            connectionId: resolution.context.connectionId,
          });
          const sshThrottleKey = `${user.sub}::ssh:${resolution.context.connectionId}:${resolution.context.baseDir}`;
          const decision = workspaceFileSearchThrottle.tryConsume(sshThrottleKey);
          if (!decision.allowed) {
            sshStep.fail('rate limited');
            step.fail('rate limited');
            return reply
              .status(429)
              .header('Retry-After', String(Math.ceil(decision.retryAfterMs / 1000)))
              .send({
                files: [],
                directories: [],
                truncated: false,
                error: WORKSPACE_ERROR_MESSAGES.searchRateLimited,
              });
          }

          // 忽略客户端 path：远端检索根一律取服务端解析出的 baseDir。
          const result = await searchSshWorkspaceFileIndex({
            context: resolution.context,
            query,
            limit,
          });
          sshStep.succeed(undefined, {
            returnedFiles: result.files.length,
            returnedDirectories: result.directories.length,
          });
          step.succeed(undefined, {
            returnedFiles: result.files.length,
            returnedDirectories: result.directories.length,
          });
          return reply.send({
            root: result.root,
            query,
            files: result.files,
            directories: result.directories,
            truncated: result.truncated,
            count: result.count,
          });
        }
        // `unbound`：会话未绑定 SSH，继续走本地逻辑。
      }

      // 草稿会话（尚无 sessionId）直接指定 SSH 连接 + 远端绝对路径检索。
      if (!parsed.sessionId && parsed.sshConnectionId) {
        const service = getSshService();
        const connection = service.getConnection(user.sub, parsed.sshConnectionId);
        if (!connection) {
          throw ApiError.badRequest('SSH 连接不存在或无权访问。');
        }
        // 草稿会话没有 sessionId，连接状态只能直接读连接本身；断线/连接中时
        // 若静默返回空 200，前端会误以为「远端工作区就是空的」。
        if (connection.status !== 'connected') {
          const statusLabel =
            connection.status === 'error'
              ? '连接失败（error）'
              : connection.status === 'connecting'
                ? '连接中（connecting）'
                : '未连接（disconnected）';
          step.fail('ssh unavailable');
          return reply.status(409).send({
            files: [],
            directories: [],
            truncated: false,
            error: `SSH 连接 ${connection.username}@${connection.host}:${connection.port} 当前不可用：${statusLabel}，无法检索远程工作区文件。请先在设置 → 开发者工具 → SSH 远程连接中恢复该连接后重试。`,
          });
        }
        const remotePath = normalizeSshRemoteWorkingDirectory(parsed.path);
        if (!remotePath || !remotePath.startsWith('/')) {
          throw ApiError.badRequest('SSH 远程工作区路径必须是绝对 POSIX 路径。');
        }

        const sshStep = child('ssh-search', undefined, { connectionId: parsed.sshConnectionId });
        const sshThrottleKey = `${user.sub}::ssh:${parsed.sshConnectionId}:${remotePath}`;
        const decision = workspaceFileSearchThrottle.tryConsume(sshThrottleKey);
        if (!decision.allowed) {
          sshStep.fail('rate limited');
          step.fail('rate limited');
          return reply
            .status(429)
            .header('Retry-After', String(Math.ceil(decision.retryAfterMs / 1000)))
            .send({
              files: [],
              directories: [],
              truncated: false,
              error: WORKSPACE_ERROR_MESSAGES.searchRateLimited,
            });
        }

        const context: SshRemoteExecutionContext = {
          sessionId: '',
          boundSessionId: '',
          connectionId: parsed.sshConnectionId,
          host: connection.host,
          username: connection.username,
          port: connection.port,
          baseDir: remotePath,
          proxy: createSSHToolProxy(service.getManager(), parsed.sshConnectionId),
        };
        const result = await searchSshWorkspaceFileIndex({ context, query, limit });
        sshStep.succeed(undefined, {
          returnedFiles: result.files.length,
          returnedDirectories: result.directories.length,
        });
        step.succeed(undefined, {
          returnedFiles: result.files.length,
          returnedDirectories: result.directories.length,
        });
        return reply.send({
          root: result.root,
          query,
          files: result.files,
          directories: result.directories,
          truncated: result.truncated,
          count: result.count,
        });
      }

      const pathStep = child('path-safety');
      const safePath = validateWorkspacePathForRequest(parsed.path);
      if (!safePath) {
        pathStep.fail('forbidden path');
        step.fail('forbidden path');
        return reply.status(403).send({
          files: [],
          directories: [],
          truncated: false,
          error: WORKSPACE_ERROR_MESSAGES.forbiddenPath,
        });
      }
      pathStep.succeed();
      if (!checkUserWorkspaceAccess(request, reply, safePath)) return;
      const ignoreRoot = resolveWorkspaceRootForPath(safePath);
      const ignoreRules = await getWorkspaceIgnoreManager(ignoreRoot);
      if (ignoreRules.shouldIgnore(safePath)) {
        step.fail('ignored path');
        return reply.status(403).send({
          files: [],
          directories: [],
          truncated: false,
          error: WORKSPACE_ERROR_MESSAGES.forbiddenByIgnoreRules,
        });
      }

      // Rate guard must run BEFORE `getWorkspaceFileIndex`: a cache miss walks
      // the whole workspace, so a rejected request must never start one.
      const throttleKey = `${user.sub}::${ignoreRoot}`;
      const decision = workspaceFileSearchThrottle.tryConsume(throttleKey);
      if (!decision.allowed) {
        step.fail('rate limited');
        return reply
          .status(429)
          .header('Retry-After', String(Math.ceil(decision.retryAfterMs / 1000)))
          .send({
            files: [],
            directories: [],
            truncated: false,
            error: WORKSPACE_ERROR_MESSAGES.searchRateLimited,
          });
      }

      const statStep = child('stat');
      try {
        const stat = await fsp.stat(safePath);
        if (!stat.isDirectory()) {
          statStep.fail('not a directory');
          step.fail('not a directory');
          return reply.status(400).send({
            files: [],
            directories: [],
            truncated: false,
            error: WORKSPACE_ERROR_MESSAGES.pathNotDirectory,
          });
        }
        statStep.succeed(undefined, { isDirectory: true });
      } catch {
        statStep.fail('path not found');
        step.fail('path not found');
        return reply.status(404).send({
          files: [],
          directories: [],
          truncated: false,
          error: WORKSPACE_ERROR_MESSAGES.pathDoesNotExist,
        });
      }

      const searchStep = child('search-files', undefined, { limit });
      const index = await getWorkspaceFileIndex({ rootPath: safePath, ignoreRoot });
      const { files, directories } = searchWorkspaceFileIndex({ index, query, limit });
      searchStep.succeed(undefined, {
        returnedFiles: files.length,
        returnedDirectories: directories.length,
        indexedFiles: index.files.length,
      });
      step.succeed(undefined, {
        returnedFiles: files.length,
        returnedDirectories: directories.length,
      });

      return reply.send({
        root: safePath,
        query,
        files,
        directories,
        truncated: index.truncated,
        count: files.length + directories.length,
      });
    },
  );

  /**
   * GET /workspace/files/index-version?path=
   *
   * 只读、O(1) 的工作区文件索引「版本」查询：前端内置浏览器预览轮询它来判断
   * 工作区文件是否变化（Agent 写盘 / 用户保存都会让版本前进），变化时刷新预览。
   *
   * 与 `/workspace/files/search` 不同：这里**不触发**索引构建，也不占用文件索引
   * 全量扫描的限流预算——只读一个进程内计数器，代价恒定。
   */
  app.get(
    '/workspace/files/index-version',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'workspace.files.index-version');
      const schema = z.object({ path: z.string() });

      const parseStep = child('parse-query');
      const parsed = parseQuery(schema, request.query);
      parseStep.succeed();

      const pathStep = child('path-safety');
      const safePath = validateWorkspacePathForRequest(parsed.path);
      if (!safePath) {
        pathStep.fail('forbidden path');
        step.fail('forbidden path');
        return reply.status(403).send({ error: WORKSPACE_ERROR_MESSAGES.forbiddenPath });
      }
      pathStep.succeed();
      if (!checkUserWorkspaceAccess(request, reply, safePath)) return;

      const version = getWorkspaceFileIndexVersion(safePath);
      step.succeed(undefined, { version });
      return reply.send({ root: safePath, version });
    },
  );

  app.get(
    '/workspace/file',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'workspace.file.get');
      const user = request.user as JwtPayload;
      const schema = z.object({
        path: z.string(),
        // Optional caller-supplied workspace boundary. When present
        // the requested file MUST live under this root, not just
        // under any allowed WORKSPACE_ROOT. Front-end callers should
        // always supply the user's active workspace root so opening
        // a file in chat / file tree / search hit can never leak a
        // file from a sibling project that the same login also
        // happens to own. The server still applies its own root
        // safety check on top, so a client that omits this parameter
        // (e.g. legacy code paths) keeps working.
        workspaceRoot: z.string().optional(),
        // SSH 远端读取标识：任一存在时在本地路径校验之前解析远端上下文并
        // 直接返回，避免 Windows 网关把远端 POSIX 路径误判为跨主机路径。
        sessionId: z.string().min(1).optional(),
        sshConnectionId: z.string().min(1).optional(),
      });

      const parseStep = child('parse-query');
      const parsed = parseQuery(schema, request.query);
      parseStep.succeed();

      // SSH 绑定会话（sessionId）或草稿会话（sshConnectionId + 远端根）：
      // 必须早于任何本地路径校验返回，本分支不触碰 checkUserWorkspaceAccess /
      // ignore 规则 / validateWorkspacePathForRequest。
      if (parsed.sessionId !== undefined || parsed.sshConnectionId !== undefined) {
        const sshStep = child('ssh-preview', undefined, {
          hasSession: parsed.sessionId !== undefined,
          hasConnection: parsed.sshConnectionId !== undefined,
        });
        let resolution: SshPreviewResolution;
        try {
          resolution = await resolveSshPreviewContext({
            user: user.sub,
            ...(parsed.sessionId !== undefined ? { sessionId: parsed.sessionId } : {}),
            ...(parsed.sshConnectionId !== undefined
              ? { sshConnectionId: parsed.sshConnectionId }
              : {}),
            ...(parsed.workspaceRoot !== undefined ? { workspaceRoot: parsed.workspaceRoot } : {}),
          });
        } catch (error) {
          const previewError = classifySshPreviewError(error);
          sshStep.fail(previewError.message);
          step.fail(previewError.message);
          return reply.status(previewError.statusCode).send({ error: previewError.message });
        }

        if (resolution.kind === 'ready') {
          const remotePath = resolveRemotePath(resolution.context, parsed.path);
          if (!isRemotePathWithinRoot(remotePath, resolution.context.baseDir)) {
            sshStep.fail('path outside remote workspace');
            step.fail('path outside remote workspace');
            return reply.status(403).send({ error: '目标路径超出当前工作区范围。' });
          }
          try {
            const file = await readRemoteTextFile(resolution.context, remotePath, MAX_FILE_BYTES);
            sshStep.succeed(undefined, { truncated: file.truncated });
            step.succeed(undefined, { truncated: file.truncated });
            return reply.send({
              path: file.path,
              content: file.content,
              truncated: file.truncated,
            });
          } catch (error) {
            const previewError = classifySshPreviewError(error);
            sshStep.fail(previewError.message);
            step.fail(previewError.message);
            return reply.status(previewError.statusCode).send({ error: previewError.message });
          }
        }
        // `local`：会话未绑定 SSH，继续走本地逻辑。
      }

      const pathStep = child('path-safety');
      const safePath = validateWorkspacePathForRequest(parsed.path);
      if (!safePath) {
        pathStep.fail('forbidden path');
        step.fail('forbidden path');
        return reply.status(403).send({ error: WORKSPACE_ERROR_MESSAGES.forbiddenPath });
      }
      // Caller-supplied root narrows the safe set to that one root.
      // We resolve + validate the root the same way so a malformed /
      // non-workspace root is rejected before being used for the
      // prefix check.
      if (parsed.workspaceRoot !== undefined) {
        const safeRoot = validateWorkspacePathForRequest(parsed.workspaceRoot);
        if (!safeRoot) {
          pathStep.fail('forbidden workspace root');
          step.fail('forbidden workspace root');
          return reply.status(403).send({ error: WORKSPACE_ERROR_MESSAGES.forbiddenWorkspaceRoot });
        }
        if (!isPathWithinRoot(safePath, safeRoot)) {
          pathStep.fail('path outside workspace root');
          step.fail('path outside workspace root');
          return reply.status(403).send({ error: WORKSPACE_ERROR_MESSAGES.pathOutsideWorkspace });
        }
      }
      pathStep.succeed();
      if (!checkUserWorkspaceAccess(request, reply, safePath)) return;
      await ensureIgnoreRulesLoadedForPath(safePath);
      if (defaultIgnoreManager.shouldIgnore(safePath)) {
        step.fail('ignored path');
        return reply.status(403).send({ error: WORKSPACE_ERROR_MESSAGES.forbiddenByIgnoreRules });
      }

      const statStep = child('stat');
      let stat: Stats;
      try {
        stat = await fsp.stat(safePath);
      } catch {
        statStep.fail('file not found');
        step.fail('file not found');
        return reply.status(404).send({ error: WORKSPACE_ERROR_MESSAGES.fileNotFound });
      }

      if (!stat.isFile()) {
        statStep.fail('not a file');
        step.fail('not a file');
        return reply.status(400).send({ error: WORKSPACE_ERROR_MESSAGES.pathNotFile });
      }
      statStep.succeed(undefined, { size: stat.size });

      const truncated = stat.size > MAX_FILE_BYTES;
      const readStep = child('read', undefined, { truncated });
      const fd = await fsp.open(safePath, 'r');
      try {
        const buffer = Buffer.alloc(Math.min(stat.size, MAX_FILE_BYTES));
        await fd.read(buffer, 0, buffer.length, 0);
        const content = buffer.toString('utf8');
        readStep.succeed(undefined, { bytesRead: buffer.length, truncated });
        step.succeed(undefined, { bytesRead: buffer.length, truncated });
        return reply.send({ path: safePath, content, truncated });
      } finally {
        await fd.close();
      }
    },
  );

  /**
   * GET /workspace/file/binary?path=&workspaceRoot=
   *
   * Returns the file as raw bytes with a guessed Content-Type.
   * Distinct from /workspace/file (which utf-8-decodes into a JSON
   * string field) — needed for binary previewables like .docx,
   * .xlsx, .pdf where any decode would corrupt the bytes.
   *
   * Same workspace + user allowlist + ignore-rules safety as the
   * text endpoint. Size capped at MAX_FILE_BYTES so a malicious
   * user can't pull GB-sized files.
   */
  app.get(
    '/workspace/file/binary',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'workspace.file.get-binary');
      const user = request.user as JwtPayload;
      const schema = z.object({
        path: z.string(),
        workspaceRoot: z.string().optional(),
        sessionId: z.string().min(1).optional(),
        sshConnectionId: z.string().min(1).optional(),
      });
      const parsed = parseQuery(schema, request.query);

      if (parsed.sessionId !== undefined || parsed.sshConnectionId !== undefined) {
        const sshStep = child('ssh-preview', undefined, {
          hasSession: parsed.sessionId !== undefined,
          hasConnection: parsed.sshConnectionId !== undefined,
        });
        let resolution: SshPreviewResolution;
        try {
          resolution = await resolveSshPreviewContext({
            user: user.sub,
            ...(parsed.sessionId !== undefined ? { sessionId: parsed.sessionId } : {}),
            ...(parsed.sshConnectionId !== undefined
              ? { sshConnectionId: parsed.sshConnectionId }
              : {}),
            ...(parsed.workspaceRoot !== undefined ? { workspaceRoot: parsed.workspaceRoot } : {}),
          });
        } catch (error) {
          const previewError = classifySshPreviewError(error);
          sshStep.fail(previewError.message);
          step.fail(previewError.message);
          return reply.status(previewError.statusCode).send({ error: previewError.message });
        }

        if (resolution.kind === 'ready') {
          const remotePath = resolveRemotePath(resolution.context, parsed.path);
          if (!isRemotePathWithinRoot(remotePath, resolution.context.baseDir)) {
            sshStep.fail('path outside remote workspace');
            step.fail('path outside remote workspace');
            return reply.status(403).send({ error: '目标路径超出当前工作区范围。' });
          }
          try {
            const file = await readRemoteBinaryFile(resolution.context, remotePath, MAX_FILE_BYTES);
            sshStep.succeed(undefined, { bytesRead: file.data.length });
            step.succeed(undefined, { bytesRead: file.data.length, contentType: file.contentType });
            reply.header('Content-Type', file.contentType);
            reply.header('Content-Length', String(file.data.length));
            reply.header('Cache-Control', 'private, max-age=30');
            return reply.send(file.data);
          } catch (error) {
            const previewError = classifySshPreviewError(error);
            sshStep.fail(previewError.message);
            step.fail(previewError.message);
            return reply.status(previewError.statusCode).send({ error: previewError.message });
          }
        }
        // `local`：会话未绑定 SSH，继续走本地逻辑。
      }

      const safePath = validateWorkspacePathForRequest(parsed.path);
      if (!safePath) {
        step.fail('forbidden path');
        return reply.status(403).send({ error: WORKSPACE_ERROR_MESSAGES.forbiddenPath });
      }
      if (parsed.workspaceRoot !== undefined) {
        const safeRoot = validateWorkspacePathForRequest(parsed.workspaceRoot);
        if (!safeRoot || !isPathWithinRoot(safePath, safeRoot)) {
          step.fail('path outside workspace root');
          return reply.status(403).send({ error: WORKSPACE_ERROR_MESSAGES.pathOutsideWorkspace });
        }
      }
      if (!checkUserWorkspaceAccess(request, reply, safePath)) return;
      await ensureIgnoreRulesLoadedForPath(safePath);
      if (defaultIgnoreManager.shouldIgnore(safePath)) {
        step.fail('ignored path');
        return reply.status(403).send({ error: WORKSPACE_ERROR_MESSAGES.forbiddenByIgnoreRules });
      }

      let stat: Stats;
      try {
        stat = await fsp.stat(safePath);
      } catch {
        step.fail('file not found');
        return reply.status(404).send({ error: WORKSPACE_ERROR_MESSAGES.fileNotFound });
      }
      if (!stat.isFile()) {
        step.fail('not a file');
        return reply.status(400).send({ error: WORKSPACE_ERROR_MESSAGES.pathNotFile });
      }
      if (stat.size > MAX_FILE_BYTES) {
        step.fail('file too large');
        return reply.status(413).send({ error: WORKSPACE_ERROR_MESSAGES.fileTooLargeForPreview });
      }

      const contentType = contentTypeForPath(safePath);

      const fd = await fsp.open(safePath, 'r');
      try {
        const buffer = Buffer.alloc(stat.size);
        await fd.read(buffer, 0, buffer.length, 0);
        step.succeed(undefined, { bytesRead: buffer.length, contentType });
        reply.header('Content-Type', contentType);
        reply.header('Content-Length', String(buffer.length));
        // Cache-Control: short cache so repeated previews of the
        // same file (e.g. switching between tabs) don't re-fetch.
        reply.header('Cache-Control', 'private, max-age=30');
        return reply.send(buffer);
      } finally {
        await fd.close();
      }
    },
  );

  app.put(
    '/workspace/file',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'workspace.file.put');
      const schema = z.object({ path: z.string(), content: z.string() });

      const parseStep = child('parse-body');
      const parsed = parseBody(schema, request.body);
      parseStep.succeed();

      const pathStep = child('path-safety');
      const safePath = validateWorkspacePathForRequest(parsed.path);
      if (!safePath) {
        pathStep.fail('forbidden path');
        step.fail('forbidden path');
        return reply.status(403).send({ error: WORKSPACE_ERROR_MESSAGES.forbiddenPath });
      }
      await ensureIgnoreRulesLoadedForPath(safePath);
      pathStep.succeed();
      if (!checkUserWorkspaceAccess(request, reply, safePath)) return;

      const writeStep = child('write');
      try {
        await fsp.writeFile(safePath, parsed.content, 'utf8');
        invalidateWorkspaceFileIndex(safePath);
        writeStep.succeed(undefined, { bytes: parsed.content.length });
        step.succeed(undefined, { bytes: parsed.content.length });
        return reply.send({ success: true, path: safePath });
      } catch (err) {
        writeStep.fail(String(err));
        step.fail(String(err));
        return reply.status(500).send({ error: WORKSPACE_ERROR_MESSAGES.fileWriteFailed });
      }
    },
  );

  app.post(
    '/workspace/file',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'workspace.file.post');
      const schema = z.object({ path: z.string(), content: z.string().default('') });

      const parseStep = child('parse-body');
      const parsed = parseBody(schema, request.body);
      parseStep.succeed();

      const pathStep = child('path-safety');
      const safePath = validateWorkspacePathForRequest(parsed.path);
      if (!safePath) {
        pathStep.fail('forbidden path');
        step.fail('forbidden path');
        return reply.status(403).send({ error: WORKSPACE_ERROR_MESSAGES.forbiddenPath });
      }
      pathStep.succeed();
      if (!checkUserWorkspaceAccess(request, reply, safePath)) return;

      const parentPath = resolve(join(safePath, '..'));
      const parentStep = child('parent-directory');
      try {
        const parentStat = await fsp.stat(parentPath);
        if (!parentStat.isDirectory()) {
          parentStep.fail('parent is not a directory');
          step.fail('parent is not a directory');
          return reply.status(400).send({ error: WORKSPACE_ERROR_MESSAGES.parentDirectoryInvalid });
        }
        parentStep.succeed();
      } catch {
        parentStep.fail('parent directory not found');
        step.fail('parent directory not found');
        return reply.status(404).send({ error: WORKSPACE_ERROR_MESSAGES.parentDirectoryNotFound });
      }

      const writeStep = child('create-file');
      try {
        const handle = await fsp.open(safePath, 'wx');
        try {
          await handle.writeFile(parsed.content, 'utf8');
        } finally {
          await handle.close();
        }
        invalidateWorkspaceFileIndex(safePath);
        writeStep.succeed(undefined, { bytes: parsed.content.length });
        step.succeed(undefined, { bytes: parsed.content.length });
        return reply.send({ success: true, path: safePath });
      } catch (error) {
        if (error instanceof Error && 'code' in error) {
          const code = String(error.code);
          if (code === 'EEXIST') {
            writeStep.fail('file already exists');
            step.fail('file already exists');
            return reply.status(409).send({ error: WORKSPACE_ERROR_MESSAGES.fileAlreadyExists });
          }

          if (code === 'EISDIR') {
            writeStep.fail('path is a directory');
            step.fail('path is a directory');
            return reply
              .status(400)
              .send({ error: WORKSPACE_ERROR_MESSAGES.targetPathIsDirectory });
          }
        }

        writeStep.fail(String(error));
        step.fail(String(error));
        return reply.status(500).send({ error: WORKSPACE_ERROR_MESSAGES.createFileFailed });
      }
    },
  );

  app.post(
    '/workspace/directory',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'workspace.directory.post');
      const schema = z.object({ path: z.string() });

      const parseStep = child('parse-body');
      const parsed = parseBody(schema, request.body);
      parseStep.succeed();

      const pathStep = child('path-safety');
      const safePath = validateWorkspacePathForRequest(parsed.path);
      if (!safePath) {
        pathStep.fail('forbidden path');
        step.fail('forbidden path');
        return reply.status(403).send({ error: WORKSPACE_ERROR_MESSAGES.forbiddenPath });
      }
      pathStep.succeed();
      if (!checkUserWorkspaceAccess(request, reply, safePath)) return;

      const mkdirStep = child('mkdir');
      try {
        await fsp.mkdir(safePath);
        invalidateWorkspaceFileIndex(safePath);
        mkdirStep.succeed();
        step.succeed();
        return reply.send({ success: true, path: safePath });
      } catch (error) {
        if (error instanceof Error && 'code' in error) {
          const code = String(error.code);
          if (code === 'EEXIST') {
            mkdirStep.fail('directory already exists');
            step.fail('directory already exists');
            return reply
              .status(409)
              .send({ error: WORKSPACE_ERROR_MESSAGES.directoryAlreadyExists });
          }

          if (code === 'ENOENT') {
            mkdirStep.fail('parent directory not found');
            step.fail('parent directory not found');
            return reply
              .status(404)
              .send({ error: WORKSPACE_ERROR_MESSAGES.parentDirectoryNotFound });
          }
        }

        mkdirStep.fail(String(error));
        step.fail(String(error));
        return reply.status(500).send({ error: WORKSPACE_ERROR_MESSAGES.createDirectoryFailed });
      }
    },
  );

  app.delete(
    '/workspace/entry',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'workspace.entry.delete');
      const user = request.user as JwtPayload;
      const schema = z.object({
        path: z.string().min(1),
        sessionId: z.string().min(1).optional(),
        workspaceRoot: z.string().min(1).optional(),
      });
      const parsed = parseQuery(schema, request.query);

      const pathStep = child('path-safety');
      const { safePath, scopeRoot, missingSessionWorkspace } = resolveScopedWorkspacePath({
        path: parsed.path,
        ...(parsed.sessionId ? { sessionId: parsed.sessionId } : {}),
        userId: user.sub,
        ...(parsed.workspaceRoot ? { workspaceRoot: parsed.workspaceRoot } : {}),
      });
      if (missingSessionWorkspace) {
        pathStep.fail('session workspace unavailable');
        step.fail('session workspace unavailable');
        return reply.status(400).send({
          error: WORKSPACE_ERROR_MESSAGES.sessionWorkspaceUnavailable,
        });
      }
      if (!safePath) {
        pathStep.fail('forbidden path');
        step.fail('forbidden path');
        return reply.status(403).send({ error: WORKSPACE_ERROR_MESSAGES.forbiddenPath });
      }

      if (scopeRoot && isSamePath(safePath, scopeRoot)) {
        pathStep.fail('workspace root operation forbidden');
        step.fail('workspace root operation forbidden');
        return reply.status(400).send({
          error: WORKSPACE_ERROR_MESSAGES.workspaceRootOperationForbidden,
        });
      }

      pathStep.succeed();
      if (!checkUserWorkspaceAccess(request, reply, safePath)) return;
      await ensureIgnoreRulesLoadedForPath(safePath);
      if (defaultIgnoreManager.shouldIgnore(safePath)) {
        step.fail('ignored path');
        return reply.status(403).send({ error: WORKSPACE_ERROR_MESSAGES.forbiddenByIgnoreRules });
      }

      const statStep = child('stat');
      try {
        const stat = await fsp.stat(safePath);
        statStep.succeed(undefined, { isDirectory: stat.isDirectory(), isFile: stat.isFile() });
      } catch {
        statStep.fail('path not found');
        step.fail('path not found');
        return reply.status(404).send({ error: WORKSPACE_ERROR_MESSAGES.pathDoesNotExist });
      }

      const deleteStep = child('delete');
      try {
        await fsp.rm(safePath, { recursive: true, force: false });
        invalidateWorkspaceFileIndex(safePath);
        deleteStep.succeed();
        step.succeed(undefined, { path: safePath });
        return reply.send({ ok: true, path: safePath });
      } catch (error) {
        deleteStep.fail(String(error));
        step.fail(String(error));
        return reply.status(500).send({ error: WORKSPACE_ERROR_MESSAGES.deleteFailed });
      }
    },
  );

  app.post(
    '/workspace/rename',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'workspace.entry.rename');
      const user = request.user as JwtPayload;
      const schema = z.object({
        oldPath: z.string().min(1),
        newPath: z.string().min(1),
        sessionId: z.string().min(1).optional(),
        workspaceRoot: z.string().min(1).optional(),
      });
      const parsed = parseBody(schema, request.body);

      const pathStep = child('path-safety');
      const oldPathResolution = resolveScopedWorkspacePath({
        path: parsed.oldPath,
        ...(parsed.sessionId ? { sessionId: parsed.sessionId } : {}),
        userId: user.sub,
        ...(parsed.workspaceRoot ? { workspaceRoot: parsed.workspaceRoot } : {}),
      });
      const newPathResolution = resolveScopedWorkspacePath({
        path: parsed.newPath,
        ...(parsed.sessionId ? { sessionId: parsed.sessionId } : {}),
        userId: user.sub,
        ...(parsed.workspaceRoot ? { workspaceRoot: parsed.workspaceRoot } : {}),
      });
      const { safePath: safeOldPath, scopeRoot, missingSessionWorkspace } = oldPathResolution;
      const { safePath: safeNewPath } = newPathResolution;
      if (missingSessionWorkspace || newPathResolution.missingSessionWorkspace) {
        pathStep.fail('session workspace unavailable');
        step.fail('session workspace unavailable');
        return reply.status(400).send({
          error: WORKSPACE_ERROR_MESSAGES.sessionWorkspaceUnavailable,
        });
      }
      if (!safeOldPath || !safeNewPath) {
        pathStep.fail('forbidden path');
        step.fail('forbidden path');
        return reply.status(403).send({ error: WORKSPACE_ERROR_MESSAGES.forbiddenPath });
      }
      if (
        scopeRoot &&
        (!isPathWithinRoot(safeOldPath, scopeRoot) || !isPathWithinRoot(safeNewPath, scopeRoot))
      ) {
        pathStep.fail('path outside workspace root');
        step.fail('path outside workspace root');
        return reply.status(403).send({ error: WORKSPACE_ERROR_MESSAGES.pathOutsideWorkspace });
      }
      if (scopeRoot && (isSamePath(safeOldPath, scopeRoot) || isSamePath(safeNewPath, scopeRoot))) {
        pathStep.fail('workspace root operation forbidden');
        step.fail('workspace root operation forbidden');
        return reply.status(400).send({
          error: WORKSPACE_ERROR_MESSAGES.workspaceRootOperationForbidden,
        });
      }

      pathStep.succeed();
      if (!checkUserWorkspaceAccess(request, reply, safeOldPath)) return;
      if (!checkUserWorkspaceAccess(request, reply, safeNewPath)) return;
      await ensureIgnoreRulesLoadedForPath(safeOldPath);
      await ensureIgnoreRulesLoadedForPath(safeNewPath);
      if (
        defaultIgnoreManager.shouldIgnore(safeOldPath) ||
        defaultIgnoreManager.shouldIgnore(safeNewPath)
      ) {
        step.fail('ignored path');
        return reply.status(403).send({ error: WORKSPACE_ERROR_MESSAGES.forbiddenByIgnoreRules });
      }

      if (!isSamePath(safeOldPath, safeNewPath)) {
        const targetStep = child('target-conflict-check');
        try {
          await fsp.stat(safeNewPath);
          targetStep.fail('target already exists');
          step.fail('target already exists');
          return reply.status(409).send({ error: WORKSPACE_ERROR_MESSAGES.fileAlreadyExists });
        } catch (error) {
          if (error instanceof Error && 'code' in error && String(error.code) === 'ENOENT') {
            targetStep.succeed(undefined, { exists: false });
          } else {
            targetStep.fail(String(error));
            step.fail(String(error));
            return reply.status(500).send({ error: WORKSPACE_ERROR_MESSAGES.renameFailed });
          }
        }
      }

      const renameStep = child('rename');
      try {
        await fsp.rename(safeOldPath, safeNewPath);
        invalidateWorkspaceFileIndex(safeOldPath);
        invalidateWorkspaceFileIndex(safeNewPath);
        renameStep.succeed(undefined, { oldPath: safeOldPath, newPath: safeNewPath });
        step.succeed(undefined, { oldPath: safeOldPath, newPath: safeNewPath });
        return reply.send({ ok: true, oldPath: safeOldPath, newPath: safeNewPath });
      } catch (error) {
        if (error instanceof Error && 'code' in error) {
          const code = String(error.code);
          if (code === 'ENOENT') {
            renameStep.fail('path not found');
            step.fail('path not found');
            return reply.status(404).send({ error: WORKSPACE_ERROR_MESSAGES.pathDoesNotExist });
          }
          if (code === 'EEXIST') {
            renameStep.fail('target already exists');
            step.fail('target already exists');
            return reply.status(409).send({ error: WORKSPACE_ERROR_MESSAGES.fileAlreadyExists });
          }
        }
        renameStep.fail(String(error));
        step.fail(String(error));
        return reply.status(500).send({ error: WORKSPACE_ERROR_MESSAGES.renameFailed });
      }
    },
  );

  app.get(
    '/workspace/review/status',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'workspace.review.status');
      const schema = z.object({ path: z.string() });
      const parsed = parseQuery(schema, request.query);

      const pathStep = child('path-safety');
      const safePath = validateWorkspacePathForRequest(parsed.path);
      if (!safePath) {
        pathStep.fail('forbidden path');
        step.fail('forbidden path');
        return reply.status(403).send({
          changes: [],
          error: WORKSPACE_ERROR_MESSAGES.forbiddenPath,
        });
      }
      pathStep.succeed();
      if (!checkUserWorkspaceAccess(request, reply, safePath)) return;

      const readStep = child('list-review-changes');
      const changes = await listWorkspaceReviewChanges(safePath);
      readStep.succeed(undefined, { changes: changes.length });
      step.succeed(undefined, { changes: changes.length });
      return reply.send({ changes });
    },
  );

  app.get(
    '/workspace/review/diff',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'workspace.review.diff');
      const schema = z.object({ path: z.string(), filePath: z.string() });
      const parsed = parseQuery(schema, request.query);

      const pathStep = child('path-safety');
      const safePath = validateWorkspacePathForRequest(parsed.path);
      if (!safePath) {
        pathStep.fail('forbidden path');
        step.fail('forbidden path');
        return reply.status(403).send({
          diff: '',
          error: WORKSPACE_ERROR_MESSAGES.forbiddenPath,
        });
      }

      const relativeFilePath = validateWorkspaceRelativePath(safePath, parsed.filePath);
      if (!relativeFilePath) {
        pathStep.fail('invalid filePath');
        step.fail('invalid filePath');
        return reply.status(400).send({
          diff: '',
          error: WORKSPACE_ERROR_MESSAGES.invalidReviewFilePath,
        });
      }
      if (defaultIgnoreManager.shouldIgnore(join(safePath, relativeFilePath))) {
        step.fail('ignored path');
        return reply.status(403).send({
          diff: '',
          error: WORKSPACE_ERROR_MESSAGES.forbiddenByIgnoreRules,
        });
      }
      pathStep.succeed();
      if (!checkUserWorkspaceAccess(request, reply, safePath)) return;

      const diffStep = child('load-diff');
      const diff = await getWorkspaceReviewDiff(safePath, relativeFilePath);
      diffStep.succeed(undefined, { diffLength: diff.length });
      step.succeed(undefined, { diffLength: diff.length });
      return reply.send({ diff });
    },
  );

  app.post(
    '/workspace/review/revert',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'workspace.review.revert');
      const schema = z.object({ path: z.string(), filePath: z.string() });
      const parsed = parseBody(schema, request.body);

      const pathStep = child('path-safety');
      const safePath = validateWorkspacePathForRequest(parsed.path);
      if (!safePath) {
        pathStep.fail('forbidden path');
        step.fail('forbidden path');
        return reply.status(403).send({
          ok: false,
          error: WORKSPACE_ERROR_MESSAGES.forbiddenPath,
        });
      }
      await ensureIgnoreRulesLoadedForPath(safePath);

      const relativeFilePath = validateWorkspaceRelativePath(safePath, parsed.filePath);
      if (!relativeFilePath) {
        pathStep.fail('invalid filePath');
        step.fail('invalid filePath');
        return reply.status(400).send({
          ok: false,
          error: WORKSPACE_ERROR_MESSAGES.invalidReviewFilePath,
        });
      }
      if (defaultIgnoreManager.shouldIgnore(join(safePath, relativeFilePath))) {
        step.fail('ignored path');
        return reply.status(403).send({
          ok: false,
          error: WORKSPACE_ERROR_MESSAGES.forbiddenByIgnoreRules,
        });
      }
      pathStep.succeed();
      if (!checkUserWorkspaceAccess(request, reply, safePath)) return;

      const revertStep = child('revert');
      await revertWorkspaceReviewPath(safePath, relativeFilePath);
      invalidateWorkspaceFileIndex(join(safePath, relativeFilePath));
      revertStep.succeed(undefined, { filePath: relativeFilePath });
      step.succeed(undefined, { filePath: relativeFilePath });
      return reply.send({ ok: true });
    },
  );

  app.get(
    '/workspace/find-by-name',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Resolve a bare filename (e.g. `create_quotation.py`) to all
      // file paths under `path` whose basename matches. Distinct from
      // `/workspace/search` which is a content grep — for "user clicked
      // a filename in chat, find the actual file" we need a basename
      // lookup, not a content lookup.
      //
      // Returns up to `maxResults` matches. Callers (notably the chat
      // path-ref click handler) should prefer the shortest path among
      // exact basename matches when multiple are returned.
      const { step, child } = startRequestWorkflow(request, 'workspace.find-by-name');
      const schema = z.object({
        name: z.string().min(1),
        path: z.string(),
        maxResults: z.coerce.number().int().min(1).max(50).default(8),
      });
      const parsed = parseQuery(schema, request.query);
      const safePath = validateWorkspacePathForRequest(parsed.path);
      if (!safePath) {
        step.fail('forbidden path');
        return reply.status(403).send({
          results: [],
          error: WORKSPACE_ERROR_MESSAGES.forbiddenPath,
        });
      }
      if (!checkUserWorkspaceAccess(request, reply, safePath)) return;
      await ensureIgnoreRulesLoadedForPath(safePath);

      const { name, maxResults } = parsed;
      const results: Array<{ path: string }> = [];
      const scanStep = child('scan', undefined, { maxResults });

      async function walk(dirPath: string): Promise<void> {
        if (results.length >= maxResults) return;
        let entries: Dirent[];
        try {
          entries = await fsp.readdir(dirPath, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          if (results.length >= maxResults) break;
          if (IGNORED.has(entry.name)) continue;
          const fullPath = join(dirPath, entry.name);
          if (defaultIgnoreManager.shouldIgnore(fullPath)) continue;
          if (entry.isDirectory()) {
            await walk(fullPath);
          } else if (entry.isFile() && entry.name === name) {
            results.push({ path: fullPath });
          }
        }
      }

      await walk(safePath);
      scanStep.succeed(undefined, { results: results.length });
      step.succeed(undefined, { results: results.length });
      return reply.send({ results });
    },
  );

  app.get(
    '/workspace/search',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'workspace.search');
      const schema = z.object({
        q: z.string().min(1),
        path: z.string(),
        maxResults: z.coerce.number().int().min(1).max(MAX_SEARCH_RESULTS).default(20),
      });

      const parseStep = child('parse-query');
      const parsed = parseQuery(schema, request.query);
      parseStep.succeed(undefined, { maxResults: parsed.maxResults });

      const pathStep = child('path-safety');
      const safePath = validateWorkspacePathForRequest(parsed.path);
      if (!safePath) {
        pathStep.fail('forbidden path');
        step.fail('forbidden path');
        return reply.status(403).send({
          results: [],
          error: WORKSPACE_ERROR_MESSAGES.forbiddenPath,
        });
      }
      pathStep.succeed();
      if (!checkUserWorkspaceAccess(request, reply, safePath)) return;
      await ensureIgnoreRulesLoadedForPath(safePath);

      const { maxResults, q } = parsed;
      const results: Array<{ path: string; line: number; text: string }> = [];
      let scannedFiles = 0;
      let skippedLargeFiles = 0;

      const scanStep = child('scan', undefined, { maxResults });
      async function searchDirectory(dirPath: string): Promise<void> {
        if (results.length >= maxResults) return;

        let entries: Dirent[];
        try {
          entries = await fsp.readdir(dirPath, { withFileTypes: true });
        } catch {
          return;
        }

        for (const entry of entries) {
          if (results.length >= maxResults) break;
          if (IGNORED.has(entry.name)) continue;

          const fullPath = join(dirPath, entry.name);
          if (defaultIgnoreManager.shouldIgnore(fullPath)) continue;
          if (entry.isDirectory()) {
            await searchDirectory(fullPath);
          } else if (entry.isFile()) {
            let stat: Stats;
            try {
              stat = await fsp.stat(fullPath);
            } catch {
              continue;
            }

            scannedFiles++;
            if (stat.size > MAX_SEARCH_FILE_BYTES) {
              skippedLargeFiles++;
              continue;
            }

            let content: string;
            try {
              content = await fsp.readFile(fullPath, 'utf8');
            } catch {
              continue;
            }

            const lines = content.split('\n');
            for (let index = 0; index < lines.length && results.length < maxResults; index++) {
              if (lines[index]!.includes(q)) {
                results.push({ path: fullPath, line: index + 1, text: lines[index]!.trim() });
              }
            }
          }
        }
      }

      await searchDirectory(safePath);
      scanStep.succeed(undefined, {
        results: results.length,
        scannedFiles,
        skippedLargeFiles,
      });
      step.succeed(undefined, {
        results: results.length,
        scannedFiles,
        skippedLargeFiles,
      });

      return reply.send({ results });
    },
  );
}
