/**
 * SSH 远程工作区文件预览：为 SSH 绑定会话（`sessionId`）与草稿会话
 * （`sshConnectionId` + 远端 `workspaceRoot`）提供「打开 / 预览文件」的远端读取。
 *
 * 网关可能运行在 Windows，而会话工作区是远端 POSIX 路径，本地 fs 与 workspace
 * 路径校验都不适用。路由层因此在任何本地路径校验之前先解析本模块的远端上下文，
 * 命中远端后直接返回；只有解析为 `local`（未提供 SSH 标识 / 会话未绑定）时才回退
 * 到既有本地逻辑。
 *
 * 与 `GET /workspace/files/search` 的 SSH 分支保持同一套身份解析与中文报错，
 * 但把逻辑拆到独立文件，避免 `routes/workspace.ts` 继续膨胀。
 */

import { posix } from 'node:path';
import { createSSHToolProxy } from '@openAwork/agent-core';
import {
  isRemoteNotFoundError,
  resolveSshRemoteExecutionContext,
  type SshRemoteExecutionContext,
} from '../tools/ssh-remote-execution.js';
import { requireOwnedSshSession } from '../ssh/ssh-session-ownership.js';
import { getSshService } from '../ssh/ssh-service.js';
import { normalizeSshRemoteWorkingDirectory } from '../session/session-workspace-metadata.js';

const SSH_FILE_TOO_LARGE_MESSAGE =
  '文件超过 10MB 预览上限，暂不支持预览与编辑。请下载后用本地应用打开。';
const SSH_PATH_NOT_FILE_MESSAGE = '目标路径不是文件。';
const SSH_FILE_NOT_FOUND_MESSAGE = '目标文件不存在。';
const SSH_SESSION_FORBIDDEN_MESSAGE = '会话不存在或无权访问。';
const SSH_CONNECTION_FORBIDDEN_MESSAGE = 'SSH 连接不存在或无权访问。';
const SSH_REMOTE_ROOT_INVALID_MESSAGE = 'SSH 远程工作区路径必须是绝对 POSIX 路径。';
const SSH_UNAVAILABLE_SUFFIX = '请先在设置 → 开发者工具 → SSH 远程连接中恢复该连接后重试。';

