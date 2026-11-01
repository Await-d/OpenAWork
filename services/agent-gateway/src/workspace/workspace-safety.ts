import { mkdirSync, promises as fsp } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { defaultIgnoreManager } from '@openAwork/agent-core';
import {
  hasWorkspacePersistentPermission,
  loadWorkspacePermissionConfig,
  upsertWorkspacePermanentPermission,
  writeWorkspacePermissionConfig,
} from '@openAwork/agent-core';
import { createPlatformAdapter } from '@openAwork/platform-adapter';
import { WORKSPACE_ROOT, WORKSPACE_ROOTS, sqliteGet } from '../infra/db.js';
import { resolveGatewayDataDir } from '../infra/storage-paths.js';
import {
  resolveSessionWorkspacePath,
  resolveSessionWorkspaceResolution,
} from '../session/session-workspace-resolution.js';
import { parseSessionMetadataJson } from '../session/session-workspace-metadata.js';
import { getChannelActorPolicy } from '../channels/channel-actor-scope.js';
import type { ChannelPermissions } from '../channels/types.js';
import { isPathWithinSkillResources } from './skill-resource-roots.js';
import {
  assertWorkspacePathSupportedByCurrentHost,
  isPathWithinRoot,
  isWorkspaceAbsolutePath,
  resolveWorkspaceEntryPath,
  validateWorkspacePath,
} from './workspace-paths.js';

interface SessionMetadataRow {
  metadata_json: string;
  user_id: string;
}

interface SessionWorkspacePolicyRow extends SessionMetadataRow {
  role_layer: string | null;
  team_parent_session_id: string | null;
}

const ignoreLoadCache = new Map<string, Promise<void>>();
/**
 * `defaultIgnoreManager` 是进程级单例，同一时刻只持有一个 `projectRoot`。
 * 记录它当前装载的根，供 `ensureIgnoreRulesLoadedForPath` 判断是否需要重载：
 * 换根后旧的锚定 `.gitignore` 规则不再生效，按根缓存的 Promise 不能单独作数。
 */
let globalIgnoreLoadedRoot: string | null = null;

export function resolveWorkspaceRootForPath(path: string | null | undefined): string {
  if (!path) {
    return WORKSPACE_ROOT;
  }
  const normalized = resolve(path);
  const matched = [...WORKSPACE_ROOTS]
    .sort((left, right) => right.length - left.length)
    .find((root) => isPathWithinRoot(normalized, root));
  return matched ?? WORKSPACE_ROOT;
}

/**
 * 会话工作目录 + 其「语义来源」。
 *
 * `remote` 为 true 表示提供该路径的会话绑定了 SSH 连接，因此 `path` 是**远端主机
 * 上的绝对路径**：本地文件系统入口（任务图落盘、ignore 规则加载等）若直接使用它，
 * 会把远端路径当本地路径操作（曾命中 `mkdir('/.agentdocs')` → EACCES）。调用方必须
 * 先看 `remote` 再决定如何使用 `path`。
 */
export interface SessionWorkspaceResolutionInfo {
  path: string;
  remote: boolean;
}

export function getSessionWorkingDirectory(sessionId: string): string | null {
  return getSessionWorkspaceResolution(sessionId)?.path ?? null;
}

/**
 * 渠道会话未绑定工作目录时的**隐式会话边界**。
 *
 * 渠道会话默认不写 `workingDirectory`（`buildChannelSessionMetadata`），而
 * `validateSessionWorkspacePath` 的「会话工作区之外」判定要求边界非空——边界为空时
 * 整段跳过，渠道设置里配的路径类权限（`allowReadHome` / `readablePathPrefixes` /
 * `allowWriteOutside`）便形同虚设。这里把默认工作目录
 * （`resolveUnboundSessionWorkspaceFallback()`，与工具执行根同一口径）当作隐式边界：
 * 目录内照常放行，目录外需要 ACL 显式放宽，否则按 `outside-session-workspace` 拒绝。
 *
 * **只对渠道会话生效**：chat / team / task 会话「未绑定 = 不做边界判定」的既有语义不变
 * （team / task 子会话另有 `requiresBoundSessionWorkspace` 强制绑定）。
 */
