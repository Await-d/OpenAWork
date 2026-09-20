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

const SSH_FILE_TOO_LARGE_MESSAGE = '文件体积超过预览限制，暂不支持预览。';
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

/** 读取远端文本文件；目录 / 不存在映射为明确的 4xx。 */
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

  return {
    path: remotePath,
    content: result.data.toString('utf8'),
    truncated: result.truncated || result.size > maxBytes,
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