/** 携带 HTTP 状态码的预览错误：路由层直接据此回包，不再二次分类。 */
export class SshPreviewError extends Error {
  override readonly name = 'SshPreviewError';
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export type SshPreviewResolution =
  { kind: 'local' } | { kind: 'ready'; context: SshRemoteExecutionContext };

function sshUnavailableReasonLabel(reason: 'disconnected' | 'error'): string {
  return reason === 'error' ? '连接失败（error）' : '未连接（disconnected）';
}

function sshConnectionStatusLabel(status: string): string {
  if (status === 'error') return '连接失败（error）';
  if (status === 'connecting') return '连接中（connecting）';
  return '未连接（disconnected）';
}

/**
 * 解析本次预览请求的 SSH 身份：
 *   - 提供 `sessionId`：必须是当前用户拥有的会话，且其（或祖先）绑定的 SSH
 *     连接可用；`ready` 时使用服务端解析出的会话远端根目录。
 *   - 仅提供 `sshConnectionId`：草稿会话，校验连接归属 / 状态，并用客户端提供的
 *     `workspaceRoot`（必须是绝对 POSIX）作为远端根目录。
 *   - 两者都缺省，或会话未绑定 SSH：返回 `local`，交由调用方走本地逻辑。
 *
 * 所有 4xx 语义都以 {@link SshPreviewError} 抛出。
 */
export async function resolveSshPreviewContext(input: {
  user: string;
  sessionId?: string;
  sshConnectionId?: string;
  workspaceRoot?: string;
}): Promise<SshPreviewResolution> {
  const { user, sessionId, sshConnectionId, workspaceRoot } = input;

  if (sessionId !== undefined) {
    // 先解析会话的 SSH 绑定：客户端现在对每个会话都会带上 sessionId（含本地
    // 会话）。若先做 SSH 归属校验，会把「他人的 / 纯本地」会话误判成越权 SSH
    // 会话并 404，破坏本地读取。
    const resolution = await resolveSshRemoteExecutionContext(sessionId);
    // `unbound`：未绑定 SSH，不涉及远端工作区，交由调用方走本地校验。
    if (resolution.kind === 'unbound') return { kind: 'local' };

    // 确定是 SSH 绑定会话后才做归属校验：远端解析器读 `sessions` 行时不带用户
    // 过滤、绑定注册表又是全局的，非归属者绝不能解析出对方的远端工作区上下文。
    try {
      requireOwnedSshSession(user, sessionId);
    } catch {
      throw new SshPreviewError(404, SSH_SESSION_FORBIDDEN_MESSAGE);
    }

    if (resolution.kind === 'unavailable') {
      throw new SshPreviewError(
        409,
        `会话绑定的 SSH 连接 ${resolution.hostLabel} 当前不可用：${sshUnavailableReasonLabel(resolution.reason)}，无法读取远程工作区文件。${SSH_UNAVAILABLE_SUFFIX}`,
      );
    }
    return { kind: 'ready', context: resolution.context };
  }

  if (sshConnectionId !== undefined) {
    const service = getSshService();
    const connection = service.getConnection(user, sshConnectionId);
    if (!connection) {
      throw new SshPreviewError(400, SSH_CONNECTION_FORBIDDEN_MESSAGE);
    }
    // 草稿会话没有 sessionId，连接状态只能直接读连接本身；断线 / 连接中时
    // 若静默走本地分支，前端会误把 gateway 本地文件当成远端文件打开。
    if (connection.status !== 'connected') {
      throw new SshPreviewError(
        409,
        `SSH 连接 ${connection.username}@${connection.host}:${connection.port} 当前不可用：${sshConnectionStatusLabel(connection.status)}，无法读取远程工作区文件。${SSH_UNAVAILABLE_SUFFIX}`,
      );
    }

    const remoteRoot = normalizeSshRemoteWorkingDirectory(workspaceRoot ?? '');
    if (!remoteRoot || !remoteRoot.startsWith('/')) {
      throw new SshPreviewError(400, SSH_REMOTE_ROOT_INVALID_MESSAGE);
    }

    const context: SshRemoteExecutionContext = {
      sessionId: '',
      boundSessionId: '',
      connectionId: sshConnectionId,
      host: connection.host,
      username: connection.username,
      port: connection.port,
      baseDir: remoteRoot,
      proxy: createSSHToolProxy(service.getManager(), sshConnectionId),
    };
    return { kind: 'ready', context };
  }

  return { kind: 'local' };
}

/**
 * POSIX 路径包含判断：`remotePath` 必须位于 `root` 之内（相等视为在范围内）。
 * 用 `posix.relative` 而非字符串前缀，避免 `/a/b` 误判 `/a/bc`。
 */
export function isRemotePathWithinRoot(remotePath: string, root: string): boolean {
  const relative = posix.relative(root, remotePath);
  if (posix.isAbsolute(relative)) return false;
  return relative !== '..' && !relative.startsWith('../');
}

/** 本地 / 远端共用的扩展名 → MIME 映射。 */
export function contentTypeForPath(path: string): string {
  const ext = (path.split('.').pop() ?? '').toLowerCase();
  return ext === 'docx'
    ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    : ext === 'xlsx'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : ext === 'pptx'
        ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        : ext === 'pdf'
          ? 'application/pdf'
          : ext === 'doc'
            ? 'application/msword'
            : ext === 'xls'
              ? 'application/vnd.ms-excel'
              : 'application/octet-stream';
}

export interface RemoteTextFile {
  path: string;
  content: string;
  truncated: boolean;
}

/**
 * 读取远端文本文件；目录 / 不存在映射为明确的 4xx，超过预览上限 → 413。
 *
 * 超限**拒绝**而非截断：与本地端点保持同一口径。截断内容一旦成为编辑基线，
 * 保存就会把远端源文件写短。
 */
export async function readRemoteTextFile(
  context: SshRemoteExecutionContext,
  remotePath: string,
  maxBytes: number,
): Promise<RemoteTextFile> {
  let result;
  try {
    result = await context.proxy.readFileBytes(remotePath, { maxBytes });
  } catch (error) {
    if (isRemoteNotFoundError(error)) throw new SshPreviewError(404, SSH_FILE_NOT_FOUND_MESSAGE);
    throw error;
  }
  if (result.isDirectory) throw new SshPreviewError(400, SSH_PATH_NOT_FILE_MESSAGE);
  if (result.size > maxBytes) throw new SshPreviewError(413, SSH_FILE_TOO_LARGE_MESSAGE);

  return {
    path: remotePath,
    content: result.data.toString('utf8'),
    truncated: false,
  };
}

/** 读取远端二进制文件；目录 → 400，超过预览上限 → 413。 */
export async function readRemoteBinaryFile(
  context: SshRemoteExecutionContext,
  remotePath: string,
  maxBytes: number,
): Promise<{ data: Buffer; contentType: string }> {
  const result = await context.proxy.readFileBytes(remotePath, { maxBytes });
  if (result.isDirectory) throw new SshPreviewError(400, SSH_PATH_NOT_FILE_MESSAGE);
  if (result.size > maxBytes) throw new SshPreviewError(413, SSH_FILE_TOO_LARGE_MESSAGE);

  return { data: result.data, contentType: contentTypeForPath(remotePath) };
}

/**
 * 远端目录树节点。与 `routes/workspace.ts` 的 `FileTreeNode` 同构，
 * 使 SSH 分支与本地分支共用同一份响应契约（`{ nodes }`）。
 */
export interface RemoteTreeNode {
  path: string;
  name: string;
  type: 'file' | 'directory';
  children?: RemoteTreeNode[];
}

/** 与本地 `readTree` 的 MAX_ENTRIES / MAX_DEPTH 对齐，避免远端把网关拖死。 */
const REMOTE_TREE_MAX_ENTRIES = 500;
const REMOTE_TREE_MAX_DEPTH = 4;

/** 远端树跳过的目录/文件名，与本地忽略清单保持同一口径。 */
const REMOTE_TREE_IGNORED_NAMES = new Set([
  '.git',
  '.DS_Store',
  'node_modules',
  '.next',
  'dist',
  'build',
  '.turbo',
  '.cache',
]);

function compareTreeNodes(left: RemoteTreeNode, right: RemoteTreeNode): number {
  if (left.type === right.type) return left.name.localeCompare(right.name);
  return left.type === 'directory' ? -1 : 1;
}

/**
 * 通过 SSH 递归读取远端目录树。
 *
 * 与 `tools/ssh-remote-execution.ts` 的私有 `readRemoteTree` 同算法、同上限，
 * 但导出到此处供 HTTP 层复用 —— 此前文件树接口只能读本地 fs，于是 SSH 工作区的
 * 侧边栏树必然撞上 `assertWorkspacePathSupportedByCurrentHost` 的 400
 * （「当前网关运行在 Windows，无法访问 POSIX 路径：…」）。
 *
 * 逐层 `listFiles` 都是远端调用，因此条目上限与深度都由调用方显式传入，不依赖
 * 调用点自觉。顶层读取失败向上抛（路由层据此回 404/409），子目录失败降级为空
 * 子节点 —— 单个无权限目录不应让整棵树失败。
 */
export async function readRemoteDirectoryTree(input: {
  context: SshRemoteExecutionContext;
  dirPath: string;
  depth: number;
  maxEntries: number;
  counter: { count: number };
}): Promise<RemoteTreeNode[]> {
  const { context, dirPath, depth, maxEntries, counter } = input;
  if (depth <= 0 || counter.count >= maxEntries || maxEntries > REMOTE_TREE_MAX_ENTRIES) {
    return [];
  }
  if (depth > REMOTE_TREE_MAX_DEPTH) {
    throw new SshPreviewError(400, `目录树深度超出上限（最大 ${REMOTE_TREE_MAX_DEPTH} 层）。`);
  }

  const isRootLevel = counter.count === 0;
  let entries: Array<{ name: string; path: string; kind: 'file' | 'directory' }>;
  try {
    entries = await context.proxy.listFiles(dirPath);
  } catch (error) {
    if (isRootLevel) throw error;
    return [];
  }

  const nodes: RemoteTreeNode[] = [];
  for (const entry of entries) {
    if (counter.count >= maxEntries) break;
    if (REMOTE_TREE_IGNORED_NAMES.has(entry.name)) continue;

    counter.count += 1;
    const node: RemoteTreeNode = { path: entry.path, name: entry.name, type: entry.kind };
    if (entry.kind === 'directory') {
      node.children = await readRemoteDirectoryTree({
        context,
        dirPath: entry.path,
        depth: depth - 1,
        maxEntries,
        counter,
      });
    }
    nodes.push(node);
  }

  return nodes.sort(compareTreeNodes);
}

/**
 * 把远端读取阶段抛出的任意错误收敛为带状态码的 {@link SshPreviewError}。
 * 未知错误统一 500，并保留原始错误文案便于排查。
 */
export function classifySshPreviewError(error: unknown): SshPreviewError {
  if (error instanceof SshPreviewError) return error;

  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : String(error);

  if (isRemoteNotFoundError(error)) {
    return new SshPreviewError(404, SSH_FILE_NOT_FOUND_MESSAGE);
  }
  if (message.startsWith('SSH connection not found:')) {
    return new SshPreviewError(404, SSH_CONNECTION_FORBIDDEN_MESSAGE);
  }
  if (message.startsWith('SSH client not connected:')) {
    return new SshPreviewError(
      409,
      `SSH 连接当前不可用，无法读取远程工作区文件。${SSH_UNAVAILABLE_SUFFIX}`,
    );
  }
  if (message.includes('SSH file too large to preview')) {
    return new SshPreviewError(413, SSH_FILE_TOO_LARGE_MESSAGE);
  }
  return new SshPreviewError(500, message);
}