function resolveImplicitChannelWorkspaceBoundary(sessionId: string): string | null {
  const row = sqliteGet<SessionMetadataRow>(
    'SELECT metadata_json, user_id FROM sessions WHERE id = ? LIMIT 1',
    [sessionId],
  );
  if (!row) {
    return null;
  }
  const metadata = parseSessionMetadataJson(row.metadata_json);
  return metadata['source'] === 'channel' ? resolveUnboundSessionWorkspaceFallback() : null;
}

export function getSessionWorkspaceResolution(
  sessionId: string,
): SessionWorkspaceResolutionInfo | null {
  const row = sqliteGet<SessionMetadataRow>(
    'SELECT metadata_json, user_id FROM sessions WHERE id = ? LIMIT 1',
    [sessionId],
  );
  if (!row) {
    return null;
  }
  // 递归解析 workingDirectory：子 session 可能没有直接设置，
  // 需要通过 DB 列 team_parent_session_id 向上查找父 session 链。
  const resolution = resolveSessionWorkspaceResolution({
    metadataJson: row.metadata_json,
    sessionId,
    userId: row.user_id,
  });
  return resolution ? { path: resolution.path, remote: resolution.remote } : null;
}

export function getSessionWorkingDirectoryForUser(
  sessionId: string,
  userId: string,
): string | null {
  const row = sqliteGet<SessionMetadataRow>(
    'SELECT metadata_json, user_id FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
    [sessionId, userId],
  );
  if (!row) {
    return null;
  }
  return resolveSessionWorkspacePath({
    metadataJson: row.metadata_json,
    sessionId,
    userId,
  });
}

export function getSessionWorkspaceRoot(sessionId: string): string | null {
  const workingDirectory = getSessionWorkingDirectory(sessionId);
  if (!workingDirectory) {
    return null;
  }
  return resolveWorkspaceRootForPath(workingDirectory);
}

/**
 * 解析「快照采集 / 快照恢复」使用的工作区根。
 *
 * 与工具执行根（`routes/stream.ts` 的 `input.workspaceRoot ?? workingDirectory ??
 * resolveUnboundSessionWorkspaceFallback()`）保持同一口径：
 *   1. 会话绑定的工作目录（含 team / task 子会话的父链继承）；
 *   2. 未绑定的 **chat** 会话 → 回退到默认工作区 `resolveUnboundSessionWorkspaceFallback()`；
 *   3. **team 会话不回退**——它们必须绑定工作区（`requiresBoundSessionWorkspace`），
 *      未绑定时返回 null（由调用方按「不可用」处理），避免影响 team 语义。
 *
 * 返回值仍需调用方过 `validateWorkspacePath`（restricted 模式下默认工作区可能不在白名单）。
 */
export function resolveSnapshotWorkspaceRoot(input: {
  metadataJson: string;
  sessionId: string;
  userId: string;
}): string | null {
  const bound = resolveSessionWorkspacePath(input);
  if (bound) {
    return bound;
  }
  if (requiresBoundSessionWorkspace(input.sessionId)) {
    return null;
  }
  return resolveUnboundSessionWorkspaceFallback();
}

/**
 * 「必须绑定工作区」的会话判定，作用于已取出的会话行（role_layer /
 * team_parent_session_id / metadata.teamWorkspaceId 任一存在即必须绑定）。
 */
function requiresBoundWorkspaceFromSessionRow(
  row: SessionWorkspacePolicyRow,
  metadata: Record<string, unknown>,
): boolean {
  if (typeof row.role_layer === 'string' && row.role_layer.trim().length > 0) {
    return true;
  }

  if (
    typeof row.team_parent_session_id === 'string' &&
    row.team_parent_session_id.trim().length > 0
  ) {
    return true;
  }

  return (
    typeof metadata['teamWorkspaceId'] === 'string' && metadata['teamWorkspaceId'].trim().length > 0
  );
}

export function requiresBoundSessionWorkspace(sessionId: string): boolean {
  const row = sqliteGet<SessionWorkspacePolicyRow>(
    `SELECT metadata_json, user_id, role_layer, team_parent_session_id
       FROM sessions
      WHERE id = ?
      LIMIT 1`,
    [sessionId],
  );
  if (!row) {
    return false;
  }

  return requiresBoundWorkspaceFromSessionRow(row, parseSessionMetadataJson(row.metadata_json));
}

