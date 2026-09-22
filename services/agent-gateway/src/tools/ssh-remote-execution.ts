/**
 * SSH 远程工具执行桥。
 *
 * 当某个 chat 会话通过 `POST /ssh/connections/:id/bind` 绑定了 SSH 连接、
 * 且该连接当前处于 connected 状态时，会话的核心开发工具不再作用于 gateway
 * 本地工作区，而是通过 `SSHToolProxy` 在远端主机执行：
 *
 *   - `bash`        → `execCommand`（`cd <workdir> && <command>`，输出尾部截断）
 *   - `read`        → SFTP `readFile` + 与本地一致的行窗口 / 2MB 字节上限
 *   - `list`        → SFTP `listFiles` 递归树（depth / 500 条目上限与本地一致）
 *   - `glob`/`grep` → 远端 `find` / `grep` 命令 + 本地正则过滤
 *   - `write`/`edit`/`multi_edit` → SFTP 读-改-写（复用本地 fuzzy replacer 链）
 *
 * 设计要点：
 *
 * 1. 「绑定但连接不可用」永远不会静默回退到本地执行 —— 否则模型以为改动
 *    发生在远端，实际却写进了 gateway 自己的工作区。此时统一返回明确错误。
 * 2. 会话未绑定任何 SSH 连接时，本模块只在 `classifySshRemoteToolPolicy`
 *    暴露的工具体上产生一次绑定 Map 查询（外加父会话链回退），其余工具零开销。
 * 3. task 子会话通过父会话链继承绑定：子会话沿 `team_parent_session_id` /
 *    `parentSessionId` 向上找到第一个持有绑定的祖先，确保委托出的子任务也
 *    在远端执行，而不是落到本地。
 */

import path from 'node:path';
import type {
  SSHConnection,
  SSHConnectionManager,
  SSHFileEntry,
  SSHFilePreview,
  SSHToolProxy,
  ToolCallRequest,
  ToolCallResult,
} from '@openAwork/agent-core';
import { createSSHToolProxy } from '@openAwork/agent-core';
import { sqliteAll, sqliteGet } from '../infra/db.js';
import { parseSessionMetadataJson } from '../session/session-workspace-metadata.js';
import { peekSshService } from '../ssh/ssh-service.js';
import {
  DEFAULT_BASH_TIMEOUT_MS,
  MAX_BASH_TIMEOUT_MS,
  bashToolDefinition,
  deriveBashDescription,
  type BashExecutionResult,
} from './bash-tools.js';
import { MAX_OUTPUT_BYTES, MAX_OUTPUT_LINES } from './bash-output-truncator.js';
import { editInputSchema } from './edit-tools.js';
import {
  convertToLineEnding,
  detectLineEnding,
  fuzzyReplace,
  normalizeLineEndings,
} from './edit-replacers.js';
import { buildFileDiff } from './file-diff-format.js';
import { multiEditInputSchema } from './multi-edit-tool.js';
import { pickToolPathInput, readToolPathInput } from './tool-path-aliases.js';
import {
  IGNORED_NAMES,
  MAX_FILE_BYTES,
  MAX_GLOB_MATCHES,
  MAX_TREE_ENTRIES,
  applyLineWindow,
  globPatternToRegex,
  globTool,
  grepTool,
  listTool,
  matchesGlobLikePath,
  readTool,
  writeTool,
} from './workspace-tools.js';

// ─── 工具策略 ────────────────────────────────────────────────────────────────

/**
 * 已实现远程执行的工具。绑定会话下这些工具永远不会落到本地工作区。
 */
export const SSH_REMOTE_EXECUTABLE_TOOLS: ReadonlySet<string> = new Set([
  'bash',
  'read',
  'write',
  'edit',
  'multi_edit',
  'list',
  'glob',
  'grep',
]);

/**
 * 作用于工作区文件系统 / 本地进程、但尚未实现远程执行的工具。绑定会话下
 * 调用这些工具会收到明确错误，避免「以为在改远端、实际改了 gateway 本地」。
 */
export const SSH_REMOTE_BLOCKED_TOOLS: ReadonlySet<string> = new Set([
  'patch',
  'ast_grep_search',
  'ast_grep_replace',
  'interactive_bash',
  'run_bash_in_background',
  'bash_output',
  'bash_kill',
  'look_at',
  'read_tool_output',
  'lsp_rename',
  'lsp_prepare_rename',
  'lsp_diagnostics',
  'lsp_touch',
  'lsp_goto_definition',
  'lsp_goto_implementation',
  'lsp_find_references',
  'lsp_symbols',
  'lsp_hover',
  'lsp_call_hierarchy',
  'codesearch',
  'codegraph_status',
  'codegraph_index',
  'codegraph_search',
  'codegraph_node',
  'codegraph_callers',
  'codegraph_impact',
  'workspace_create_directory',
  'workspace_review_status',
  'workspace_review_diff',
  'workspace_review_revert',
]);

