/**
 * SSH 远程工作区的路由分支统一收口。
 *
 * 背景：`routes/workspace.ts` 里只有 `/workspace/file`、`/workspace/file/binary`、
 * `/workspace/files/search` 与 `/workspace/tree` 四条路由带SSH 分支，其余
 * （validate / find-by-name / search / index-version 以及全部写操作）在网关运行于
 * Windows、会话工作区是远端 POSIX 路径时，都会先撞上
 * `assertWorkspacePathSupportedByCurrentHost` 的 400
 * （「当前网关运行在 Windows，无法访问 POSIX 路径：…」），功能完全不可用。
 *
 * 这些分支的共同形状是固定的：
 *   1. 解析 SSH 身份（会话优先、其次连接身份）；
 *   2. `ready` 时把请求路径解析成远端路径并做远端根内校验；
 *   3. 命中远端就**提前返回**，绝不继续走本地校验；
 *   4. `local`（未绑定 SSH）时交回调用方走既有本地逻辑。
 *
 * 重复这段会持续把 `workspace.ts` 推向体量红线，故抽到本文件：路由层只保留
 * 「插入一行调用 + `local` 时继续」的骨架，具体远端语义集中在这里演进。
 */

import type { FastifyReply } from 'fastify';
import type { SshRemoteExecutionContext } from '../tools/ssh-remote-execution.js';
import { resolveRemotePath } from '../tools/ssh-remote-execution.js';
import { posix } from 'node:path';
import {
  classifySshPreviewError,
  isRemotePathWithinRoot,
  readRemoteBinaryFile,
  readRemoteDirectoryTree,
  readRemoteTextFile,
  resolveSshPreviewContext,
  SshPreviewError,
  type SshPreviewResolution,
} from './ssh-workspace-preview.js';
import { createPreviewConcurrencyGate } from './preview-concurrency-gate.js';

/** 单文件预览体积上限，与 `routes/workspace.ts` 的 MAX_FILE_BYTES 对齐。 */
export const SSH_WORKSPACE_MAX_FILE_BYTES = 10 * 1024 * 1024;

/** 目录树条目上限，与 `routes/workspace.ts` 的 MAX_ENTRIES 对齐。 */
export const SSH_WORKSPACE_TREE_MAX_ENTRIES = 500;

/**
 * SSH 远端 I/O 阈值。与 `routes/workspace.ts` 的 `sshFilePreviewGate`
 * （4/ 12 / 10s）同口径：两套阈值会让「预览限流」与「读写限流」对同一条 SSH
 * 连接给出互相矛盾的拒绝行为。
 */
const SSH_WORKSPACE_IO_CONCURRENCY = 4;
const SSH_WORKSPACE_IO_QUEUE_LIMIT = 12;
const SSH_WORKSPACE_IO_QUEUE_TIMEOUT_MS = 10_000;

/** 树是逐层 `listFiles`，单请求远端往返次数远多于单文件读取，故阈值更紧。 */
const SSH_WORKSPACE_TREE_CONCURRENCY = 2;
const SSH_WORKSPACE_TREE_QUEUE_LIMIT = 4;

/**
 * SSH 远端 I/O 闸门。
 *
 * 复用 `routes/workspace.ts` 里既有的 `sshFilePreviewGate` 阈值口径
 * （4 并发 / 12 排队 / 10s 超时），不另立一套：两套阈值会让「预览限流」与
 * 「读写限流」对同一条 SSH 连接给出互相矛盾的拒绝行为。
 */
export const sshWorkspaceIoGate = createPreviewConcurrencyGate({
  limit: SSH_WORKSPACE_IO_CONCURRENCY,
  maxQueue: SSH_WORKSPACE_IO_QUEUE_LIMIT,
  acquireTimeoutMs: SSH_WORKSPACE_IO_QUEUE_TIMEOUT_MS,
});

/**
 * 远端目录树闸门。树是逐层 `listFiles`，单次请求的远端往返次数远多于单文件
 * 读取，因此并发阈值比文件读取更紧，避免树把单条连接的长队列塞满。
 */
export const sshWorkspaceTreeGate = createPreviewConcurrencyGate({
  limit: SSH_WORKSPACE_TREE_CONCURRENCY,
  maxQueue: SSH_WORKSPACE_TREE_QUEUE_LIMIT,
  acquireTimeoutMs: SSH_WORKSPACE_IO_QUEUE_TIMEOUT_MS,
});

const SSH_PATH_OUTSIDE_WORKSPACE_MESSAGE = '目标路径超出当前工作区范围。';

