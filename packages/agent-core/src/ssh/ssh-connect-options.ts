import { readFile } from 'node:fs/promises';
import type { SSHConnection } from './ssh-connection-manager.js';

export type SSHConnectOptions = {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  /** 解密加密私钥所需的口令。 */
  passphrase?: string;
  /** 允许 keyboard-interactive 挑战，由已存储的密码逐条应答。 */
  tryKeyboard?: boolean;
  /**
   * 显式认证方式顺序。仅多因子（publickey + password）需要覆盖 ssh2 默认
   * 的 password-before-publickey 顺序，否则二次认证不会重试 password。
   */
  authHandler?: string[];
  agent?: string;
  /** ssh2 handshake timeout (ms). Bounds the connect attempt server-side. */
  readyTimeout?: number;
  keepaliveInterval?: number;
  keepaliveCountMax?: number;
  hostVerifier?: (key: Buffer, callback: (trusted: boolean) => void) => void;
};

function resolveSshAgentAddress(): string | undefined {
  const proc = (
    globalThis as unknown as {
      process?: { env?: Record<string, string>; platform?: string };
    }
  ).process;
  const socketPath = proc?.env?.['SSH_AUTH_SOCK']?.trim();
  if (socketPath) return socketPath;
  if (proc?.platform === 'win32') return '\\\\.\\pipe\\openssh-ssh-agent';
  return undefined;
}

export async function resolveSshConnectOptions(conn: SSHConnection): Promise<SSHConnectOptions> {
  const opts: SSHConnectOptions = {
    host: conn.host,
    port: conn.port,
    username: conn.username,
    readyTimeout: 30_000,
    keepaliveInterval: 15_000,
    keepaliveCountMax: 3,
  };
  const passwordAuth = conn.authType === 'password' || conn.authType === 'key-password';
  const keyAuth = conn.authType === 'key' || conn.authType === 'key-password';
  const multiFactorAuth = conn.authType === 'key-password';

  // 多因子缺一不可：静默降级为单因子会掩盖配置错误。
  if (multiFactorAuth && !conn.password) {
    throw new Error('SSH key+password auth requires both a private key and a password');
  }

  if (passwordAuth && conn.password) {
    opts.password = conn.password;
    opts.tryKeyboard = true;
  }

  if (keyAuth) {
    // 优先使用粘贴式私钥内容；内容为空时才回退到读取私钥文件。
    const pastedKey = conn.privateKey?.trim();
    if (pastedKey) {
      opts.privateKey = pastedKey;
    } else if (conn.privateKeyPath) {
      const keyContent = await readFile(conn.privateKeyPath, 'utf8');
      opts.privateKey = keyContent;
    } else {
      throw new Error('SSH key auth requires a private key or a private key path');
    }
    if (conn.passphrase) {
      opts.passphrase = conn.passphrase;
    }
  }

  if (multiFactorAuth) {
    // ssh2 默认顺序是 password 先于 publickey，服务端要求
    // `AuthenticationMethods publickey,password` 时 publickey 部分成功后
    // 不会回头重试 password；显式指定顺序才能完成第二次认证。
    opts.authHandler = ['publickey', 'password'];
  }

  if (conn.authType === 'agent') {
    const agentAddress = resolveSshAgentAddress();
    if (!agentAddress) {
      throw new Error('SSH agent auth requires SSH_AUTH_SOCK (or a Windows ssh-agent named pipe)');
    }
    opts.agent = agentAddress;
  }

  return opts;
}
