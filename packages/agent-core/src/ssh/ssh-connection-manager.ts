import {
  openSSHTerminal,
  type SSHTerminalClient,
  type SSHTerminalOptions,
} from './ssh-terminal.js';
import type { ClientChannel } from 'ssh2';
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { resolveSshConnectOptions, type SSHConnectOptions } from './ssh-connect-options.js';
import { SSHConnectionError, type SSHConnectionEvent } from './ssh-connection-events.js';

/**
 * Upper bound on an SSH connect attempt. ssh2's own `readyTimeout` covers
 * the handshake, but we add a belt-and-suspenders client-side timeout so a
 * connection that emits neither `ready` nor `error` (e.g. a TCP peer that
 * accepts then stalls, or an injected client that ignores readyTimeout)
 * can't leave `connect()` pending forever.
 */
const SSH_CONNECT_TIMEOUT_MS = 30_000;

/**
 * Upper bound on a single `execCommand` invocation. A remote command can hang
 * forever (a server-side process that never exits, a stream that emits neither
 * `close` nor further data), which would otherwise leave the returned promise
 * pending indefinitely and leak the channel. On timeout we best-effort destroy
 * the stream and reject so the caller degrades instead of hanging. Override per
 * call via `execCommand`'s options; <=0 disables the deadline.
 */
const SSH_EXEC_TIMEOUT_MS = 120_000;

/**
 * Per-stream (stdout / stderr) output cap. A remote command that spews
 * unbounded output (`yes`, `cat /dev/urandom`, a runaway log tail) would grow
 * these in-memory strings without limit and OOM the gateway. Once the cap is
 * exceeded we stop appending and flag the result as truncated.
 */
const SSH_EXEC_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

/**
 * Upper bound on a single SFTP operation (open-channel + readFile / writeFile /
 * readdir). Each wraps an ssh2 callback in a promise that only settles when the
 * callback fires; if the channel opens but the operation callback never returns
 * (a half-open channel, a stalled network filesystem on the remote), the
 * promise would otherwise hang forever and leak the channel. On timeout we
 * reject so the caller degrades instead of hanging. <=0 disables the deadline.
 */
const SSH_SFTP_TIMEOUT_MS = 60_000;

/**
 * Memory ceiling for an SFTP file *preview* (`readFile`). ssh2's `sftp.readFile`
 * buffers the ENTIRE remote file into memory before its callback fires, so a
 * multi-GB remote file (the path is user-supplied via `GET /ssh/file`) would
 * OOM the gateway — post-read truncation cannot undo the buffering. We `stat`
 * the remote file first (cheap) and reject before reading when it exceeds the
 * cap, mirroring the `look_at` tool's stat-first guard and the exec-output cap
 * (`SSH_EXEC_MAX_OUTPUT_BYTES`). Override via `OPENAWORK_SSH_READ_MAX_BYTES`;
 * <=0 disables the guard.
 */
const DEFAULT_SSH_SFTP_READ_MAX_BYTES = 16 * 1024 * 1024;

/**
 * 远端路径读取失败的语义化错误（`readFile` 预览等场景）。
 *
 * ssh2 的 SFTP 错误 `code` 是数字状态码（2=NO_SUCH_FILE、3=PERMISSION_DENIED、
 * 4=FAILURE），message 往往只有一个词（如 "Failure"）——直接透传到
 * `GET /ssh/file` 就成了 `500 + "Failure"`，排障包里既没有路径也没有原因
 * （2026-10-12 线上排障命中）。`kind` 让网关路由把它映射成客户端可纠正的
 * 4xx（目录 / 不存在 / 不可读），`remotePath` / `detail` 进入日志与排障包。
 */
export class SshRemotePathError extends Error {
  constructor(
    readonly kind: 'directory' | 'not-found' | 'not-readable',
    readonly remotePath: string,
    readonly detail?: string,
  ) {
    super(
      kind === 'directory'
        ? `SSH remote path is a directory: ${remotePath}`
        : kind === 'not-found'
          ? `SSH remote path not found: ${remotePath}`
          : `SSH remote path not readable: ${remotePath}${detail ? ` (${detail})` : ''}`,
    );
    this.name = 'SshRemotePathError';
  }
}

/**
 * 远端 sshd 未能启动 SFTP 子系统时的语义化错误。
 *
 * ssh2 的 `client.sftp()` 在服务端拒绝 `subsystem` 请求时只回一句裸文案
 * `Unable to start subsystem: sftp`（没有 `code`、没有路径）——直接透传到
 * `GET /ssh/files` 就成了 `500 + 原生英文`，排障包里看不出这是远端环境
 * 问题还是网关故障（2026-10-12 线上排障命中）。这不是网关缺陷、也无法通过
 * 重试恢复，故单独归一成一个类型，让路由层映射成非 500 的可操作文案。
 */
export class SshSftpUnavailableError extends Error {
  constructor(readonly subsystem = 'sftp') {
    super(`SSH remote server did not start the ${subsystem} subsystem`);
    this.name = 'SshSftpUnavailableError';
  }
}

