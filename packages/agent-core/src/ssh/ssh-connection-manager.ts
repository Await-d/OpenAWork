import { readFile } from 'node:fs/promises';

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
  authType: 'password' | 'key' | 'agent';
  privateKeyPath?: string;
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
  execCommand(id: string, command: string, options?: SSHExecOptions): Promise<ExecResult>;
  readFile(id: string, remotePath: string): Promise<SSHFilePreview>;
  writeFile(id: string, remotePath: string, content: string | Uint8Array): Promise<void>;
  listFiles(id: string, remotePath: string): Promise<SSHFileEntry[]>;
  getStatus(id: string): SSHConnection['status'];
}

interface SSHConnectionManagerOptions {
  clients?: Map<string, SSHClient>;
  /**
   * Factory for a fresh SSH client. Defaults to dynamically importing the
   * optional `ssh2` peer dependency. Injectable for tests and for runtimes
   * that provide their own transport.
   */
  clientFactory?: () => Promise<SSHClient>;
}

type SSHClient = {
  exec: (cmd: string, cb: (err: Error | undefined, stream: SSHStream) => void) => void;
  sftp: (cb: (err: Error | undefined, sftp: SFTPWrapper) => void) => void;
  end: () => void;
  on: (event: string, cb: (...args: unknown[]) => void) => SSHClient;
  connect: (opts: SSHConnectOptions) => SSHClient;
};

type SSHStream = {
  on: (event: string, cb: (data: Buffer) => void) => SSHStream;
  stderr: { on: (event: string, cb: (data: Buffer) => void) => void };
  close: (cb: (code: number) => void) => void;
  /** Best-effort teardown used to abort a hung command on timeout. */
  destroy?: () => void;
};

type SFTPWrapper = {
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

type SSHConnectOptions = {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  agent?: string;
  /** ssh2 handshake timeout (ms). Bounds the connect attempt server-side. */
  readyTimeout?: number;
};

type SSH2Module = { Client: new () => SSHClient };

// ssh2 is an optional peer dependency; loaded dynamically at runtime
async function loadSSHClient(): Promise<SSHClient> {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const ssh2 = (await (Function(
    'm',
    'return import(m)',
  )('ssh2') as Promise<unknown>)) as SSH2Module;
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
  private readonly clientFactory: () => Promise<SSHClient>;

  constructor(options: SSHConnectionManagerOptions = {}) {
    if (options.clients) {
      this.clients = options.clients;
    }
    this.clientFactory = options.clientFactory ?? loadSSHClient;
  }

  addConnection(conn: SSHConnection): void {
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

  async connect(id: string): Promise<void> {
    const conn = this.connections.get(id);
    if (!conn) throw new Error(`SSH connection not found: ${id}`);

    const client = await this.clientFactory();
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        fn();
      };
      timer = setTimeout(() => {
        finish(() => {
          this.connections.set(id, { ...conn, status: 'error' });
          try {
            client.end();
          } catch {
            // best-effort teardown of the half-open connection
          }
          reject(new Error(`SSH connect timed out after ${SSH_CONNECT_TIMEOUT_MS}ms`));
        });
      }, SSH_CONNECT_TIMEOUT_MS);

      const connectWithResolvedOptions = async () => {
        const opts: SSHConnectOptions = {
          host: conn.host,
          port: conn.port,
          username: conn.username,
          readyTimeout: SSH_CONNECT_TIMEOUT_MS,
        };

        if (conn.authType === 'password' && conn.password) {
          opts.password = conn.password;
        } else if (conn.authType === 'key' && conn.privateKeyPath) {
          const keyContent = await readFile(conn.privateKeyPath, 'utf8');
          opts.privateKey = keyContent;
        } else if (conn.authType === 'agent') {
          const proc = (globalThis as unknown as { process?: { env?: Record<string, string> } })
            .process;
          opts.agent = proc?.env?.['SSH_AUTH_SOCK'];
        }

        client
          .on('ready', () => {
            finish(() => {
              this.clients.set(id, client);
              this.connections.set(id, { ...conn, status: 'connected' });
              resolve();
            });
          })
          .on('error', (err: unknown) => {
            finish(() => {
              this.connections.set(id, { ...conn, status: 'error' });
              reject(err instanceof Error ? err : new Error(String(err)));
            });
          })
          .connect(opts);
      };

      void connectWithResolvedOptions().catch((err: unknown) => {
        finish(() => reject(err instanceof Error ? err : new Error(String(err))));
      });
    });
  }

  async disconnect(id: string): Promise<void> {
    const client = this.clients.get(id);
    if (client) {
      client.end();
      this.clients.delete(id);
    }
    const conn = this.connections.get(id);
    if (conn) this.connections.set(id, { ...conn, status: 'disconnected' });
  }

  async execCommand(id: string, command: string, options?: SSHExecOptions): Promise<ExecResult> {
    const client = this.requireClient(id);
    const timeoutMs = options?.timeoutMs ?? SSH_EXEC_TIMEOUT_MS;
    const maxOutputBytes = options?.maxOutputBytes ?? SSH_EXEC_MAX_OUTPUT_BYTES;

    return new Promise((resolve, reject) => {
      client.exec(command, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }

        let stdout = '';
        let stderr = '';
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let stdoutTruncated = false;
        let stderrTruncated = false;
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;

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

        // Wall-clock guard: a remote command that never exits (or a stream that
        // never emits `close`) would otherwise leave this promise pending
        // forever and leak the channel. On timeout best-effort destroy the
        // stream and resolve with whatever output we captured, flagged timedOut.
        if (timeoutMs > 0) {
          timer = setTimeout(() => {
            finish(() => {
              try {
                stream.destroy?.();
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

        stream.on('data', appendStdout).stderr.on('data', appendStderr);
        stream.close((code: number) => {
          finish(() => {
            resolve({
              stdout,
              stderr,
              exitCode: code,
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
    const client = this.requireClient(id);
    return withSftpTimeout<SFTPWrapper>('sftp', (resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
          return;
        }
        resolve(sftp);
      });
    });
  }
}