export type SshRemoteToolPolicy = 'remote' | 'blocked' | 'unmanaged';

export function classifySshRemoteToolPolicy(toolName: string): SshRemoteToolPolicy {
  if (SSH_REMOTE_EXECUTABLE_TOOLS.has(toolName)) return 'remote';
  if (SSH_REMOTE_BLOCKED_TOOLS.has(toolName)) return 'blocked';
  return 'unmanaged';
}

// ─── 上下文解析 ──────────────────────────────────────────────────────────────

export interface SshRemoteExecutionContext {
  sessionId: string;
  /** 实际持有绑定的会话 id（可能是沿父链找到的祖先会话）。 */
  boundSessionId: string;
  connectionId: string;
  host: string;
  username: string;
  port: number;
  /** 远端基准目录（远端 home）。相对路径一律相对它解析。 */
  baseDir: string;
  proxy: SSHToolProxy;
}

export type SshRemoteUnavailableReason = 'disconnected' | 'error';

export type SshRemoteResolution =
  | { kind: 'unbound' }
  | {
      kind: 'unavailable';
      boundSessionId: string;
      connectionId: string;
      hostLabel: string;
      reason: SshRemoteUnavailableReason;
    }
  | { kind: 'ready'; context: SshRemoteExecutionContext };

/** 远端 home 查询结果缓存（按连接）；连接不可用时清除。 */
const REMOTE_BASE_DIR_CACHE = new Map<string, string>();

const MAX_PARENT_CHAIN_DEPTH = 5;

interface SessionParentRow {
  metadata_json: string | null;
  team_parent_session_id: string | null;
}

function findParentSessionId(sessionId: string): string | null {
  const row = sqliteGet<SessionParentRow>(
    'SELECT metadata_json, team_parent_session_id FROM sessions WHERE id = ? LIMIT 1',
    [sessionId],
  );
  if (!row) return null;

  const dbParent = row.team_parent_session_id?.trim();
  if (dbParent && dbParent.length > 0) return dbParent;

  const metadata = parseSessionMetadataJson(row.metadata_json ?? '{}');
  const metadataParent = metadata['parentSessionId'];
  return typeof metadataParent === 'string' && metadataParent.trim().length > 0
    ? metadataParent.trim()
    : null;
}

/**
 * 沿会话自身 → 父会话链找到第一个持有 SSH 绑定的会话 id。
 * 未绑定时返回 null（调用方据此走本地执行路径）。
 */
export function resolveSshBoundSessionId(sessionId: string): string | null {
  // 探针式访问：进程未注册 SshService（单元测试 / 嵌入式调用）时直接按
  // 「未绑定」处理，不触发任何 service 实例化或 DB 副作用。
  const service = peekSshService();
  if (!service) return null;
  const bindings = service.getBindings();
  if (bindings.getConnectionId(sessionId)) return sessionId;

  const seen = new Set<string>([sessionId]);
  let current = sessionId;
  for (let depth = 0; depth < MAX_PARENT_CHAIN_DEPTH; depth += 1) {
    const parentId = findParentSessionId(current);
    if (!parentId || seen.has(parentId)) return null;
    seen.add(parentId);
    if (bindings.getConnectionId(parentId)) return parentId;
    current = parentId;
  }
  return null;
}

function formatHostLabel(connection: SSHConnection | undefined, connectionId: string): string {
  if (!connection) return connectionId;
  return `${connection.username}@${connection.host}:${connection.port}`;
}

/**
 * 读取持有绑定的会话（工作区选择器写入的）远端工作目录：SSH 会话下
 * `metadata.workingDirectory` 语义为远端绝对路径。存在时优先于远端 home
 * 作为工具执行的基准目录。
 */
function resolveSessionRemoteWorkingDirectory(sessionId: string): string | null {
  const row = sqliteGet<{ metadata_json: string | null }>(
    'SELECT metadata_json FROM sessions WHERE id = ? LIMIT 1',
    [sessionId],
  );
  if (!row) return null;
  const metadata = parseSessionMetadataJson(row.metadata_json ?? '{}');
  const workingDirectory = metadata['workingDirectory'];
  return typeof workingDirectory === 'string' && workingDirectory.startsWith('/')
    ? workingDirectory
    : null;
}

async function resolveRemoteBaseDir(
  manager: SSHConnectionManager,
  connectionId: string,
): Promise<string> {
  const cached = REMOTE_BASE_DIR_CACHE.get(connectionId);
  if (cached !== undefined) return cached;

  let baseDir = '/';
  try {
    const result = await manager.execCommand(connectionId, 'printf %s "$HOME"', {
      timeoutMs: 10_000,
    });
    const candidate = result.stdout.trim();
    if (!result.timedOut && result.exitCode === 0 && candidate.startsWith('/')) {
      baseDir = normalizeRemotePath(candidate);
    }
  } catch {
    // 远端拒绝执行 / 通道异常时退回根目录：相对路径仍可解析，
    // 只是模型看到的绝对路径以 / 为基准。
    baseDir = '/';
  }
  REMOTE_BASE_DIR_CACHE.set(connectionId, baseDir);
  return baseDir;
}