/**
 * SSH 身份查询参数。schema 宽松（全是 optional）：未携带即纯本地读取，
 * 携带 `sessionId` 的本地会话也会由 `resolveSshPreviewContext` 判为 `local`。
 */
export interface SshRouteIdentity {
  workspaceRoot?: string | undefined;
  sessionId?: string | undefined;
  sshConnectionId?: string | undefined;
}

export type SshRouteOutcome =
  /** 未绑定 SSH：调用方继续走本地逻辑。 */
  | { kind: 'local' }
  /** 已回包（成功或明确失败）。 */
  | { kind: 'handled' };

function gateKey(identity: SshRouteIdentity, user: string): string {
  return `${user}::ssh::${identity.sessionId ?? identity.sshConnectionId ?? ''}`;
}

/** 把远端异常收敛为结构化回包（不返回，交由调用方 return）。 */
function replySshError(
  reply: FastifyReply,
  error: unknown,
  payload: Record<string, unknown>,
): void {
  const previewError = classifySshPreviewError(error);
  reply.status(previewError.statusCode).send({ error: previewError.message, ...payload });
}

/**
 * 尝试以 SSH 身份处理请求；不适用时返回 `local`。
 *
 * `handler` 只在远端上下文就绪、路径通过远端根校验、且拿到并发闸门之后调用。
 * 抛出的错误由本函数统一转成 HTTP 响应，因此 `handler` 内不必再写错误回包。
 */
async function dispatchSsh(input: {
  reply: FastifyReply;
  identity: SshRouteIdentity;
  user: string;
  path: string;
  gate: { acquire: (key: string) => Promise<GateHandle> };
  /**
   * 远端操作体。返回普通值即作为 200 回包；返回 {@link HANDLED} 表示已在内部
   * 自定义回包（如 409），本函数不再发送第二次。
   */
  handler: (
    context: SshRemoteExecutionContext,
    remotePath: string,
  ) => Promise<HandledResponse | Record<string, unknown>>;
  /** 远端读操作可预判体积时给出更细的错误体；默认只回 `{ error }`。 */
  errorPayload?: Record<string, unknown>;
}): Promise<SshRouteOutcome> {
  const { reply, identity, user, path, gate, handler } = input;

  let resolution: SshPreviewResolution;
  try {
    resolution = await resolveSshPreviewContext({
      user,
      ...(identity.sessionId !== undefined ? { sessionId: identity.sessionId } : {}),
      ...(identity.sshConnectionId !== undefined
        ? { sshConnectionId: identity.sshConnectionId }
        : {}),
      ...(identity.workspaceRoot !== undefined ? { workspaceRoot: identity.workspaceRoot } : {}),
    });
  } catch (error) {
    replySshError(reply, error, input.errorPayload ?? {});
    return { kind: 'handled' };
  }

  if (resolution.kind === 'local') {
    return { kind: 'local' };
  }

  const remotePath = resolveRemotePath(resolution.context, path);
  if (!isRemotePathWithinRoot(remotePath, resolution.context.baseDir)) {
    reply.status(403).send({
      error: SSH_PATH_OUTSIDE_WORKSPACE_MESSAGE,
      ...(input.errorPayload ?? {}),
    });
    return { kind: 'handled' };
  }

  const handle = await gate.acquire(gateKey(identity, user));
  if (!handle.ok) {
    reply
      .status(429)
      .header('Retry-After', String(Math.max(1, Math.ceil((handle.retryAfterMs ?? 1) / 1000))))
      .send({ error: '远程工作区正忙，请稍后重试。', ...(input.errorPayload ?? {}) });
    return { kind: 'handled' };
  }

  try {
    const body = await handler(resolution.context, remotePath);
    if (isHandled(body)) {
      return { kind: 'handled' };
    }
    reply.status(200).send(body);
    return { kind: 'handled' };
  } catch (error) {
    replySshError(reply, error, input.errorPayload ?? {});
    return { kind: 'handled' };
  } finally {
    handle.release?.();
  }
}

/**
 * `handler` 已自行回包时的返回标记，避免 dispatchSsh 二次发送。
 */
export interface HandledResponse {
  readonly handled: true;
}

/** 供 `handler` 内部已回包的场景返回。 */
export const HANDLED: HandledResponse = { handled: true };

function isHandled(value: unknown): value is HandledResponse {
  return typeof value === 'object' && value !== null && 'handled' in value;
}

interface GateHandle {
  ok: boolean;
  retryAfterMs?: number;
  release?: () => void;
}