/**
 * 识别 ssh2 的「Unable to start subsystem」错误。ssh2 在这条路径上只给
 * 裸 message（无 `code`），因此只能按文案匹配；大小写与后方子系统名在不同
 * ssh2 版本间略有差异，故只匹配前缀片段。
 */
function isSftpSubsystemUnavailable(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('message' in error)) return false;
  return /unable to start subsystem/i.test(String((error as { message?: unknown }).message));
}

/**
 * 归一「打开 SFTP 通道」阶段的错误：仅把可识别的子系统缺失换成
 * {@link SshSftpUnavailableError}，其余原样返回（不掩盖真实故障，
 * 也保持注入实现 / 旧链路的行为不变）。
 */
function normalizeSftpChannelError(error: unknown): Error {
  if (isSftpSubsystemUnavailable(error)) return new SshSftpUnavailableError();
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * 把 ssh2 SFTP 的原始读取错误归一成 {@link SshRemotePathError}。
 *
 * 归一规则与 `ssh-remote-execution.ts::isRemoteNotFoundError` 的既有判定口径
 * 一致（code 2 / 'ENOENT' / 'SSH_FX_NO_SUCH_FILE' / message 含 no such file）；
 * 无法识别的错误原样返回，不掩盖真实故障。
 */
function normalizeSftpReadError(remotePath: string, error: unknown): Error {
  const raw = error instanceof Error ? error : new Error(String(error));
  const code = (raw as { code?: unknown }).code;
  const message = raw.message;

  if (
    code === 2 ||
    code === 'ENOENT' ||
    code === 'SSH_FX_NO_SUCH_FILE' ||
    /no such file/i.test(message)
  ) {
    const notFound = new SshRemotePathError('not-found', remotePath);
    (notFound as { code?: string }).code = 'ENOENT';
    return notFound;
  }
  if (code === 3 || code === 'SSH_FX_PERMISSION_DENIED' || /permission denied/i.test(message)) {
    const statusLabel = sftpStatusLabel(code);
    return new SshRemotePathError(
      'not-readable',
      remotePath,
      statusLabel === undefined
        ? 'permission denied'
        : `permission denied (SFTP status ${statusLabel})`,
    );
  }
  if (code === 4 || code === 'SSH_FX_FAILURE' || /^failure$/i.test(message.trim())) {
    const statusLabel = sftpStatusLabel(code);
    return new SshRemotePathError(
      'not-readable',
      remotePath,
      statusLabel === undefined ? message.trim() : `SFTP status ${statusLabel}: ${message.trim()}`,
    );
  }
  return raw;
}

/**
 * SFTP 状态码的可读形式（数字状态码 / 文本别名）；无法识别时返回 undefined，
 * 调用方的 detail 文案据此省略状态码，避免输出 "SFTP status undefined"。
 */
function sftpStatusLabel(code: unknown): string | number | undefined {
  return typeof code === 'number' || typeof code === 'string' ? code : undefined;
}

/**
 * 通道自愈(SSH_CHANNEL_EXHAUSTION)连续阈值。ssh2 打开 exec/sftp 失败时，
 * 只有连续的「通道打开失败」达到该阈值才判定为该连接的通道预算被耗尽
 * (sshd 的 MaxSessions)，从而触发重建传输；单独的偶发失败（如并发突发）
 * 直接透传给调用方，不触发重连，避免误伤临时资源短缺。
 */
const SSH_CHANNEL_EXHAUSTION_THRESHOLD = 3;

/**
 * 通道自愈冷却期。一次重建后，在冷却期内即使再遇到通道打开失败也不
 * 重复重建，直接透传错误，防止「重建→立刻又失败」的热循环耗尽 CPU 并刷屏
 * 日志。仅在冷却期外且连续失败达到阈值时才再次触发。
 */
const SSH_SELF_HEAL_COOLDOWN_MS = 60_000;

/**
 * Resolve the SFTP read ceiling per-call (not at module load) so the env
 * override applies at runtime and stays test-injectable. `<=0` disables.
 */
function resolveSshReadMaxBytes(): number {
  const raw = globalThis.process?.env?.['OPENAWORK_SSH_READ_MAX_BYTES'];
  if (raw === undefined || raw === null || raw.trim() === '') {
    return DEFAULT_SSH_SFTP_READ_MAX_BYTES;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
}

/**
 * 判断是否为「通道打开阶段」被服务端拒绝的错误。ssh2 对 CHANNEL_OPEN_FAILURE
 * 统一包装成 `(SSH) Channel open failure: <description>`（description 来自
 * 服务端回包），`open failed` 正是 sshd 在中央拒绝新 session（如 MaxSessions
 * 耗尽）时的回包描述。只在「打开阶段」失败使用——已建立通道上的操作错误
 * （如 ENOENT、命令非零退出）不在此列，不能误计为通道耗尽。
 */
function isChannelOpenFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('message' in error)) return false;
  return /\(SSH\) Channel open failure/i.test(String(error.message));
}