export async function resolveSshRemoteExecutionContext(
  sessionId: string,
): Promise<SshRemoteResolution> {
  const service = peekSshService();
  if (!service) return { kind: 'unbound' };
  const boundSessionId = resolveSshBoundSessionId(sessionId);
  if (!boundSessionId) return { kind: 'unbound' };

  const connectionId = service.getBindings().getConnectionId(boundSessionId);
  if (!connectionId) return { kind: 'unbound' };

  const manager = service.getManager();
  const connection = manager.getConnection(connectionId);
  const status = manager.getStatus(connectionId);
  if (status !== 'connected') {
    REMOTE_BASE_DIR_CACHE.delete(connectionId);
    return {
      kind: 'unavailable',
      boundSessionId,
      connectionId,
      hostLabel: formatHostLabel(connection, connectionId),
      reason: status === 'error' ? 'error' : 'disconnected',
    };
  }

  // 会话的远端工作目录（工作区选择器写入的 workingDirectory）优先于远端
  // home：用户在「新建工作区」中选定的目录即是默认执行目录。
  const sessionBaseDir = resolveSessionRemoteWorkingDirectory(boundSessionId);
  const baseDir = sessionBaseDir ?? (await resolveRemoteBaseDir(manager, connectionId));
  return {
    kind: 'ready',
    context: {
      sessionId,
      boundSessionId,
      connectionId,
      host: connection?.host ?? connectionId,
      username: connection?.username ?? '',
      port: connection?.port ?? 22,
      baseDir,
      proxy: createSSHToolProxy(manager, connectionId),
    },
  };
}

// ─── 拒绝消息 ────────────────────────────────────────────────────────────────

export function formatSshBlockedToolMessage(
  toolName: string,
  resolution: Extract<SshRemoteResolution, { kind: 'ready' }>,
): string {
  const label = `${resolution.context.username}@${resolution.context.host}:${resolution.context.port}`;
  return [
    `工具 "${toolName}" 暂不支持在 SSH 远程会话中执行。`,
    `当前会话（或父会话）已绑定 SSH 连接 ${label}，为避免误操作 gateway 本地工作区，该调用已被阻止。`,
    `可用的远程工具：bash、read、write、edit、multi_edit、list、glob、grep；也可以改用 bash 在远端完成等价操作。`,
  ].join(' ');
}

export function formatSshUnavailableToolMessage(
  toolName: string,
  resolution: Extract<SshRemoteResolution, { kind: 'unavailable' }>,
): string {
  const statusLabel =
    resolution.reason === 'error' ? '连接失败（error）' : '未连接（disconnected）';
  return [
    `会话绑定的 SSH 连接 ${resolution.hostLabel} 当前不可用：${statusLabel}。`,
    `为避免误操作 gateway 本地工作区，工具 "${toolName}" 已停止执行。`,
    `请先在设置 → 开发者工具 → SSH 远程连接中恢复该连接，然后重试。`,
  ].join(' ');
}

// ─── 路径工具 ────────────────────────────────────────────────────────────────

export function normalizeRemotePath(input: string): string {
  const normalized = path.posix.normalize(input);
  if (normalized.length > 1 && normalized.endsWith('/')) return normalized.slice(0, -1);
  return normalized.length === 0 ? '/' : normalized;
}

/** 把工具输入中的路径解析为远端绝对路径（相对路径基于 baseDir / home）。 */
export function resolveRemotePath(
  context: Pick<SshRemoteExecutionContext, 'baseDir'>,
  input: string,
): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) return context.baseDir;
  if (trimmed === '~') return context.baseDir;
  if (trimmed.startsWith('~/')) {
    return normalizeRemotePath(`${context.baseDir}/${trimmed.slice(2)}`);
  }
  if (trimmed.startsWith('/')) return normalizeRemotePath(trimmed);
  return normalizeRemotePath(`${context.baseDir}/${trimmed}`);
}

function joinRemote(base: string, relative: string): string {
  return normalizeRemotePath(base === '/' ? `/${relative}` : `${base}/${relative}`);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function decodeRemoteFilePreview(preview: SSHFilePreview): string {
  if (preview.encoding === 'base64') {
    return Buffer.from(preview.content, 'base64').toString('utf8');
  }
  return preview.content;
}

export function isRemoteNotFoundError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (code === 2 || code === 'ENOENT' || code === 'SSH_FX_NO_SUCH_FILE') return true;
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return /no such file/i.test(message);
}

// ─── 审计辅助（edit 前必须先读文件的证据链） ──────────────────────────────────

interface RemoteAuditRow {
  input_json: string | null;
  output_json: string | null;
}

function extractAuditPath(json: string | null): string | null {
  if (typeof json !== 'string' || json.length === 0) return null;
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    return readToolPathInput(parsed) ?? null;
  } catch {
    return null;
  }
}

