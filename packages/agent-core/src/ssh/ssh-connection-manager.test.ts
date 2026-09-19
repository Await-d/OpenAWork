import { randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SSHConnectionManagerImpl, type SSHConnection } from './ssh-connection-manager.js';

type Handlers = Record<string, (...args: unknown[]) => void>;

function makeFakeClient(behavior: 'ready' | 'error' | 'hang') {
  const handlers: Handlers = {};
  let ended = false;
  let connectOptions: unknown;
  const client = {
    on(event: string, cb: (...args: unknown[]) => void) {
      handlers[event] = cb;
      return client;
    },
    connect(opts?: unknown) {
      connectOptions = opts;
      if (behavior === 'ready') queueMicrotask(() => handlers['ready']?.());
      if (behavior === 'error') queueMicrotask(() => handlers['error']?.(new Error('auth failed')));
      // 'hang' never emits.
      return client;
    },
    exec() {},
    sftp() {},
    end() {
      ended = true;
    },
  };
  return {
    client,
    wasEnded: () => ended,
    connectOptions: () => connectOptions,
    handlers: () => handlers,
  };
}

/**
 * 临时改写 ssh-agent 相关环境：`SSH_AUTH_SOCK` 与 `process.platform`，
 * 返回恢复函数，保证用例结束后环境还原。
 */
function stubAgentEnvironment(sock: string | undefined, platform: string): () => void {
  const originalSock = process.env['SSH_AUTH_SOCK'];
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  if (sock === undefined) {
    delete process.env['SSH_AUTH_SOCK'];
  } else {
    process.env['SSH_AUTH_SOCK'] = sock;
  }
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  return () => {
    if (originalSock === undefined) {
      delete process.env['SSH_AUTH_SOCK'];
    } else {
      process.env['SSH_AUTH_SOCK'] = originalSock;
    }
    if (platformDescriptor) {
      Object.defineProperty(process, 'platform', platformDescriptor);
    }
  };
}