export interface SSHConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'key' | 'key-password' | 'agent';
  privateKeyPath?: string;
  /** 粘贴式私钥内容（明文，仅驻留内存）；非空时优先于 privateKeyPath。 */
  privateKey?: string;
  /** 加密私钥的口令（明文，仅驻留内存）；仅 key / key-password 使用。 */
  passphrase?: string;
  password?: string;
  status: 'connected' | 'disconnected' | 'error';
  createdAt: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** True when stdout hit SSH_EXEC_MAX_OUTPUT_BYTES and was capped. */
  stdoutTruncated?: boolean;
  /** True when stderr hit SSH_EXEC_MAX_OUTPUT_BYTES and was capped. */
  stderrTruncated?: boolean;
  /** True when the command was aborted by the wall-clock deadline. */
  timedOut?: boolean;
}

/** Per-call overrides for {@link SSHConnectionManager.execCommand}. */
export interface SSHExecOptions {
  /** Wall-clock ceiling in ms (default SSH_EXEC_TIMEOUT_MS; <=0 disables). */
  timeoutMs?: number;
  /** Per-stream output cap in bytes (default SSH_EXEC_MAX_OUTPUT_BYTES). */
  maxOutputBytes?: number;
}

export interface SSHFileEntry {
  name: string;
  path: string;
  kind: 'file' | 'directory';
}

export interface SSHFilePreview {
  path: string;
  content: string;
  encoding: 'utf8' | 'base64';
  truncated: boolean;
}

/** 远端文件的原始字节读取结果（二进制安全，供预览下载 / 图片 / Office 使用）。 */
export interface SSHFileBytes {
  data: Buffer;
  size: number;
  truncated: boolean;
  isDirectory: boolean;
}

export interface SSHConnectionManager {
  addConnection(conn: SSHConnection): void;
  getConnection(id: string): SSHConnection | undefined;
  listConnections(): SSHConnection[];
  connect(id: string): Promise<void>;
  disconnect(id: string): Promise<void>;
  openTerminal?(id: string, options: SSHTerminalOptions): Promise<ClientChannel>;
  execCommand(id: string, command: string, options?: SSHExecOptions): Promise<ExecResult>;
  readFile(id: string, remotePath: string): Promise<SSHFilePreview>;
  readFileBytes(
    id: string,
    remotePath: string,
    options?: { maxBytes?: number },
  ): Promise<SSHFileBytes>;
  writeFile(id: string, remotePath: string, content: string | Uint8Array): Promise<void>;
  listFiles(id: string, remotePath: string): Promise<SSHFileEntry[]>;
  subscribe?(listener: (event: SSHConnectionEvent) => void): () => void;
  getStatus(id: string): SSHConnection['status'];
}

interface SSHConnectionManagerOptions {
  clients?: Map<string, SSHClient>;
  verifyHostKey?: (connection: SSHConnection, fingerprint: string) => Promise<boolean>;
  /**
   * Factory for a fresh SSH client. Defaults to dynamically importing the
   * optional `ssh2` dependency. Injectable for tests and for runtimes
   * that provide their own transport.
   */
  clientFactory?: () => Promise<SSHClient>;
  /**
   * 通道自愈冷却期（ms），默认 {@link SSH_SELF_HEAL_COOLDOWN_MS}。测试
   * 注入小值以覆盖「冷却期内不重复重建」分支，生产无需配置。
   */
  selfHealCooldownMs?: number;
}

type SSHClient = SSHTerminalClient & {
  exec: (cmd: string, cb: (err: Error | undefined, stream: SSHStream) => void) => void;
  sftp: (cb: (err: Error | undefined, sftp: SFTPWrapper) => void) => void;
  end: () => void;
  on: (event: string, cb: (...args: unknown[]) => void) => SSHClient;
  connect: (opts: SSHConnectOptions) => SSHClient;
};

type SSHStream = {
  on(event: 'data', cb: (data: Buffer) => void): SSHStream;
  on(event: 'close', cb: (code: number | null) => void): SSHStream;
  on(event: 'error', cb: (error: Error) => void): SSHStream;
  stderr: { on: (event: string, cb: (data: Buffer) => void) => void };
  /** Best-effort teardown used to abort a hung command on timeout. */
  destroy?: () => void;
};

type SFTPWrapper = {
  on?: (event: 'close' | 'error', listener: () => void) => unknown;
  end?: () => void;
  readFile: (
    path: string,
    opts: { encoding?: string },
    cb: (err: Error | undefined, data: string | Buffer) => void,
  ) => void;
  writeFile: (
    path: string,
    data: string | Uint8Array,
    opts: { encoding?: string },
    cb: (err: Error | undefined) => void,
  ) => void;
  readdir: (
    path: string,
    cb: (
      err: Error | undefined,
      list: Array<{
        filename: string;
        longname?: string;
        attrs?: { isDirectory?: () => boolean };
      }>,
    ) => void,
  ) => void;
  stat?: (
    path: string,
    cb: (err: Error | undefined, stats: { size?: number; isDirectory?: () => boolean }) => void,
  ) => void;
  createReadStream?: (path: string, opts: { start: number; end: number }) => Readable;
};

type SSH2Module = { Client: new () => SSHClient };