/** 读远端文本文件。 */
export async function handleSshReadTextFile(input: {
  reply: FastifyReply;
  identity: SshRouteIdentity;
  user: string;
  path: string;
}): Promise<SshRouteOutcome> {
  return dispatchSsh({
    ...input,
    gate: sshWorkspaceIoGate,
    errorPayload: { path: input.path },
    handler: async (context, remotePath) => {
      const file = await readRemoteTextFile(context, remotePath, SSH_WORKSPACE_MAX_FILE_BYTES);
      return { path: file.path, content: file.content, truncated: file.truncated };
    },
  });
}

/** 读远端二进制文件。 */
export async function handleSshReadBinaryFile(input: {
  reply: FastifyReply;
  identity: SshRouteIdentity;
  user: string;
  path: string;
}): Promise<SshRouteOutcome> {
  return dispatchSsh({
    ...input,
    gate: sshWorkspaceIoGate,
    errorPayload: { path: input.path },
    handler: async (context, remotePath) => {
      const file = await readRemoteBinaryFile(context, remotePath, SSH_WORKSPACE_MAX_FILE_BYTES);
      return { data: file.data, contentType: file.contentType };
    },
  });
}

/** 读远端目录树。 */
export async function handleSshReadDirectoryTree(input: {
  reply: FastifyReply;
  identity: SshRouteIdentity;
  user: string;
  path: string;
  depth: number;
}): Promise<SshRouteOutcome> {
  return dispatchSsh({
    ...input,
    gate: sshWorkspaceTreeGate,
    errorPayload: { nodes: [] },
    handler: async (context, remotePath) => {
      const counter = { count: 0 };
      const nodes = await readRemoteDirectoryTree({
        context,
        dirPath: remotePath,
        depth: input.depth,
        maxEntries: SSH_WORKSPACE_TREE_MAX_ENTRIES,
        counter,
      });
      return { nodes, visitedEntries: counter.count };
    },
  });
}

/**
 * 远端路径存在性 / 目录性校验。
 *
 * `SSHToolProxy` 没有 stat 能力（只有 execCommand / readFile(Bytes) / writeFile /
 * listFiles），而 `listFiles` 对「空目录」和「文件」都返回空数组、无法区分，因此
 * 用一次远端 `test -d` 判定目录性。命令只含已在客户端侧做过引号转义的路径，
 * 且经`isRemotePathWithinRoot` 限定在远端根内。
 *
 * 远端不存在时返回 `{ valid: false }`（200），与本地 validate 的语义一致 ——
 * 「路径不存在」不是服务端错误。真正的 SSH 层错误仍由 dispatchSsh 统一收敛。
 */
export async function handleSshValidatePath(input: {
  reply: FastifyReply;
  identity: SshRouteIdentity;
  user: string;
  path: string;
}): Promise<SshRouteOutcome> {
  return dispatchSsh({
    ...input,
    gate: sshWorkspaceIoGate,
    errorPayload: { valid: false, path: input.path },
    handler: async (context, remotePath) => {
      const quoted = shellQuote(remotePath);
      const result = await context.proxy.execCommand(
        `if [ -e ${quoted} ]; then if [ -d ${quoted} ]; then echo __OATW_DIR__; else echo __OATW_FILE__; fi; else echo __OATW_MISSING__; fi`,
      );
      const output = result.stdout.trim();
      if (output.endsWith('__OATW_DIR__')) {
        return { valid: true, path: remotePath, isDirectory: true, isFile: false };
      }
      if (output.endsWith('__OATW_FILE__')) {
        return { valid: true, path: remotePath, isDirectory: false, isFile: true };
      }
      return { valid: false, path: remotePath, isDirectory: false, isFile: false };
    },
  });
}

/**
 * 远端写入文件内容（对应 `PUT /workspace/file`）。
 *
 * 覆盖写语义与本地一致：`writeFile` 直接写远端文件。调用方（编辑器保存）需要
 * 与本地相同的「整文件替换」语义，因此不做读-改-写。
 */
export async function handleSshWriteFile(input: {
  reply: FastifyReply;
  identity: SshRouteIdentity;
  user: string;
  path: string;
  content: string;
  /** true=必须不存在（创建语义），false=允许覆盖（保存语义）。 */
  mustNotExist?: boolean;
}): Promise<SshRouteOutcome> {
  return dispatchSsh({
    ...input,
    gate: sshWorkspaceIoGate,
    handler: async (context, remotePath) => {
      if (input.mustNotExist) {
        // 创建语义：先判存在，避免把已存在文件静默覆盖。
        const exists = await remotePathExists(context, remotePath);
        if (exists.exists) {
          throw new SshPreviewError(409, '目标文件已存在。');
        }
      }
      await context.proxy.writeFile(remotePath, input.content);
      return { success: true, path: remotePath };
    },
  });
}