/**
 * 文件读取端点的「未绑定会话默认工作区」回退根。
 *
 * 与工具执行根 / 快照根（`assertSessionWorkingDirectory`、
 * `resolveSnapshotWorkspaceRoot`）保持同一口径：
 *   1. 会话不存在或不属于该用户 → null（借用他人 sessionId 不获得回退）；
 *   2. 会话已绑定工作目录（含 team / task 子会话的父链继承）→ null，
 *      已绑定的路径绝不被静默改写到默认工作区；
 *   3. team / task 子会话（`requiresBoundSessionWorkspace`）→ null，
 *      它们必须绑定工作区，未绑定时按「不可用」处理；
 *   4. 其余未绑定的普通 chat 会话 → 回退默认工作区
 *      （`resolveUnboundSessionWorkspaceFallback()`）。
 *
 * 返回值可能不在 `WORKSPACE_ROOT(S)` 白名单内，调用方需用
 * `resolveWorkspaceEntryPathWithinRoot` 这类不做白名单校验的解析器并使用它。
 */
export function resolveUnboundSessionFallbackRoot(input: {
  sessionId?: string | undefined;
  userId: string;
}): string | null {
  if (!input.sessionId) {
    return null;
  }

  const row = sqliteGet<SessionWorkspacePolicyRow>(
    `SELECT metadata_json, user_id, role_layer, team_parent_session_id
       FROM sessions
      WHERE id = ? AND user_id = ?
      LIMIT 1`,
    [input.sessionId, input.userId],
  );
  if (!row) {
    return null;
  }

  const bound = resolveSessionWorkspacePath({
    metadataJson: row.metadata_json,
    sessionId: input.sessionId,
    userId: input.userId,
  });
  if (bound) {
    return null;
  }

  if (requiresBoundWorkspaceFromSessionRow(row, parseSessionMetadataJson(row.metadata_json))) {
    return null;
  }

  return resolveUnboundSessionWorkspaceFallback();
}

const UNBOUND_WORKSPACE_DIR_NAME = 'OpenAWork';

/**
 * 未绑定工作区会话的运行时回退目录：各操作系统的「文档目录」下的 OpenAWork 子目录
 *（Windows: %USERPROFILE%\Documents\OpenAWork，
 *  macOS: ~/Documents/OpenAWork，
 *  Linux: $XDG_DOCUMENTS_DIR 或 ~/Documents 下的 OpenAWork）。
 *
 * 该目录与网关数据目录（OPENAWORK_DATA_DIR / platform data dir）完全隔离，
 * 不受 OPENAWORK_DATA_DIR 影响。Android 无标准公共文档目录，保持网关数据目录回退。
 *
 * 仅未绑定会话可回退；已绑定 workingDirectory 的会话必须使用自身路径，不允许静默改写。
 */
export function resolveUnboundSessionWorkspaceFallback(): string {
  const adapter = createPlatformAdapter();
  if (adapter.getPlatform() === 'android') {
    return resolveGatewayDataDir();
  }
  return join(adapter.getDocumentsDir(), UNBOUND_WORKSPACE_DIR_NAME);
}

/**
 * 解析并确保未绑定会话回退目录存在（幂等），供真实文件系统入口使用。
 */
export function ensureUnboundSessionWorkspaceDirectory(): string {
  const fallbackDir = resolveUnboundSessionWorkspaceFallback();
  mkdirSync(fallbackDir, { recursive: true });
  return fallbackDir;
}

/**
 * 盘符根 / 文件系统根（`/`、`C:\`、`D:/` 等）以及常见占位路径。
 * 模型在未绑定会话里常把这些当作 path 传入，在 Windows 上会触发
 * 「无法访问 POSIX 路径：/」。仅未绑定会话可把它们改写为桌面默认目录。
 */
export function isFilesystemRootOrPlaceholderPath(path: string): boolean {
  const trimmed = path.trim();
  if (!trimmed) {
    return true;
  }

  const normalized = trimmed.replace(/\\/g, '/');
  if (
    normalized === '/' ||
    normalized === '/absolute/workspace/path' ||
    normalized.startsWith('/absolute/workspace/path/')
  ) {
    return true;
  }

  // Windows 盘符根：C:\ / C:/ / C:
  if (/^[A-Za-z]:[/\\]?$/.test(trimmed)) {
    return true;
  }

  if (!isWorkspaceAbsolutePath(trimmed)) {
    return false;
  }

  try {
    const resolved = resolve(trimmed);
    return dirname(resolved) === resolved;
  } catch {
    return false;
  }
}