// ssh2 is an optional dependency; loaded lazily at runtime
async function loadSSHClient(): Promise<SSHClient> {
  // 必须使用字面量动态 import：隐藏模块名会绕过 Bun --compile 的静态分析，
  // 导致桌面 sidecar 二进制缺少 ssh2 而运行时报模块缺失。
  const ssh2 = (await import('ssh2')) as unknown as SSH2Module;
  return new ssh2.Client();
}

/**
 * Race an SFTP callback-style operation against {@link SSH_SFTP_TIMEOUT_MS}.
 * Single-settle guard (same pattern as connect/execCommand): the timeout and
 * the operation callback both funnel through `done`, so whichever fires first
 * wins and the timer is always cleared. On timeout the promise rejects with an
 * identifiable error instead of hanging forever on a half-open channel.
 */
function withSftpTimeout<T>(
  op: string,
  executor: (resolve: (value: T) => void, reject: (err: Error) => void) => void,
  timeoutMs: number = SSH_SFTP_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn();
    };
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        done(() => reject(new Error(`SSH SFTP ${op} timed out after ${timeoutMs}ms`)));
      }, timeoutMs);
      (timer as { unref?: () => void }).unref?.();
    }
    executor(
      (value) => done(() => resolve(value)),
      (err) => done(() => reject(err)),
    );
  });
}

export class SSHConnectionManagerImpl implements SSHConnectionManager {
  private connections = new Map<string, SSHConnection>();
  private clients = new Map<string, SSHClient>();
  /**
   * One cached SFTP session channel per connection. ssh2's `client.sftp()`
   * opens a NEW channel on every call, and `sshd` caps concurrent channels per
   * connection (`MaxSessions`, default 10). Opening one per file op leaked a
   * channel per call until every later open — including `exec` — was refused
   * with "(SSH) Channel open failure: open failed". SFTP multiplexes requests
   * over a single channel, so open once and reuse.
   */
  private sftps = new Map<string, Promise<SFTPWrapper>>();
  private readonly pending = new Map<
    string,
    { controller: AbortController; promise: Promise<void> }
  >();
  private readonly listeners = new Set<(event: SSHConnectionEvent) => void>();
  private readonly verifyHostKey: NonNullable<SSHConnectionManagerOptions['verifyHostKey']>;
  private readonly trustedKeys = new Map<string, string>();
  private readonly clientFactory: () => Promise<SSHClient>;
  private readonly selfHealCooldownMs: number;
  /**
   * 通道耗尽自愈状态(按连接)。`channelFailures` 记录连续「通道打开失败」
   * 次数,任何一次通道成功打开都会清零;达到 {@link SSH_CHANNEL_EXHAUSTION_THRESHOLD}
   * 才重建传输。`lastSelfHealAt` 强制冷却期,避免「重建后立刻又失败」的热循环。
   * `selfHeals` 让并发的多个失败共享同一次重建,而不是并发发起 N 次重连。
   */
  private readonly channelFailures = new Map<string, number>();
  private readonly lastSelfHealAt = new Map<string, number>();
  private readonly selfHeals = new Map<string, Promise<boolean>>();

  constructor(options: SSHConnectionManagerOptions = {}) {
    if (options.clients) {
      this.clients = options.clients;
    }
    this.verifyHostKey =
      options.verifyHostKey ??
      (async (connection, fingerprint) => {
        const endpoint = JSON.stringify([connection.host, connection.port]);
        const known = this.trustedKeys.get(endpoint);
        if (known && known !== fingerprint) return false;
        this.trustedKeys.set(endpoint, fingerprint);
        return true;
      });
    this.clientFactory = options.clientFactory ?? loadSSHClient;
    this.selfHealCooldownMs = options.selfHealCooldownMs ?? SSH_SELF_HEAL_COOLDOWN_MS;
  }

  addConnection(conn: SSHConnection): void {
    if (this.connections.has(conn.id)) {
      this.pending.get(conn.id)?.controller.abort();
      this.pending.delete(conn.id);
      const client = this.clients.get(conn.id);
      this.clients.delete(conn.id);
      this.releaseSftp(conn.id);
      client?.end();
    }
    this.resetChannelHealState(conn.id);
    this.connections.set(conn.id, { ...conn });
  }

  getConnection(id: string): SSHConnection | undefined {
    return this.connections.get(id);
  }

  listConnections(): SSHConnection[] {
    return [...this.connections.values()];
  }

  getStatus(id: string): SSHConnection['status'] {
    return this.connections.get(id)?.status ?? 'disconnected';
  }