/** 远端创建目录（`mkdir -p`，已存在视为成功，与本地 recursive 语义一致）。 */
export async function handleSshCreateDirectory(input: {
  reply: FastifyReply;
  identity: SshRouteIdentity;
  user: string;
  path: string;
}): Promise<SshRouteOutcome> {
  return dispatchSsh({
    ...input,
    gate: sshWorkspaceIoGate,
    handler: async (context, remotePath) => {
      await context.proxy.execCommand(`mkdir -p ${shellQuote(remotePath)}`);
      return { success: true, path: remotePath };
    },
  });
}

/** 远端删除文件或目录。 */
export async function handleSshDeleteEntry(input: {
  reply: FastifyReply;
  identity: SshRouteIdentity;
  user: string;
  path: string;
}): Promise<SshRouteOutcome> {
  return dispatchSsh({
    ...input,
    gate: sshWorkspaceIoGate,
    handler: async (context, remotePath) => {
      // `-rf`：与本地 `fsp.rm(..., { recursive: true })` 对齐。
      const result = await context.proxy.execCommand(
        `if [ -e ${shellQuote(remotePath)} ]; then rm -rf ${shellQuote(remotePath)} && echo __OATW_OK__; else echo __OATW_MISSING__; fi`,
      );
      if (!result.stdout.includes('__OATW_OK__')) {
        throw new SshPreviewError(404, '目标路径不存在。');
      }
      return { success: true, path: remotePath };
    },
  });
}

/** 远端重命名 / 移动（同一远端根内，因此不跨连接）。 */
export async function handleSshRenameEntry(input: {
  reply: FastifyReply;
  identity: SshRouteIdentity;
  user: string;
  path: string;
  newPath: string;
}): Promise<SshRouteOutcome> {
  return dispatchSsh({
    ...input,
    gate: sshWorkspaceIoGate,
    handler: async (context, remotePath) => {
      const targetPath = resolveRemotePath(context, input.newPath);
      if (!isRemotePathWithinRoot(targetPath, context.baseDir)) {
        throw new SshPreviewError(403, SSH_PATH_OUTSIDE_WORKSPACE_MESSAGE);
      }
      const parent = posix.dirname(targetPath);
      await context.proxy.execCommand(`mkdir -p ${shellQuote(parent)}`);
      await context.proxy.execCommand(`mv ${shellQuote(remotePath)} ${shellQuote(targetPath)}`);
      return { success: true, path: remotePath, newPath: targetPath };
    },
  });
}

/** 远端路径存在性（`test -e`），供创建语义判定复用。 */
async function remotePathExists(
  context: SshRemoteExecutionContext,
  remotePath: string,
): Promise<{ exists: boolean }> {
  const quoted = shellQuote(remotePath);
  const result = await context.proxy.execCommand(
    `if [ -e ${quoted} ]; then echo __OATW_EXISTS__; else echo __OATW_MISSING__; fi`,
  );
  return { exists: result.stdout.includes('__OATW_EXISTS__') };
}

/**
 * 组合入口：按操作名分发到具体 handler。
 *
 * `routes/workspace.ts` 有十余条路由都需要同样的「SSH 分支前置 + local 时继续」
 * 骨架。逐条展开会让该文件越过 2000 行红线（项目硬性拆分线），故在此收口：
 * 路由层只需三行 —— 调本函数、`handled` 则return。
 *
 * 语义与各`handleSshXxx` 完全一致，只是省掉重复的 destructure。
 */
export async function handleSshWorkspaceOp(input: {
  reply: FastifyReply;
  user: string;
  op: SshWorkspaceOp;
  identity: SshRouteIdentity;
  path: string;
  depth?: number;
  name?: string;
  query?: string;
  content?: string;
  maxResults?: number;
  mustNotExist?: boolean;
  newPath?: string;
}): Promise<SshRouteOutcome> {
  const { reply, user, op, identity, path } = input;
  const shared = { reply, user, identity, path };

  switch (op) {
    case 'tree':
      return handleSshReadDirectoryTree({ ...shared, depth: input.depth ?? 2 });
    case 'validate':
      return handleSshValidatePath(shared);
    case 'findByName':
      return handleSshFindByName({
        ...shared,
        name: input.name ?? '',
        maxResults: input.maxResults ?? 8,
      });
    case 'search':
      return handleSshSearchContent({
        ...shared,
        query: input.query ?? '',
        maxResults: input.maxResults ?? 20,
      });
    case 'writeFile':
      return handleSshWriteFile({
        ...shared,
        content: input.content ?? '',
        ...(input.mustNotExist !== undefined ? { mustNotExist: input.mustNotExist } : {}),
      });
    case 'createDirectory':
      return handleSshCreateDirectory(shared);
    case 'deleteEntry':
      return handleSshDeleteEntry(shared);
    case 'renameEntry':
      return handleSshRenameEntry({ ...shared, newPath: input.newPath ?? path });
    default: {
      // 编译期穷尽性保护：新增 op 而忘记实现时立即报错，而不是静默回落本地。
      const exhaustive: never = op;
      throw new Error(`未实现的 SSH 工作区操作：${String(exhaustive)}`);
    }
  }
}