function hasRemoteReadEvidence(
  context: Pick<SshRemoteExecutionContext, 'baseDir'>,
  sessionId: string,
  remotePath: string,
): boolean {
  // 同 edit-tools.hasReadEvidenceForPath：只认规范名 `read`，旧名审计行不算证据。
  const rows = sqliteAll<RemoteAuditRow>(
    `SELECT input_json, output_json
     FROM audit_logs
     WHERE session_id = ?
       AND is_error = 0
       AND tool_name = 'read'
     ORDER BY id DESC
     LIMIT 50`,
    [sessionId],
  );
  return rows.some((row) => {
    const inputPath = extractAuditPath(row.input_json);
    const outputPath = extractAuditPath(row.output_json);
    if (inputPath && resolveRemotePath(context, inputPath) === remotePath) return true;
    if (outputPath && resolveRemotePath(context, outputPath) === remotePath) return true;
    return false;
  });
}

// ─── 执行入口 ────────────────────────────────────────────────────────────────

interface RemoteToolOutcome {
  output: unknown;
  isError?: boolean;
}

export interface ExecuteSshRemoteToolInput {
  request: ToolCallRequest;
  sessionId: string;
  context: SshRemoteExecutionContext;
}

function formatRemoteValidationIssues(
  toolName: string,
  issues: ReadonlyArray<{ path: (string | number)[]; message: string }>,
): string {
  const details = issues
    .map((issue) =>
      issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
    )
    .join('; ');
  return `工具 "${toolName}" 参数校验失败：${details}`;
}

/**
 * 在远端执行一个已归类为 `remote` 的工具。返回 null 表示该工具不归远程
 * 执行管辖（调用方应走本地路径）。
 */
export async function executeSshRemoteTool(
  input: ExecuteSshRemoteToolInput,
): Promise<ToolCallResult | null> {
  const { request, sessionId, context } = input;
  const startedAt = Date.now();
  const raw =
    request.rawInput && typeof request.rawInput === 'object' && !Array.isArray(request.rawInput)
      ? (request.rawInput as Record<string, unknown>)
      : {};

  try {
    const outcome = await dispatchRemoteTool(request.toolName, raw, context, sessionId);
    if (outcome === null) return null;
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: outcome.output,
      isError: outcome.isError ?? false,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      output: error instanceof Error ? error.message : String(error),
      isError: true,
      durationMs: Date.now() - startedAt,
    };
  }
}

async function dispatchRemoteTool(
  toolName: string,
  raw: Record<string, unknown>,
  context: SshRemoteExecutionContext,
  sessionId: string,
): Promise<RemoteToolOutcome | null> {
  if (toolName === 'bash') {
    const parsed = bashToolDefinition.inputSchema.safeParse(raw);
    if (!parsed.success) {
      return { output: formatRemoteValidationIssues(toolName, parsed.error.issues), isError: true };
    }
    return executeRemoteBash(context, parsed.data);
  }

  if (toolName === readTool.name) {
    const parsed = readTool.inputSchema.safeParse(raw);
    if (!parsed.success) {
      return { output: formatRemoteValidationIssues(toolName, parsed.error.issues), isError: true };
    }
    return executeRemoteRead(context, parsed.data);
  }

  if (toolName === listTool.name) {
    const parsed = listTool.inputSchema.safeParse(raw);
    if (!parsed.success) {
      return { output: formatRemoteValidationIssues(toolName, parsed.error.issues), isError: true };
    }
    return executeRemoteList(context, parsed.data);
  }

  if (toolName === globTool.name) {
    const parsed = globTool.inputSchema.safeParse(raw);
    if (!parsed.success) {
      return { output: formatRemoteValidationIssues(toolName, parsed.error.issues), isError: true };
    }
    return executeRemoteGlob(context, parsed.data);
  }

  if (toolName === grepTool.name) {
    const parsed = grepTool.inputSchema.safeParse(raw);
    if (!parsed.success) {
      return { output: formatRemoteValidationIssues(toolName, parsed.error.issues), isError: true };
    }
    return executeRemoteGrep(context, parsed.data);
  }

  if (toolName === writeTool.name) {
    const parsed = writeTool.inputSchema.safeParse(raw);
    if (!parsed.success) {
      return { output: formatRemoteValidationIssues(toolName, parsed.error.issues), isError: true };
    }
    return executeRemoteWrite(context, parsed.data);
  }

  if (toolName === 'edit') {
    const parsed = editInputSchema.safeParse(raw);
    if (!parsed.success) {
      return { output: formatRemoteValidationIssues(toolName, parsed.error.issues), isError: true };
    }
    return executeRemoteEdit(context, sessionId, parsed.data);
  }

  if (toolName === 'multi_edit') {
    const parsed = multiEditInputSchema.safeParse(raw);
    if (!parsed.success) {
      return { output: formatRemoteValidationIssues(toolName, parsed.error.issues), isError: true };
    }
    return executeRemoteMultiEdit(context, sessionId, parsed.data);
  }

  return null;
}