  subscribe(listener: (event: SSHConnectionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private publishStatus(event: SSHConnectionEvent): void {
    const connection = this.connections.get(event.connectionId);
    if (connection)
      this.connections.set(event.connectionId, { ...connection, status: event.status });
    for (const listener of this.listeners) listener(event);
  }

  connect(id: string): Promise<void> {
    const active = this.pending.get(id);
    if (active) return active.promise;
    if (this.clients.has(id) && this.getStatus(id) === 'connected') return Promise.resolve();
    const conn = this.connections.get(id);
    if (!conn) return Promise.reject(new SSHConnectionError(`SSH connection not found: ${id}`));
    const controller = new AbortController();
    const promise = this.establishConnection(conn, controller.signal).finally(() => {
      if (this.pending.get(id)?.controller === controller) this.pending.delete(id);
    });
    this.pending.set(id, { controller, promise });
    return promise;
  }

  private async establishConnection(conn: SSHConnection, signal: AbortSignal): Promise<void> {
    const id = conn.id;
    const client = await this.clientFactory();
    if (signal.aborted) {
      client.end();
      throw new SSHConnectionError('SSH connection cancelled');
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      let fingerprintError: string | undefined;
      const cleanup = (): void => {
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
      };
      const fail = (error: Error, intentional = false): void => {
        if (settled) return;
        settled = true;
        cleanup();
        this.publishStatus({
          connectionId: id,
          status: intentional ? 'disconnected' : 'error',
          intentional,
          error: error.message,
        });
        client.end();
        reject(error);
      };
      const cancel = (): void => fail(new SSHConnectionError('SSH connection cancelled'), true);
      const timer = setTimeout(
        () => fail(new SSHConnectionError('SSH connect timed out after 30000ms')),
        SSH_CONNECT_TIMEOUT_MS,
      );
      signal.addEventListener('abort', cancel, { once: true });
      const ended = (status: 'disconnected' | 'error', error?: string): void => {
        if (this.clients.get(id) === client) {
          this.clients.delete(id);
          this.releaseSftp(id);
          this.publishStatus({
            connectionId: id,
            status,
            intentional: false,
            ...(error ? { error } : {}),
          });
        }
        fail(new SSHConnectionError(error ?? 'SSH connection closed before ready'));
      };
      client
        .on('ready', () => {
          if (settled || signal.aborted) {
            client.end();
            return;
          }
          settled = true;
          cleanup();
          this.clients.set(id, client);
          this.publishStatus({ connectionId: id, status: 'connected', intentional: false });
          resolve();
        })
        .on('close', () => ended('disconnected'))
        .on('end', () => ended('disconnected'))
        .on('error', (error: unknown) => {
          ended(
            'error',
            fingerprintError ?? (error instanceof Error ? error.message : String(error)),
          );
          client.end();
        });
      void resolveSshConnectOptions(conn)
        .then((options) => {
          if (settled || signal.aborted) return;
          options.hostVerifier = (key, callback) => {
            const fingerprint =
              'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
            void this.verifyHostKey(conn, fingerprint)
              .then((trusted) => {
                if (!trusted) fingerprintError = 'SSH host key mismatch: ' + fingerprint;
                callback(trusted && !signal.aborted && !settled);
              })
              .catch((error: unknown) => {
                fingerprintError = error instanceof Error ? error.message : String(error);
                callback(false);
              });
          };
          if (options.tryKeyboard) {
            client.on('keyboard-interactive', (...args: unknown[]) => {
              const prompts = Array.isArray(args[3]) ? args[3] : [];
              const finish = args[4];
              if (typeof finish === 'function')
                finish(prompts.length === 1 ? [conn.password ?? ''] : prompts.map(() => ''));
            });
          }
          client.connect(options);
        })
        .catch((error: unknown) =>
          fail(error instanceof Error ? error : new SSHConnectionError(String(error))),
        );
    });
  }

  async disconnect(id: string): Promise<void> {
    this.pending.get(id)?.controller.abort();
    this.pending.delete(id);
    const client = this.clients.get(id);
    this.clients.delete(id);
    this.releaseSftp(id);
    client?.end();
    this.resetChannelHealState(id);
    this.publishStatus({ connectionId: id, status: 'disconnected', intentional: true });
  }

  async openTerminal(id: string, options: SSHTerminalOptions): Promise<ClientChannel> {
    try {
      return await openSSHTerminal(this.requireClient(id), options);
    } catch (error) {
      const recovered = await this.recoverFromChannelExhaustion(id, error);
      if (!recovered) throw error;
      return openSSHTerminal(this.requireClient(id), options);
    }
  }

  async execCommand(id: string, command: string, options?: SSHExecOptions): Promise<ExecResult> {
    const timeoutMs = options?.timeoutMs ?? SSH_EXEC_TIMEOUT_MS;
    const maxOutputBytes = options?.maxOutputBytes ?? SSH_EXEC_MAX_OUTPUT_BYTES;
    try {
      return await this.runExecOnClient(
        id,
        this.requireClient(id),
        command,
        timeoutMs,
        maxOutputBytes,
      );
    } catch (error) {
      if (!(await this.recoverFromChannelExhaustion(id, error))) throw error;
      // 传输已重建：用新 client 原样重试一次（整体墙钟 deadline 重新起算）。
      return this.runExecOnClient(id, this.requireClient(id), command, timeoutMs, maxOutputBytes);
    }
  }

  private runExecOnClient(
    id: string,
    client: SSHClient,
    command: string,
    timeoutMs: number,
    maxOutputBytes: number,
  ): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let stdoutTruncated = false;
      let stderrTruncated = false;
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let stream: SSHStream | undefined;

      // Append up to the per-stream byte cap; once exceeded we stop growing
      // the string and flag truncation. Prevents a runaway remote command
      // (`yes`, `cat /dev/urandom`) from OOMing the host via unbounded
      // in-memory accumulation.
      const appendStdout = (data: Buffer): void => {
        if (stdoutTruncated) return;
        const remaining = maxOutputBytes - stdoutBytes;
        if (data.length <= remaining) {
          stdout += data.toString();
          stdoutBytes += data.length;
        } else {
          if (remaining > 0) stdout += data.subarray(0, remaining).toString();
          stdoutBytes = maxOutputBytes;
          stdoutTruncated = true;
        }
      };
      const appendStderr = (data: Buffer): void => {
        if (stderrTruncated) return;
        const remaining = maxOutputBytes - stderrBytes;
        if (data.length <= remaining) {
          stderr += data.toString();
          stderrBytes += data.length;
        } else {
          if (remaining > 0) stderr += data.subarray(0, remaining).toString();
          stderrBytes = maxOutputBytes;
          stderrTruncated = true;
        }
      };

      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        fn();
      };

