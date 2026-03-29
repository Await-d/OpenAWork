import { readFile } from 'node:fs/promises';

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
  execCommand(id: string, command: string): Promise<ExecResult>;
  readFile(id: string, remotePath: string): Promise<SSHFilePreview>;
  writeFile(id: string, remotePath: string, content: string | Uint8Array): Promise<void>;
  listFiles(id: string, remotePath: string): Promise<SSHFileEntry[]>;
  getStatus(id: string): SSHConnection['status'];
}

interface SSHConnectionManagerOptions {
  clients?: Map<string, SSHClient>;
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
};

type SSHConnectOptions = {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  agent?: string;
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

export class SSHConnectionManagerImpl implements SSHConnectionManager {
  private connections = new Map<string, SSHConnection>();
  private clients = new Map<string, SSHClient>();

  constructor(options: SSHConnectionManagerOptions = {}) {
    if (options.clients) {
      this.clients = options.clients;
    }
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

    const client = await loadSSHClient();
    return new Promise((resolve, reject) => {
      const connectWithResolvedOptions = async () => {
        const opts: SSHConnectOptions = {
          host: conn.host,
          port: conn.port,
          username: conn.username,
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
            this.clients.set(id, client);
            this.connections.set(id, { ...conn, status: 'connected' });
            resolve();
          })
          .on('error', (err: unknown) => {
            this.connections.set(id, { ...conn, status: 'error' });
            reject(err instanceof Error ? err : new Error(String(err)));
          })
          .connect(opts);
      };

      void connectWithResolvedOptions().catch(reject);
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

  async execCommand(id: string, command: string): Promise<ExecResult> {
    const client = this.requireClient(id);
    return new Promise((resolve, reject) => {
      client.exec(command, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }
        let stdout = '';
        let stderr = '';
        let exitCode = 0;
        stream
          .on('data', (data: Buffer) => {
            stdout += data.toString();
          })
          .stderr.on('data', (data: Buffer) => {
            stderr += data.toString();
          });
        stream.close((code: number) => {
          exitCode = code;
          resolve({ stdout, stderr, exitCode });
        });
      });
    });
  }

  async readFile(id: string, remotePath: string): Promise<SSHFilePreview> {
    const sftp = await this.getSftp(id);
    return new Promise((resolve, reject) => {
      sftp.readFile(remotePath, { encoding: 'utf8' }, (err, data) => {
        if (err) {
          reject(err);
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
    return new Promise((resolve, reject) => {
      sftp.writeFile(
        remotePath,
        content,
        typeof content === 'string' ? { encoding: 'utf8' } : {},
        (err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        },
      );
    });
  }

  async listFiles(id: string, remotePath: string): Promise<SSHFileEntry[]> {
    const sftp = await this.getSftp(id);
    return new Promise((resolve, reject) => {
      sftp.readdir(remotePath, (err, list) => {
        if (err) {
          reject(err);
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
    return new Promise((resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(sftp);
      });
    });
  }
}