// ─── bash ───────────────────────────────────────────────────────────────────

function mergeRemoteStreams(stdout: string, stderr: string): string {
  if (stderr.length === 0) return stdout;
  if (stdout.length === 0) return stderr;
  const separator = stdout.endsWith('\n') ? '' : '\n';
  return `${stdout}${separator}${stderr}`;
}

/**
 * 尾部截断（行数 / 字节双上限），与本地 bash 输出上限保持一致。
 * 不做磁盘 spill —— 本地 spill 文件的后续 `read` 会走远端，无法复用本地路径。
 */
function truncateRemoteBashOutput(raw: string): { content: string; truncated: boolean } {
  let content = raw;
  let truncated = false;

  const lines = content.split('\n');
  if (lines.length > MAX_OUTPUT_LINES) {
    content = lines.slice(-MAX_OUTPUT_LINES).join('\n');
    truncated = true;
  }

  if (Buffer.byteLength(content, 'utf8') > MAX_OUTPUT_BYTES) {
    const buffer = Buffer.from(content, 'utf8');
    content = buffer.subarray(buffer.length - MAX_OUTPUT_BYTES).toString('utf8');
    truncated = true;
  }

  return { content, truncated };
}

async function executeRemoteBash(
  context: SshRemoteExecutionContext,
  input: { command: string; timeout?: number; workdir?: string; description?: string },
): Promise<RemoteToolOutcome> {
  const workdir = resolveRemotePath(context, input.workdir ?? context.baseDir);
  const timeoutMs = Math.min(input.timeout ?? DEFAULT_BASH_TIMEOUT_MS, MAX_BASH_TIMEOUT_MS);
  const description = input.description ?? deriveBashDescription(input.command);
  const remoteCommand = `cd ${shellQuote(workdir)} && ${input.command}`;

  const result = await context.proxy.execCommand(remoteCommand, { timeoutMs });
  const truncated = truncateRemoteBashOutput(mergeRemoteStreams(result.stdout, result.stderr));

  const metadataLines = [`[ssh] executed on ${formatRemoteTargetLabel(context)} (cwd: ${workdir})`];
  if (result.timedOut) {
    metadataLines.push(
      `bash tool terminated command after exceeding timeout ${timeoutMs} ms. If this command is expected to take longer and is not waiting for interactive input, retry with a larger timeout value in milliseconds.`,
    );
  }
  if (result.stdoutTruncated || result.stderrTruncated) {
    metadataLines.push(
      'Remote output exceeded the per-stream cap and was truncated before transmission.',
    );
  }

  let finalOutput = truncated.content.length > 0 ? truncated.content : '(no output)';
  finalOutput += `\n\n<bash_metadata>\n${metadataLines.join('\n')}\n</bash_metadata>`;

  const execution: BashExecutionResult = {
    command: input.command,
    description,
    cwd: workdir,
    exitCode: result.exitCode,
    kind: result.timedOut ? 'timeout' : 'exit',
    output: finalOutput,
    truncated: truncated.truncated,
  };
  return { output: execution, isError: result.exitCode !== 0 };
}

function formatRemoteTargetLabel(context: SshRemoteExecutionContext): string {
  const user = context.username.length > 0 ? `${context.username}@` : '';
  return `${user}${context.host}:${context.port}`;
}

// ─── read ───────────────────────────────────────────────────────────────────

async function tryRemoteDirectoryListing(
  context: SshRemoteExecutionContext,
  remotePath: string,
): Promise<string | null> {
  try {
    const entries = await context.proxy.listFiles(remotePath);
    return entries
      .filter((entry) => !IGNORED_NAMES.has(entry.name))
      .sort((left, right) => {
        if (left.kind === right.kind) return left.name.localeCompare(right.name);
        return left.kind === 'directory' ? -1 : 1;
      })
      .map((entry) => `${entry.kind === 'directory' ? 'dir' : 'file'} ${entry.name}`)
      .join('\n');
  } catch {
    return null;
  }
}

async function executeRemoteRead(
  context: SshRemoteExecutionContext,
  input: { path?: string; filePath?: string; file_path?: string; offset?: number; limit?: number },
): Promise<RemoteToolOutcome> {
  const remotePath = resolveRemotePath(context, pickToolPathInput(input));

  let content: string;
  try {
    const preview = await context.proxy.readFile(remotePath);
    content = decodeRemoteFilePreview(preview);
  } catch (error) {
    const listing = await tryRemoteDirectoryListing(context, remotePath);
    if (listing === null) throw error;
    const window = applyLineWindow(listing, false, input);
    return {
      output: {
        path: remotePath,
        content: window.content,
        truncated: window.truncated,
        lineStart: window.lineStart,
        lineEnd: window.lineEnd,
        totalLines: window.totalLines,
        byteLimitReached: window.byteLimitReached,
      },
    };
  }

  const buffer = Buffer.from(content, 'utf8');
  const byteLimitReached = buffer.length > MAX_FILE_BYTES;
  const effective = byteLimitReached
    ? buffer.subarray(0, MAX_FILE_BYTES).toString('utf8')
    : content;
  const window = applyLineWindow(effective, byteLimitReached, input);
  return {
    output: {
      path: remotePath,
      content: window.content,
      truncated: window.truncated,
      lineStart: window.lineStart,
      lineEnd: window.lineEnd,
      totalLines: window.totalLines,
      byteLimitReached: window.byteLimitReached,
    },
  };
}