      // Wall-clock guard covering the WHOLE call, channel open included. ssh2's
      // `exec` callback never fires when the server refuses or stalls the
      // channel open (`sshd` at MaxSessions answers "(SSH) Channel open
      // failure: open failed"), so arming the deadline only from inside the
      // callback left this promise pending forever. On timeout best-effort
      // destroy the stream (if it opened) and resolve with whatever output we
      // captured, flagged timedOut.
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          finish(() => {
            try {
              stream?.destroy?.();
            } catch {
              // best-effort teardown of the hung channel
            }
            resolve({
              stdout,
              stderr,
              exitCode: -1,
              timedOut: true,
              ...(stdoutTruncated ? { stdoutTruncated: true } : {}),
              ...(stderrTruncated ? { stderrTruncated: true } : {}),
            });
          });
        }, timeoutMs);
        (timer as { unref?: () => void }).unref?.();
      }

      client.exec(command, (err, opened) => {
        if (err) {
          finish(() => reject(err));
          return;
        }
        // 通道成功打开：清零该连接的通道耗尽计数（临时突发不累积）。
        this.channelFailures.delete(id);
        if (settled) {
          // The deadline already fired before this channel opened; release the
          // late channel instead of attaching listeners to a finished promise.
          try {
            opened.destroy?.();
          } catch {
            // best-effort teardown of the late channel
          }
          return;
        }
        stream = opened;
        opened.on('data', appendStdout).stderr.on('data', appendStderr);
        opened.on('error', (error) => finish(() => reject(error)));
        opened.on('close', (code) => {
          finish(() => {
            resolve({
              stdout,
              stderr,
              exitCode: code ?? -1,
              ...(stdoutTruncated ? { stdoutTruncated: true } : {}),
              ...(stderrTruncated ? { stderrTruncated: true } : {}),
            });
          });
        });
      });
    });
  }

  async readFile(id: string, remotePath: string): Promise<SSHFilePreview> {
    const sftp = await this.getSftp(id);

    // Memory guard: stat the remote file first and refuse to preview anything
    // over SSH_SFTP_READ_MAX_BYTES BEFORE `sftp.readFile` buffers the whole
    // thing into memory. Skipped when the wrapper has no `stat` (injected /
    // legacy clients) so behaviour degrades to the prior unguarded read rather
    // than failing outright.
    const maxReadBytes = resolveSshReadMaxBytes();
    if (maxReadBytes > 0 && typeof sftp.stat === 'function') {
      const statFn = sftp.stat.bind(sftp);
      const stat = await withSftpTimeout<{ size: number; isDirectory: boolean } | null>(
        'stat',
        (resolve) => {
          statFn(remotePath, (err, stats) => {
            if (err || typeof stats?.size !== 'number') {
              // stat 失败保持既有降级语义（交由 readFile 给出真实错误），
              // 不在这里猜原因。
              resolve(null);
              return;
            }
            resolve({
              size: stats.size,
              isDirectory:
                typeof stats.isDirectory === 'function' ? stats.isDirectory() === true : false,
            });
          });
        },
      );
      // 目录无法作为文件预览：显式给出可映射为 4xx 的错误，而不是让
      // sftp.readFile 在远端报一个无信息量的 "Failure"。
      if (stat?.isDirectory === true) {
        throw new SshRemotePathError('directory', remotePath);
      }
      const size = stat?.size ?? null;
      if (size !== null && size > maxReadBytes) {
        throw new Error(
          `SSH file too large to preview: ${size} bytes exceeds limit ${maxReadBytes} bytes`,
        );
      }
    }

    return withSftpTimeout<SSHFilePreview>('readFile', (resolve, reject) => {
      sftp.readFile(remotePath, { encoding: 'utf8' }, (err, data) => {
        if (err) {
          reject(normalizeSftpReadError(remotePath, err));
          return;
        }
        const content = typeof data === 'string' ? data : data.toString('utf8');
        resolve({
          path: remotePath,
          content,
          encoding: 'utf8',
          truncated: false,
        });
      });
    });
  }

  async readFileBytes(
    id: string,
    remotePath: string,
    options?: { maxBytes?: number },
  ): Promise<SSHFileBytes> {
    const sftp = await this.getSftp(id);

    // 与 readFile 不同：这里既要 size，也要目录标记，且 ENOENT 必须冒泡给
    // 调用方（路由据此映射 404）。因此 stat 失败直接 reject，不做降级。
    const stat = await withSftpTimeout<{ size: number; isDirectory: boolean }>(
      'stat',
      (resolve, reject) => {
        if (typeof sftp.stat !== 'function') {
          reject(new Error('SSH SFTP stat unavailable'));
          return;
        }
        const statFn = sftp.stat.bind(sftp);
        statFn(remotePath, (err, stats) => {
          if (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
            return;
          }
          resolve({
            size: typeof stats?.size === 'number' ? stats.size : 0,
            isDirectory: stats?.isDirectory?.() === true,
          });
        });
      },
    );

    if (stat.isDirectory) {
      return { data: Buffer.alloc(0), size: 0, truncated: false, isDirectory: true };
    }

    const requestedMax = options?.maxBytes ?? stat.size;
    const readBytes = Math.min(stat.size, requestedMax);
    // 未显式指定 maxBytes 时才套用绝对上限（16MB），保持既有超限报错文案。
    if (options?.maxBytes === undefined) {
      const absoluteMax = resolveSshReadMaxBytes();
      if (absoluteMax > 0 && stat.size > absoluteMax) {
        throw new Error(
          `SSH file too large to preview: ${stat.size} bytes exceeds limit ${absoluteMax} bytes`,
        );
      }
    }

    if (readBytes === 0) {
      return {
        data: Buffer.alloc(0),
        size: stat.size,
        truncated: stat.size > 0,
        isDirectory: false,
      };
    }

    const data = await withSftpTimeout<Buffer>('createReadStream', (resolve, reject) => {
      if (typeof sftp.createReadStream !== 'function') {
        reject(new Error('SSH SFTP createReadStream unavailable'));
        return;
      }
      const chunks: Buffer[] = [];
      const stream = sftp.createReadStream(remotePath, { start: 0, end: readBytes - 1 });
      stream.on('data', (chunk: Buffer) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      stream.on('error', (error: Error) => {
        reject(error instanceof Error ? error : new Error(String(error)));
      });
      stream.on('end', () => resolve(Buffer.concat(chunks)));
    });

    return { data, size: stat.size, truncated: stat.size > readBytes, isDirectory: false };
  }

  async writeFile(id: string, remotePath: string, content: string | Uint8Array): Promise<void> {
    const sftp = await this.getSftp(id);
    return withSftpTimeout<void>('writeFile', (resolve, reject) => {
      sftp.writeFile(
        remotePath,
        content,
        typeof content === 'string' ? { encoding: 'utf8' } : {},
        (err) => {
          if (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
            return;
          }
          resolve();
        },
      );
    });
  }

  async listFiles(id: string, remotePath: string): Promise<SSHFileEntry[]> {
    const sftp = await this.getSftp(id);
    return withSftpTimeout<SSHFileEntry[]>('readdir', (resolve, reject) => {
      sftp.readdir(remotePath, (err, list) => {
        if (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
          return;
        }
        resolve(
          list.map((file) => ({
            name: file.filename,
            path: `${remotePath.replace(/\/$/, '')}/${file.filename}`,
            kind:
              file.attrs?.isDirectory?.() || file.longname?.startsWith('d')
                ? ('directory' as const)
                : ('file' as const),
          })),
        );
      });
    });
  }

  private requireClient(id: string): SSHClient {
    const client = this.clients.get(id);
    if (!client) throw new Error(`SSH client not connected: ${id}`);
    return client;
  }

  /**
   * Clear the per-connection self-heal bookkeeping. Called on `addConnection` /
   * `disconnect` so a freshly (re-)established transport never inherits a
   * stale failure count or an in-flight heal promise from a dead one.
   */
  private resetChannelHealState(id: string): void {
    this.channelFailures.delete(id);
    this.lastSelfHealAt.delete(id);
    this.selfHeals.delete(id);
  }

  /**
   * Decide whether a channel-open failure on `id` should trigger a transport
   * rebuild, and perform it (deduped across concurrent failures). Returns
   * `true` when the caller must retry on a FRESH client, `false` when the
   * original error should be surfaced unchanged:
   *
   * - Non channel-open failures (ENOENT, non-zero exit, SFTP op timeout) →
   *   never self-heal; rebuilding the transport would be a no-op at best.
   * - Within the cooldown window after a prior heal → passthrough, so a
   *   rebuild that keeps failing cannot hot-loop.
   * - Below {@link SSH_CHANNEL_EXHAUSTION_THRESHOLD} consecutive failures →
   *   passthrough, so a one-off resource blip is not mistaken for exhaustion.
   *
   * On a genuine trigger we `disconnect` (tears down the dead transport, which
   * also drops any orphaned exec/shell channels back to sshd) then
   * `connect()` to a clean one, and the caller retries once on the new
   * client.
   */
  private async recoverFromChannelExhaustion(id: string, error: unknown): Promise<boolean> {
    if (!isChannelOpenFailure(error)) return false;

    // A successful open elsewhere resets the consecutive counter; any other
    // failure just bumps it. Only run this when not already healing.
    const inflight = this.selfHeals.get(id);
    if (inflight) {
      // Ride the in-flight rebuild; it already accounts for this failure.
      const healed = await inflight;
      return healed;
    }

    const count = (this.channelFailures.get(id) ?? 0) + 1;
    this.channelFailures.set(id, count);
    const lastHeal = this.lastSelfHealAt.get(id) ?? 0;
    if (Date.now() - lastHeal < this.selfHealCooldownMs) return false;
    if (count < SSH_CHANNEL_EXHAUSTION_THRESHOLD) return false;

    const heal = this.runSelfHeal(id);
    this.selfHeals.set(id, heal);
    void heal.finally(() => {
      if (this.selfHeals.get(id) === heal) this.selfHeals.delete(id);
    });
    return heal;
  }

  /**
   * Perform the actual transport rebuild for a healed connection: tear the
   * dead transport down (which also drops any orphaned exec/shell channels
   * back to sshd), then establish a clean one. Resolves `true` when the
   * caller may retry on the fresh client.
   */
  private runSelfHeal(id: string): Promise<boolean> {
    return (async (): Promise<boolean> => {
      try {
        // disconnect() 会清掉该连接的全部自愈状态（含冷却基线），所以这里
        // 在拆掉旧传输之后立刻重新登记冷却基线：无论重建成功还是失败，
        // 冷却期内的后续失败都直接透传，避免重建热循环。
        await this.disconnect(id);
        this.lastSelfHealAt.set(id, Date.now());
        await this.connect(id);
        this.channelFailures.delete(id);
        return true;
      } catch {
        // 重建失败（认证 / 主机密钥 / 网络）：把原错误抛给调用方，而不是这次的
        // 连接错误。此时 disconnect 已清空失败计数、冷却基线已在上方登记，
        // 因此需再累积到阈值且冷却期满才会再次尝试重建，不会形成热循环。
        return false;
      }
    })();
  }

  private getSftp(id: string): Promise<SFTPWrapper> {
    const cached = this.sftps.get(id);
    if (cached) return cached;

    const state: { pending?: Promise<SFTPWrapper>; wrapper?: SFTPWrapper } = {};
    // Drop the cache when this channel self-closes / errors so the next file
    // op opens a fresh one; only delete while the cached promise is still ours.
    const track = (sftp: SFTPWrapper): void => {
      state.wrapper = sftp;
      const invalidate = (): void => {
        if (this.sftps.get(id) === state.pending && state.wrapper === sftp) {
          this.sftps.delete(id);
        }
      };
      sftp.on?.('close', invalidate);
      sftp.on?.('error', invalidate);
    };

    const pending = this.openSftpWithSelfHeal(id, track);
    state.pending = pending;
    this.sftps.set(id, pending);
    // A rejected open must not stay cached, or every later file op inherits the
    // same failure instead of retrying a fresh channel.
    void pending.catch(() => {
      if (this.sftps.get(id) === pending) this.sftps.delete(id);
    });
    return pending;
  }

  /**
   * Open an SFTP channel; on a channel-open failure that reaches the self-heal
   * threshold it rebuilds the transport and retries ONCE, else it propagates
   * the original error. Each attempt is bounded by {@link SSH_SFTP_TIMEOUT_MS}.
   */
  private async openSftpWithSelfHeal(
    id: string,
    track: (sftp: SFTPWrapper) => void,
  ): Promise<SFTPWrapper> {
    try {
      return await this.openSftpOnClient(this.requireClient(id), id, track);
    } catch (error) {
      const recovered = await this.recoverFromChannelExhaustion(id, error);
      if (!recovered) throw error;
      // Transport was rebuilt; reopen on the fresh client.
      return this.openSftpOnClient(this.requireClient(id), id, track);
    }
  }

  private openSftpOnClient(
    client: SSHClient,
    id: string,
    track: (sftp: SFTPWrapper) => void,
  ): Promise<SFTPWrapper> {
    return withSftpTimeout<SFTPWrapper>('sftp', (resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err) {
          // 远端未启用 sftp 子系统时 ssh2 只给裸英文文案；归一后路由才能
          // 映射成「非 500 的可操作提示」。注意这条错误不匹配
          // isChannelOpenFailure，因此不会触发无意义的传输重建自愈。
          reject(normalizeSftpChannelError(err));
          return;
        }
        // Channel opened successfully; reset the consecutive counter so a
        // transient blip does not accumulate toward a rebuild.
        this.channelFailures.delete(id);
        track(sftp);
        resolve(sftp);
      });
    });
  }

  private releaseSftp(id: string): void {
    const pending = this.sftps.get(id);
    if (!pending) return;
    this.sftps.delete(id);
    void pending
      .then((sftp) => {
        try {
          sftp.end?.();
        } catch {
          // A failed close must not mask the caller's disconnect/reconnect flow.
        }
      })
      .catch(() => {
        // The channel never opened; there is nothing to release.
      });
  }
}