/**
 * 未绑定会话里，把盘符根 / 占位路径改写为桌面默认目录；其余路径原样返回。
 * 已绑定会话不做任何改写。
 */
export function rewriteUnboundPlaceholderPath(sessionId: string, path: string): string {
  const workingDirectory = getSessionWorkingDirectory(sessionId);
  if (workingDirectory) {
    return path;
  }
  if (requiresBoundSessionWorkspace(sessionId)) {
    return path;
  }
  if (!isFilesystemRootOrPlaceholderPath(path)) {
    return path;
  }
  return ensureUnboundSessionWorkspaceDirectory();
}

export function assertSessionWorkingDirectory(sessionId: string): string {
  const workingDirectory = getSessionWorkingDirectory(sessionId);
  if (!workingDirectory) {
    if (requiresBoundSessionWorkspace(sessionId)) {
      throw new Error('当前会话未绑定工作区，请先设置 workingDirectory。');
    }
    // 普通 chat 未绑定工作区：回退到当前主机系统文档目录，
    // 避免落到盘符根（/ 或 C:\）触发跨平台路径错误。
    return ensureUnboundSessionWorkspaceDirectory();
  }
  // 已绑定：原样返回，不做任何回退。
  return workingDirectory;
}

/**
 * 渠道路径权限的读取来源：本轮 run 的成员权限优先，作用域外回退会话 metadata。
 *
 * 与会话内工具可见性同源（见 `channel-actor-scope` 的说明）：同一群成员共享一条
 * 会话，metadata 上的 `channel.permissions` 会被下一位发言者覆盖，只有轮次级快照
 * 才能保证「这一轮用自己那份权限」。
 */
function resolveChannelPathPermissions(sessionId: string): ChannelPermissions | null {
  const scopedPolicy = getChannelActorPolicy();
  if (scopedPolicy) {
    return scopedPolicy.permissions;
  }

  const row = sqliteGet<SessionMetadataRow>(
    'SELECT metadata_json, user_id FROM sessions WHERE id = ? LIMIT 1',
    [sessionId],
  );
  if (!row) {
    return null;
  }

  const metadata = parseSessionMetadataJson(row.metadata_json);
  const channel = metadata['channel'];
  if (typeof channel !== 'object' || channel === null || Array.isArray(channel)) {
    return null;
  }
  return readChannelPermissions((channel as Record<string, unknown>)['permissions']);
}

/**
 * 从任意 JSON 形状里读出渠道权限。字段缺失一律按「不许」处理（保守），
 * 形状由 `channel-session-store` 写入保证，这里只做防御性解析。
 */
function readChannelPermissions(value: unknown): ChannelPermissions | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const prefixes = record['readablePathPrefixes'];
  return {
    allowReadHome: record['allowReadHome'] === true,
    readablePathPrefixes: Array.isArray(prefixes)
      ? prefixes.filter((entry): entry is string => typeof entry === 'string')
      : [],
    allowWriteOutside: record['allowWriteOutside'] === true,
    allowShell: record['allowShell'] === true,
    allowSubAgents: record['allowSubAgents'] === true,
  };
}

/**
 * 渠道路径权限的「会话工作区之外」放行判定。
 *
 * 三条硬约束：
 * - 只放宽**会话工作区**这一层：`validateWorkspacePath`（主机根 / 全局白名单）在更
 *   前面已经判定过，这里的放行不会让它失效；
 * - 读写分离：`allowReadHome` / `readablePathPrefixes` 只对读语义生效，
 *   `allowWriteOutside` 只对写语义生效；
 * - 渠道未配置 `permissions` 或字段缺失时一律不放行，保持原有严格行为。
 *
 * 注意 `allowReadHome` 的语义是「OpenAWork 数据目录整体可读」——网关语境下的
 * 「Home」指 `resolveGatewayDataDir()`（会话库 / 产物 / 日志），不是进程用户的
 * 家目录；开启与否由管理员显式决定。
 */