// ─── list ───────────────────────────────────────────────────────────────────

interface RemoteTreeNode {
  path: string;
  name: string;
  type: 'file' | 'directory';
  children?: RemoteTreeNode[];
}

async function readRemoteTree(
  context: SshRemoteExecutionContext,
  dirPath: string,
  depth: number,
  counter: { count: number },
  throwOnError: boolean,
): Promise<RemoteTreeNode[]> {
  if (depth <= 0 || counter.count >= MAX_TREE_ENTRIES) return [];

  let entries: SSHFileEntry[];
  try {
    entries = await context.proxy.listFiles(dirPath);
  } catch (error) {
    if (throwOnError) throw error;
    return [];
  }

  const nodes: RemoteTreeNode[] = [];
  for (const entry of entries) {
    if (counter.count >= MAX_TREE_ENTRIES) break;
    if (IGNORED_NAMES.has(entry.name)) continue;

    counter.count += 1;
    const node: RemoteTreeNode = {
      path: entry.path,
      name: entry.name,
      type: entry.kind,
    };
    if (entry.kind === 'directory') {
      node.children = await readRemoteTree(context, entry.path, depth - 1, counter, false);
    }
    nodes.push(node);
  }

  return nodes.sort((left, right) => {
    if (left.type === right.type) return left.name.localeCompare(right.name);
    return left.type === 'directory' ? -1 : 1;
  });
}

async function executeRemoteList(
  context: SshRemoteExecutionContext,
  input: { path?: string; filePath?: string; file_path?: string; depth: number },
): Promise<RemoteToolOutcome> {
  const remotePath = resolveRemotePath(context, pickToolPathInput(input));
  const counter = { count: 0 };
  const nodes = await readRemoteTree(context, remotePath, input.depth, counter, true);
  return {
    output: {
      path: remotePath,
      depth: input.depth,
      visitedEntries: counter.count,
      nodes,
    },
  };
}

// ─── glob / grep ────────────────────────────────────────────────────────────

const REMOTE_SEARCH_TIMEOUT_MS = 20_000;
const REMOTE_FIND_MAX_LINES = 2000;
const REMOTE_GREP_MAX_LINES = 600;
const REMOTE_TRUNCATION_NOTICE = '...[truncated: 远端搜索超时或达到输出上限，结果可能不完整]';

function stripRemoteFindPrefix(line: string): string {
  const trimmed = line.trim();
  if (trimmed.startsWith('./')) return trimmed.slice(2);
  return trimmed.replace(/^\/+/, '');
}

async function executeRemoteGlob(
  context: SshRemoteExecutionContext,
  input: { path?: string; pattern: string },
): Promise<RemoteToolOutcome> {
  const base = input.path ? resolveRemotePath(context, input.path) : context.baseDir;
  const pruneExpression = [...IGNORED_NAMES]
    .map((name) => `-name ${shellQuote(name)}`)
    .join(' -o ');
  const findCommand = `find . \\( ${pruneExpression} \\) -prune -o -type f -print | head -n ${REMOTE_FIND_MAX_LINES}`;
  const result = await context.proxy.execCommand(`cd ${shellQuote(base)} && ${findCommand}`, {
    timeoutMs: REMOTE_SEARCH_TIMEOUT_MS,
  });

  const patternRegex = globPatternToRegex(input.pattern);
  const matches: string[] = [];
  for (const line of result.stdout.split('\n')) {
    const relative = stripRemoteFindPrefix(line);
    if (relative.length === 0) continue;
    if (!matchesGlobLikePath(input.pattern, patternRegex, relative)) continue;
    matches.push(joinRemote(base, relative));
  }
  matches.sort((left, right) => left.localeCompare(right));
  const limited = matches.slice(0, MAX_GLOB_MATCHES);

  if (limited.length === 0) {
    return {
      output: result.timedOut ? `No files found\n${REMOTE_TRUNCATION_NOTICE}` : 'No files found',
    };
  }
  const body = limited.join('\n');
  return { output: result.timedOut ? `${body}\n${REMOTE_TRUNCATION_NOTICE}` : body };
}

interface RemoteGrepContentMatch {
  path: string;
  line: number;
  text: string;
}