function conn(id: string): SSHConnection {
  return {
    id,
    name: id,
    host: 'h',
    port: 22,
    username: 'u',
    authType: 'password',
    password: 'p',
    status: 'disconnected',
    createdAt: 0,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('SSHConnectionManagerImpl.connect timeout', () => {
  it('握手既不 ready 也不 error 时，30s 后超时 reject 并 end 半开连接', async () => {
    vi.useFakeTimers();
    const fake = makeFakeClient('hang');
    const mgr = new SSHConnectionManagerImpl({ clientFactory: () => Promise.resolve(fake.client) });
    mgr.addConnection(conn('c1'));

    const p = mgr.connect('c1');
    const assertion = expect(p).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;

    expect(fake.wasEnded()).toBe(true);
    expect(mgr.getStatus('c1')).toBe('error');
  });

  it('ready 事件正常 resolve 并标记 connected', async () => {
    const fake = makeFakeClient('ready');
    const mgr = new SSHConnectionManagerImpl({ clientFactory: () => Promise.resolve(fake.client) });
    mgr.addConnection(conn('c2'));
    await expect(mgr.connect('c2')).resolves.toBeUndefined();
    expect(mgr.getStatus('c2')).toBe('connected');
  });

  it('error 事件 reject 并标记 error', async () => {
    const fake = makeFakeClient('error');
    const mgr = new SSHConnectionManagerImpl({ clientFactory: () => Promise.resolve(fake.client) });
    mgr.addConnection(conn('c3'));
    await expect(mgr.connect('c3')).rejects.toThrow(/auth failed/);
    expect(mgr.getStatus('c3')).toBe('error');
  });
});

describe('SSHConnectionManagerImpl.connect key auth', () => {
  it('带粘贴式 privateKey 时使用 trim 后的内容连接，且不读取 privateKeyPath 指向的文件', async () => {
    const fake = makeFakeClient('ready');
    const mgr = new SSHConnectionManagerImpl({ clientFactory: () => Promise.resolve(fake.client) });
    mgr.addConnection({
      ...conn('k1'),
      authType: 'key',
      password: undefined,
      // 指向不存在的文件：一旦误走读文件分支，会以 ENOENT 拒绝而不是解析成功。
      privateKeyPath: '/nonexistent/openawork-test-key',
      privateKey:
        '  -----BEGIN OPENSSH PRIVATE KEY-----\nAAA\n-----END OPENSSH PRIVATE KEY-----\n  ',
    });

    await expect(mgr.connect('k1')).resolves.toBeUndefined();
    expect(fake.connectOptions()).toMatchObject({
      privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nAAA\n-----END OPENSSH PRIVATE KEY-----',
    });
    expect(mgr.getStatus('k1')).toBe('connected');
  });

  it('缺少 privateKey 与 privateKeyPath 时用明确错误拒绝', async () => {
    const fake = makeFakeClient('ready');
    const mgr = new SSHConnectionManagerImpl({ clientFactory: () => Promise.resolve(fake.client) });
    mgr.addConnection({
      ...conn('k2'),
      authType: 'key',
      password: undefined,
      privateKeyPath: undefined,
      privateKey: undefined,
    });

    await expect(mgr.connect('k2')).rejects.toThrow(
      'SSH key auth requires a private key or a private key path',
    );
  });

  it('仅提供 privateKeyPath 时仍按原行为读取文件内容', async () => {
    const keyPath = join(tmpdir(), `openawork-ssh-key-${randomUUID()}`);
    await writeFile(keyPath, 'FILE-KEY-CONTENT', 'utf8');
    try {
      const fake = makeFakeClient('ready');
      const mgr = new SSHConnectionManagerImpl({
        clientFactory: () => Promise.resolve(fake.client),
      });
      mgr.addConnection({
        ...conn('k3'),
        authType: 'key',
        password: undefined,
        privateKeyPath: keyPath,
      });

      await expect(mgr.connect('k3')).resolves.toBeUndefined();
      expect(fake.connectOptions()).toMatchObject({ privateKey: 'FILE-KEY-CONTENT' });
    } finally {
      await rm(keyPath, { force: true });
    }
  });
});

describe('SSHConnectionManagerImpl.connect auth methods', () => {
  it('key 认证带 passphrase 时把 passphrase 透传给客户端', async () => {
    const fake = makeFakeClient('ready');
    const mgr = new SSHConnectionManagerImpl({ clientFactory: () => Promise.resolve(fake.client) });
    mgr.addConnection({
      ...conn('m1'),
      authType: 'key',
      password: undefined,
      privateKey: 'ENCRYPTED-KEY',
      passphrase: 'KEY-PASSPHRASE',
    });

    await expect(mgr.connect('m1')).resolves.toBeUndefined();
    expect(fake.connectOptions()).toMatchObject({
      privateKey: 'ENCRYPTED-KEY',
      passphrase: 'KEY-PASSPHRASE',
    });
  });

  it('key-password 同时设置密码与私钥，并显式指定 publickey→password 认证顺序', async () => {
    const fake = makeFakeClient('ready');
    const mgr = new SSHConnectionManagerImpl({ clientFactory: () => Promise.resolve(fake.client) });
    mgr.addConnection({
      ...conn('m2'),
      authType: 'key-password',
      privateKey: 'MULTI-FACTOR-KEY',
      password: 'MULTI-FACTOR-PASSWORD',
    });

    await expect(mgr.connect('m2')).resolves.toBeUndefined();
    expect(fake.connectOptions()).toMatchObject({
      privateKey: 'MULTI-FACTOR-KEY',
      password: 'MULTI-FACTOR-PASSWORD',
      tryKeyboard: true,
      authHandler: ['publickey', 'password'],
    });
  });

  it('key-password 缺少密码时快速失败而不是静默降级为单因子', async () => {
    const fake = makeFakeClient('ready');
    const mgr = new SSHConnectionManagerImpl({ clientFactory: () => Promise.resolve(fake.client) });
    mgr.addConnection({
      ...conn('m2b'),
      authType: 'key-password',
      privateKey: 'MULTI-FACTOR-KEY',
      password: undefined,
    });

    await expect(mgr.connect('m2b')).rejects.toThrow(
      'SSH key+password auth requires both a private key and a password',
    );
  });

  it('password 认证开启 keyboard-interactive 并携带密码', async () => {
    const fake = makeFakeClient('ready');
    const mgr = new SSHConnectionManagerImpl({ clientFactory: () => Promise.resolve(fake.client) });
    mgr.addConnection({ ...conn('m3'), authType: 'password', password: 'ONLY-PASSWORD' });

    await expect(mgr.connect('m3')).resolves.toBeUndefined();
    expect(fake.connectOptions()).toMatchObject({
      password: 'ONLY-PASSWORD',
      tryKeyboard: true,
    });
  });

  it('keyboard-interactive 单条密码提示用已存储的密码应答', async () => {
    const fake = makeFakeClient('ready');
    const mgr = new SSHConnectionManagerImpl({ clientFactory: () => Promise.resolve(fake.client) });
    mgr.addConnection({ ...conn('m4'), authType: 'password', password: 'CHALLENGE-PASSWORD' });

    await expect(mgr.connect('m4')).resolves.toBeUndefined();
    const handler = fake.handlers()['keyboard-interactive'];
    expect(handler).toBeTypeOf('function');

    const answers: string[][] = [];
    handler?.('ssh', 'verify', 'en', ['Password:'], (responses: string[]) => {
      answers.push(responses);
    });
    expect(answers).toEqual([['CHALLENGE-PASSWORD']]);
  });

  it('keyboard-interactive 多条提示（PAM/2FA）不下发账户密码', async () => {
    const fake = makeFakeClient('ready');
    const mgr = new SSHConnectionManagerImpl({ clientFactory: () => Promise.resolve(fake.client) });
    mgr.addConnection({ ...conn('m4b'), authType: 'password', password: 'CHALLENGE-PASSWORD' });

    await expect(mgr.connect('m4b')).resolves.toBeUndefined();
    const handler = fake.handlers()['keyboard-interactive'];
    expect(handler).toBeTypeOf('function');

    const answers: string[][] = [];
    handler?.('ssh', 'verify', 'en', ['Password:', 'Verification code:'], (responses: string[]) => {
      answers.push(responses);
    });
    expect(answers).toEqual([['', '']]);
    expect(answers.flat()).not.toContain('CHALLENGE-PASSWORD');
  });

  it('agent 认证在无 SSH_AUTH_SOCK 且非 win32 时抛出明确错误', async () => {
    const restore = stubAgentEnvironment(undefined, 'linux');
    try {
      const fake = makeFakeClient('ready');
      const mgr = new SSHConnectionManagerImpl({
        clientFactory: () => Promise.resolve(fake.client),
      });
      mgr.addConnection({ ...conn('m5'), authType: 'agent', password: undefined });

      await expect(mgr.connect('m5')).rejects.toThrow(
        'SSH agent auth requires SSH_AUTH_SOCK (or a Windows ssh-agent named pipe)',
      );
    } finally {
      restore();
    }
  });

  it('agent 认证在 win32 无 SSH_AUTH_SOCK 时回退到 OpenSSH 命名管道', async () => {
    const restore = stubAgentEnvironment(undefined, 'win32');
    try {
      const fake = makeFakeClient('ready');
      const mgr = new SSHConnectionManagerImpl({
        clientFactory: () => Promise.resolve(fake.client),
      });
      mgr.addConnection({ ...conn('m6'), authType: 'agent', password: undefined });

      await expect(mgr.connect('m6')).resolves.toBeUndefined();
      expect(fake.connectOptions()).toMatchObject({
        agent: '\\\\.\\pipe\\openssh-ssh-agent',
      });
    } finally {
      restore();
    }
  });
});