function isAllowedByChannelPathPermissions(input: {
  access: 'read' | 'write';
  safePath: string;
  sessionId: string;
}): boolean {
  const permissions = resolveChannelPathPermissions(input.sessionId);
  if (!permissions) {
    return false;
  }

  if (input.access === 'write') {
    return permissions.allowWriteOutside;
  }

  if (permissions.allowReadHome) {
    // 「Home」在网关语境里指 **OpenAWork 数据目录**（`resolveGatewayDataDir`：
    // 会话库、产物、日志等），不是进程用户的家目录——后者包含 `~/.ssh`、`~/.aws`
    // 之类的凭据，不该由渠道侧的一个开关放开。
    if (isPathWithinRoot(input.safePath, resolveGatewayDataDir())) {
      return true;
    }
  }

  return permissions.readablePathPrefixes.some((prefix) =>
    prefix.trim().length > 0 ? isPathWithinRoot(input.safePath, resolve(prefix)) : false,
  );
}

export type SessionWorkspacePathValidationResult =
  | {
      ok: true;
      safePath: string;
      workingDirectory: string | null;
    }
  | {
      ok: false;
      reason: 'forbidden-path' | 'outside-session-workspace';
      safePath: string | null;
      workingDirectory: string | null;
    };

export type SessionWorkspacePathAccess = 'read' | 'write';

export function validateSessionWorkspacePath(input: {
  path: string;
  sessionId: string;
  allowSkillResourceRead?: boolean;
  /**
   * 路径用途。缺省按 `write` 处理（最严格）：读放宽（Home / 前缀白名单）只对显式
   * 声明读语义的调用点生效，避免写工具被顺带放宽。
   */
  access?: SessionWorkspacePathAccess;
}): SessionWorkspacePathValidationResult {
  const safePath = validateWorkspacePath(input.path);
  if (!safePath) {
    return {
      ok: false,
      reason: 'forbidden-path',
      safePath: null,
      workingDirectory: null,
    };
  }

  // 未绑定的渠道会话用默认工作目录作隐式边界（见 resolveImplicitChannelWorkspaceBoundary），
  // 让「会话工作区之外」这一层（含 ACL 放宽）真正参与判定。
  const workingDirectory =
    getSessionWorkingDirectory(input.sessionId) ??
    resolveImplicitChannelWorkspaceBoundary(input.sessionId);
  if (workingDirectory && !isPathWithinRoot(safePath, workingDirectory)) {
    // Read-only tools may reach app-owned skill assets; the forbidden-path
    // (host/global-root) failure above is never bypassed by this allowance.
    if (input.allowSkillResourceRead === true && isPathWithinSkillResources(safePath)) {
      return {
        ok: true,
        safePath,
        workingDirectory,
      };
    }
    // 渠道成员 ACL 可以显式放宽「会话工作区之外」的读或写（默认不放宽）。
    if (
      isAllowedByChannelPathPermissions({
        access: input.access ?? 'write',
        safePath,
        sessionId: input.sessionId,
      })
    ) {
      return {
        ok: true,
        safePath,
        workingDirectory,
      };
    }
    return {
      ok: false,
      reason: 'outside-session-workspace',
      safePath,
      workingDirectory,
    };
  }

  return {
    ok: true,
    safePath,
    workingDirectory,
  };
}

export function assertSessionWorkspacePath(input: {
  path: string;
  sessionId: string;
  allowSkillResourceRead?: boolean;
  /** 语义同 `validateSessionWorkspacePath`：缺省按写处理。 */
  access?: SessionWorkspacePathAccess;
}): string {
  // 与 `validateSessionWorkspacePath` 保持同一边界口径：未绑定的渠道会话以默认工作目录
  // 为隐式边界（相对路径也以它为基准解析）。
  const workingDirectory =
    getSessionWorkingDirectory(input.sessionId) ??
    resolveImplicitChannelWorkspaceBoundary(input.sessionId);
  if (!workingDirectory && requiresBoundSessionWorkspace(input.sessionId)) {
    throw new Error(`当前会话未绑定工作区，禁止访问路径：${input.path}`);
  }

  // 仅未绑定：盘符根 / 占位路径改写为桌面默认目录。已绑定绝不改写。
  const rewrittenPath = rewriteUnboundPlaceholderPath(input.sessionId, input.path);
  const effectivePath = isWorkspaceAbsolutePath(rewrittenPath)
    ? rewrittenPath
    : resolveWorkspaceEntryPath(rewrittenPath, workingDirectory);
  if (!effectivePath) {
    throw new Error(`Forbidden workspace path: ${rewrittenPath}`);
  }
  assertWorkspacePathSupportedByCurrentHost(effectivePath);

  const result = validateSessionWorkspacePath({
    path: effectivePath,
    sessionId: input.sessionId,
    ...(input.allowSkillResourceRead === true ? { allowSkillResourceRead: true } : {}),
    ...(input.access === undefined ? {} : { access: input.access }),
  });
  if (!result.ok) {
    if (result.reason === 'forbidden-path') {
      throw new Error(`Forbidden workspace path: ${effectivePath}`);
    }
    throw new Error(`Target path is outside current session workspace: ${result.safePath}`);
  }
  return result.safePath;
}