function parseRemoteGrepContentLine(line: string): RemoteGrepContentMatch | null {
  const match = /^\.\/(.+?):(\d+):(.*)$/.exec(line);
  if (!match) return null;
  const [, relativePath, lineNumber, text] = match;
  if (!relativePath || !lineNumber) return null;
  const parsedLine = Number.parseInt(lineNumber, 10);
  if (!Number.isFinite(parsedLine)) return null;
  return { path: relativePath, line: parsedLine, text: text ?? '' };
}

function parseRemoteGrepCountLine(line: string): { path: string; count: number } | null {
  const match = /^\.\/(.+?):(\d+)$/.exec(line);
  if (!match) return null;
  const [, relativePath, countText] = match;
  if (!relativePath || !countText) return null;
  const count = Number.parseInt(countText, 10);
  if (!Number.isFinite(count)) return null;
  return { path: relativePath, count };
}

async function executeRemoteGrep(
  context: SshRemoteExecutionContext,
  input: {
    pattern: string;
    path?: string;
    include?: string;
    output_mode: 'content' | 'files_with_matches' | 'count';
    head_limit: number;
  },
): Promise<RemoteToolOutcome> {
  const base = input.path ? resolveRemotePath(context, input.path) : context.baseDir;
  const ignoreCase = input.pattern.startsWith('(?i)');
  const pattern = ignoreCase ? input.pattern.slice(4) : input.pattern;

  const flags: string[] = ['-r', '-I', '-E'];
  if (ignoreCase) flags.push('-i');
  if (input.output_mode === 'files_with_matches') flags.push('-l');
  else if (input.output_mode === 'count') flags.push('-c');
  else flags.push('-n');
  for (const name of IGNORED_NAMES) {
    flags.push(`--exclude-dir=${shellQuote(name)}`);
  }
  if (input.include) {
    flags.push(`--include=${shellQuote(input.include)}`);
  }

  const headSuffix = input.output_mode === 'count' ? '' : ` | head -n ${REMOTE_GREP_MAX_LINES}`;
  const command = `cd ${shellQuote(base)} && grep ${flags.join(' ')} -e ${shellQuote(pattern)} .${headSuffix}`;

  const result = await context.proxy.execCommand(command, { timeoutMs: REMOTE_SEARCH_TIMEOUT_MS });
  const stderr = result.stderr.trim();
  // grep 退出码：0 = 有匹配，1 = 无匹配，≥2 = 出错。
  if (!result.timedOut && result.exitCode >= 2) {
    return {
      output: `远端 grep 执行失败（exit ${result.exitCode}）：${stderr.length > 0 ? stderr : 'unknown error'}`,
      isError: true,
    };
  }

  const lines = result.stdout.split('\n').filter((line) => line.trim().length > 0);
  const suffix = result.timedOut ? `\n${REMOTE_TRUNCATION_NOTICE}` : '';

  if (input.output_mode === 'files_with_matches') {
    const files = [...new Set(lines.map((line) => joinRemote(base, stripRemoteFindPrefix(line))))];
    files.sort((left, right) => left.localeCompare(right));
    const body = files.length > 0 ? files.join('\n') : 'No files found';
    return { output: `${body}${suffix}` };
  }

  if (input.output_mode === 'count') {
    const entries = lines
      .map(parseRemoteGrepCountLine)
      .filter((entry): entry is { path: string; count: number } => entry !== null)
      .filter((entry) => entry.count > 0);
    const body =
      entries.length > 0
        ? entries.map((entry) => `${joinRemote(base, entry.path)}: ${entry.count}`).join('\n')
        : 'No files found';
    return { output: `${body}${suffix}` };
  }

  const matches = lines
    .map(parseRemoteGrepContentLine)
    .filter((entry): entry is RemoteGrepContentMatch => entry !== null);
  const limited = input.head_limit > 0 ? matches.slice(0, input.head_limit) : matches;
  const body =
    limited.length > 0
      ? limited
          .map((entry) => `${joinRemote(base, entry.path)}:${entry.line}: ${entry.text.trim()}`)
          .join('\n')
      : 'No files found';
  return { output: `${body}${suffix}` };
}

// ─── write ──────────────────────────────────────────────────────────────────

async function executeRemoteWrite(
  context: SshRemoteExecutionContext,
  input: { path?: string; filePath?: string; content: string },
): Promise<RemoteToolOutcome> {
  const remotePath = resolveRemotePath(context, pickToolPathInput(input));

  let before = '';
  let created = true;
  try {
    const preview = await context.proxy.readFile(remotePath);
    before = decodeRemoteFilePreview(preview);
    created = false;
  } catch (error) {
    if (!isRemoteNotFoundError(error)) throw error;
  }

  await context.proxy.writeFile(remotePath, input.content);
  return {
    output: {
      before,
      after: input.content,
      created,
      filediff: buildFileDiff({ file: remotePath, before, after: input.content }),
      success: true,
      path: remotePath,
      bytes: Buffer.byteLength(input.content, 'utf8'),
    },
  };
}