/** `handleSshWorkspaceOp` 支持的操作名。 */
export type SshWorkspaceOp =
  | 'tree'
  | 'validate'
  | 'findByName'
  | 'search'
  | 'writeFile'
  | 'createDirectory'
  | 'deleteEntry'
  | 'renameEntry';

/**
 * 从已解析的 query/body 中提取 SSH 身份字段。
 *
 * 供路由层把 zod 解析结果直接转成 {@link SshRouteIdentity}，避免每条路由重复
 * 写三个 `x ? { x } : {}` 的展开。
 */
export function sshIdentityFrom(source: {
  sessionId?: string | undefined;
  sshConnectionId?: string | undefined;
  workspaceRoot?: string | undefined;
}): SshRouteIdentity {
  return {
    sessionId: source.sessionId,
    sshConnectionId: source.sshConnectionId,
    workspaceRoot: source.workspaceRoot,
  };
}

/** 单引号包裹并转义，供远端 shell 引用路径。 */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** 远端扫描的硬上限，防止一条 grep/find 打满连接或把网关内存撑爆。 */
const SSH_SCAN_MAX_DEPTH = 8;
const SSH_SCAN_MAX_RESULTS = 50;

/**
 * 远端按 basename 查找文件（对应 `/workspace/find-by-name`）。
 *
 * 用远端 `find -name` 而非逐层 listFiles：逐层遍历在远端是 N 次往返，而
 * `find` 一次往返即可。路径与pattern 都经 shellQuote转义，且路径已被
 * `isRemotePathWithinRoot` 限定在远端根内。
 */
export async function handleSshFindByName(input: {
  reply: FastifyReply;
  identity: SshRouteIdentity;
  user: string;
  path: string;
  name: string;
  maxResults: number;
}): Promise<SshRouteOutcome> {
  return dispatchSsh({
    ...input,
    gate: sshWorkspaceTreeGate,
    errorPayload: { results: [] },
    handler: async (context, remotePath) => {
      const limit = Math.min(Math.max(input.maxResults, 1), SSH_SCAN_MAX_RESULTS);
      const result = await context.proxy.execCommand(
        `find ${shellQuote(remotePath)} -maxdepth ${SSH_SCAN_MAX_DEPTH} -name ${shellQuote(input.name)} -type f 2>/dev/null | head -n ${limit}`,
      );
      const results = result.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .slice(0, limit)
        .map((line) => ({ path: line }));
      return { results };
    },
  });
}

/**
 * 远端内容检索（对应 `/workspace/search`）。
 *
 * 用远端 `grep -rn`。`-I` 跳过二进制，`--exclude-dir` 跳过常见噪声目录；
 * 命中行数由 `head -n` 截断，避免远端产出无界输出。
 */
export async function handleSshSearchContent(input: {
  reply: FastifyReply;
  identity: SshRouteIdentity;
  user: string;
  path: string;
  query: string;
  maxResults: number;
}): Promise<SshRouteOutcome> {
  return dispatchSsh({
    ...input,
    gate: sshWorkspaceTreeGate,
    errorPayload: { results: [] },
    handler: async (context, remotePath) => {
      const limit = Math.min(Math.max(input.maxResults, 1), SSH_SCAN_MAX_RESULTS);
      const result = await context.proxy.execCommand(
        `grep -rnI --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=build -F ${shellQuote(input.query)} ${shellQuote(remotePath)} 2>/dev/null | head -n ${limit}`,
      );
      const results = result.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .slice(0, limit)
        .flatMap((line) => {
          // grep -rn 输出 `path:line:text`，路径本身可能含冒号，故从右侧两次切分。
          const firstColon = line.indexOf(':');
          if (firstColon <= 0) return [];
          const secondColon = line.indexOf(':', firstColon + 1);
          if (secondColon <= 0) return [];
          const path = line.slice(0, firstColon);
          const lineNumber = Number(line.slice(firstColon + 1, secondColon));
          if (!Number.isFinite(lineNumber)) return [];
          return [{ path, line: lineNumber, text: line.slice(secondColon + 1) }];
        });
      return { results };
    },
  });
}