/**
 * 编辑类工具只能作用于普通文件。字符设备(如 `/dev/null`)读出来是空内容,
 * FIFO 读取会阻塞,目录要到写入时才报晦涩错误,这些目标都必须在读写前拒绝。
 * 路径不存在时放行,由调用方按「新建文件」或「文件不存在」分支处理。
 */
export async function assertRegularFileIfExists(filePath: string): Promise<void> {
  const stats = await fsp.stat(filePath).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });
  if (stats && !stats.isFile()) {
    throw new Error(`Not a regular file, refusing to modify: ${filePath}`);
  }
}

export function resolveWorkspaceEntryPathForRequest(input: {
  path: string;
  sessionId?: string | null;
  userId?: string | null;
  workspaceRoot?: string | null;
}): string | null {
  if (input.sessionId) {
    const sessionWorkingDirectory = input.userId
      ? getSessionWorkingDirectoryForUser(input.sessionId, input.userId)
      : getSessionWorkingDirectory(input.sessionId);
    if (sessionWorkingDirectory) {
      return resolveWorkspaceEntryPath(input.path, sessionWorkingDirectory);
    }
  }

  const workspaceRoot = input.workspaceRoot ? validateWorkspacePath(input.workspaceRoot) : null;
  return resolveWorkspaceEntryPath(input.path, workspaceRoot);
}

export async function ensureIgnoreRulesLoadedForPath(path?: string | null): Promise<void> {
  const workspaceRoot = resolveWorkspaceRootForPath(path);
  const cached = ignoreLoadCache.get(workspaceRoot);
  if (cached && globalIgnoreLoadedRoot === workspaceRoot) {
    await cached;
    return;
  }
  const loadPromise = defaultIgnoreManager.loadRules(workspaceRoot).then(
    () => undefined as void,
    (error: unknown) => {
      // 失败不得污染缓存:清除该根的缓存并重置全局标记,让下一次请求重新加载。
      // 否则一旦 loadRules 拒绝,该根下所有后续 `/workspace/tree` 请求都会复现同一
      // rejection 而持续 500,直到网关重启(毒化缓存)。
      if (ignoreLoadCache.get(workspaceRoot) === loadPromise) {
        ignoreLoadCache.delete(workspaceRoot);
      }
      if (globalIgnoreLoadedRoot === workspaceRoot) {
        globalIgnoreLoadedRoot = null;
      }
      throw error;
    },
  );
  ignoreLoadCache.set(workspaceRoot, loadPromise);
  // `loadRules` 在首个 await 之前同步写入 `projectRoot`，因此调用返回即代表
  // 全局管理器已装载该根；这里同步标记，避免并发同根请求重复加载。
  globalIgnoreLoadedRoot = workspaceRoot;
  await loadPromise;
}

export function hasWorkspacePermanentPermission(
  sessionId: string,
  toolName: string,
  scope: string,
): boolean {
  const workspaceRoot = getSessionWorkspaceRoot(sessionId);
  if (!workspaceRoot) {
    return false;
  }
  return hasWorkspacePersistentPermission(
    loadWorkspacePermissionConfig(workspaceRoot),
    toolName,
    scope,
  );
}

export function persistWorkspacePermanentPermission(input: {
  sessionId: string;
  toolName: string;
  scope: string;
}): void {
  const workspaceRoot = getSessionWorkspaceRoot(input.sessionId);
  if (!workspaceRoot) {
    return;
  }
  const next = upsertWorkspacePermanentPermission(loadWorkspacePermissionConfig(workspaceRoot), {
    toolName: input.toolName,
    scope: input.scope,
  });
  writeWorkspacePermissionConfig(workspaceRoot, next);
}