// ─── edit / multi_edit ──────────────────────────────────────────────────────

const REMOTE_EDIT_ERROR_SUFFIX =
  'STOP: Read the file immediately to see its actual current state before retrying the edit. Your assumption about the file content was wrong.';

interface RemoteLoadedFile {
  exists: boolean;
  content: string;
}

async function loadRemoteFileForEdit(
  context: SshRemoteExecutionContext,
  remotePath: string,
): Promise<RemoteLoadedFile> {
  try {
    const preview = await context.proxy.readFile(remotePath);
    return { exists: true, content: decodeRemoteFilePreview(preview) };
  } catch (error) {
    if (isRemoteNotFoundError(error)) return { exists: false, content: '' };
    throw error;
  }
}

async function executeRemoteEdit(
  context: SshRemoteExecutionContext,
  sessionId: string,
  input: { filePath: string; oldString: string; newString: string; replaceAll: boolean },
): Promise<RemoteToolOutcome> {
  const remotePath = resolveRemotePath(context, input.filePath);

  if (input.oldString === input.newString) {
    throw new Error('newString must be different from oldString. ' + REMOTE_EDIT_ERROR_SUFFIX);
  }

  const loaded = await loadRemoteFileForEdit(context, remotePath);

  if (input.oldString.length === 0) {
    await context.proxy.writeFile(remotePath, input.newString);
    return {
      output: {
        before: loaded.content,
        after: input.newString,
        filediff: buildFileDiff({
          file: remotePath,
          before: loaded.content,
          after: input.newString,
        }),
        success: true,
        path: remotePath,
        replacements: 1,
        created: !loaded.exists,
      },
    };
  }

  if (!loaded.exists) {
    throw new Error(`File not found: ${remotePath}`);
  }

  if (!hasRemoteReadEvidence(context, sessionId, remotePath)) {
    throw new Error(`You must read file "${remotePath}" before editing it`);
  }

  const ending = detectLineEnding(loaded.content);
  const normalizedOld = convertToLineEnding(normalizeLineEndings(input.oldString), ending);
  const normalizedNew = convertToLineEnding(normalizeLineEndings(input.newString), ending);

  let nextContent: string;
  let replacements: number;
  try {
    const replaced = fuzzyReplace(loaded.content, normalizedOld, normalizedNew, input.replaceAll);
    nextContent = replaced.content;
    replacements = replaced.replacements;
  } catch (error) {
    throw new Error(
      (error instanceof Error ? error.message : String(error)) + ' ' + REMOTE_EDIT_ERROR_SUFFIX,
    );
  }

  await context.proxy.writeFile(remotePath, nextContent);
  return {
    output: {
      before: loaded.content,
      after: nextContent,
      filediff: buildFileDiff({ file: remotePath, before: loaded.content, after: nextContent }),
      success: true,
      path: remotePath,
      replacements,
      created: false,
    },
  };
}

async function executeRemoteMultiEdit(
  context: SshRemoteExecutionContext,
  sessionId: string,
  input: {
    filePath: string;
    edits: Array<{ oldString: string; newString: string; replaceAll: boolean }>;
  },
): Promise<RemoteToolOutcome> {
  const remotePath = resolveRemotePath(context, input.filePath);

  if (input.edits.length === 0) {
    throw new Error('At least one edit is required.');
  }

  const loaded = await loadRemoteFileForEdit(context, remotePath);
  if (!loaded.exists) {
    throw new Error(`File not found: ${remotePath}`);
  }
  if (!hasRemoteReadEvidence(context, sessionId, remotePath)) {
    throw new Error(`You must read file "${remotePath}" before editing it`);
  }

  const originalContent = loaded.content;
  let currentContent = originalContent;
  let appliedCount = 0;

  for (const edit of input.edits) {
    if (edit.oldString === edit.newString) {
      throw new Error(
        `Edit #${appliedCount + 1}: newString must be different from oldString. ${REMOTE_EDIT_ERROR_SUFFIX}`,
      );
    }

    const ending = detectLineEnding(currentContent);
    const normalizedOld = convertToLineEnding(normalizeLineEndings(edit.oldString), ending);
    const normalizedNew = convertToLineEnding(normalizeLineEndings(edit.newString), ending);

    try {
      currentContent = fuzzyReplace(
        currentContent,
        normalizedOld,
        normalizedNew,
        edit.replaceAll,
      ).content;
    } catch (error) {
      throw new Error(
        `Edit #${appliedCount + 1}: ${error instanceof Error ? error.message : String(error)} ${REMOTE_EDIT_ERROR_SUFFIX}`,
      );
    }
    appliedCount += 1;
  }

  await context.proxy.writeFile(remotePath, currentContent);
  return {
    output: {
      before: originalContent,
      after: currentContent,
      filediff: buildFileDiff({
        file: remotePath,
        before: originalContent,
        after: currentContent,
      }),
      success: true,
      path: remotePath,
      editsApplied: appliedCount,
    },
  };
}
