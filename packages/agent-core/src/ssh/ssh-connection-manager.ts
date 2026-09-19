import {
  openSSHTerminal,
  type SSHTerminalClient,
  type SSHTerminalOptions,
} from './ssh-terminal.js';
import type { ClientChannel } from 'ssh2';
import { createHash } from 'node:crypto';
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

export interface SSHConnectionManager {
  addConnection(conn: SSHConnection): void;
  getConnection(id: string): SSHConnection | undefined;
  listConnections(): SSHConnection[];
  connect(id: string): Promise<void>;
  disconnect(id: string): Promise<void>;
  openTerminal?(id: string, options: SSHTerminalOptions): Promise<ClientChannel>;
  execCommand(id: string, command: string, options?: SSHExecOptions): Promise<ExecResult>;
  readFile(id: string, remotePath: string): Promise<SSHFilePreview>;
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
  stat?: (path: string, cb: (err: Error | undefined, stats: { size?: number }) => void) => void;
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
    this.publishStatus({ connectionId: id, status: 'disconnected', intentional: true });
  }

  openTerminal(id: string, options: SSHTerminalOptions): Promise<ClientChannel> {
    return openSSHTerminal(this.requireClient(id), options);
  }

  async execCommand(id: string, command: string, options?: SSHExecOptions): Promise<ExecResult> {
    const client = this.requireClient(id);
    const timeoutMs = options?.timeoutMs ?? SSH_EXEC_TIMEOUT_MS;
    const maxOutputBytes = options?.maxOutputBytes ?? SSH_EXEC_MAX_OUTPUT_BYTES;

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
      const size = await withSftpTimeout<number | null>('stat', (resolve) => {
        statFn(remotePath, (err, stats) => {
          if (err || typeof stats?.size !== 'number') {
            resolve(null);
            return;
          }
          resolve(stats.size);
        });
      });
      if (size !== null && size > maxReadBytes) {
        throw new Error(
          `SSH file too large to preview: ${size} bytes exceeds limit ${maxReadBytes} bytes`,
        );
      }
    }

    return withSftpTimeout<SSHFilePreview>('readFile', (resolve, reject) => {
      sftp.readFile(remotePath, { encoding: 'utf8' }, (err, data) => {
        if (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
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

  private getSftp(id: string): Promise<SFTPWrapper> {
    const cached = this.sftps.get(id);
    if (cached) return cached;

    const client = this.requireClient(id);
    const pending = withSftpTimeout<SFTPWrapper>('sftp', (resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
          return;
        }
        const invalidate = () => {
          if (this.sftps.get(id) === pending) this.sftps.delete(id);
        };
        sftp.on?.('close', invalidate);
        sftp.on?.('error', invalidate);
        resolve(sftp);
      });
    });
    this.sftps.set(id, pending);
    // A rejected open must not stay cached, or every later file op inherits the
    // same failure instead of retrying a fresh channel.
    void pending.catch(() => {
      if (this.sftps.get(id) === pending) this.sftps.delete(id);
    });
    return pending;
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
