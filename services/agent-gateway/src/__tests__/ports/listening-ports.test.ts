import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  collectProcfsListeningPorts,
  detectPortEnumerationStrategy,
  listListeningPorts,
  parseLsofOutput,
  parsePowerShellOutput,
  parseProcNetTcpContent,
  resetListeningPortsCacheForTests,
  type ListeningPort,
  type ProcfsIo,
} from '../../ports/listening-ports.js';

/**
 * 所有策略解析都必须走注入的 exec / 假 /proc 内容——本文件不得真的起进程，
 * 也不得依赖真实 /proc。
 */

const PROC_NET_TCP = [
  '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode',
  '   0: 00000000:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 12345 1 0000000000000000 100 0 0 10 0',
  '   1: 0100007F:8707 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 23456 1 0000000000000000 100 0 0 10 0',
  '   2: 0100007F:0016 00000000:0000 01 00000000:00000000 00:00000000 00000000     0        0 34567 1 0000000000000000 100 0 0 10 0',
  '   garbage line that must be ignored',
  '',
].join('\n');

const PROC_NET_TCP6 = [
  '  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode',
  '   0: 00000000000000000000000001000000:1F90 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 45678 1 0000000000000000 100 0 0 10 0',
  '   1: 00000000000000000000000000000000:0016 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 56789 1 0000000000000000 100 0 0 10 0',
  '',
].join('\n');

const LSOF_OUTPUT = [
  'COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME',
  'node    11111 user   23u  IPv4  0x1      0t0  TCP *:3000 (LISTEN)',
  'redis   22222 user   24u  IPv4  0x2      0t0  TCP 127.0.0.1:6379 (LISTEN)',
  'node    33333 user   25u  IPv4  0x3      0t0  TCP 127.0.0.1:34567 (LISTEN)',
  'python  44444 user   26u  IPv6  0x4      0t0  TCP *:8080 (LISTEN)',
  'python  44444 user   27u  IPv6  0x5      0t0  TCP [::1]:9000 (LISTEN)',
  'not-enough-columns',
  '',
].join('\n');

interface FakeProcfs {
  files: Record<string, string>;
  dirs: Record<string, string[]>;
  links: Record<string, string>;
}

function createFakeProcfsIo(fake: FakeProcfs): ProcfsIo {
  return {
    async readTextFile(path) {
      const content = fake.files[path];
      if (content === undefined) {
        throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      }
      return content;
    },
    async readDirNames(path) {
      const names = fake.dirs[path];
      if (names === undefined) {
        throw new Error(`EACCES: permission denied, scandir '${path}'`);
      }
      return names;
    },
    async readLink(path) {
      const target = fake.links[path];
      if (target === undefined) {
        throw new Error(`ENOENT: no such file or directory, readlink '${path}'`);
      }
      return target;
    },
  };
}

function createFakeProcfs(): ProcfsIo {
  return createFakeProcfsIo({
    files: {
      '/proc/net/tcp': PROC_NET_TCP,
      '/proc/net/tcp6': PROC_NET_TCP6,
      '/proc/4321/comm': 'node\n',
      '/proc/5555/comm': 'python3\n',
    },
    dirs: {
      '/proc': ['4321', '5555', 'self', '1'],
      '/proc/4321/fd': ['0', '7'],
      '/proc/5555/fd': ['0'],
    },
    links: {
      '/proc/4321/fd/7': 'socket:[12345]',
      '/proc/5555/fd/0': 'socket:[45678]',
    },
  });
}

function findPort(
  ports: ListeningPort[],
  port: number,
  protocol: ListeningPort['protocol'],
): ListeningPort | undefined {
  return ports.find((entry) => entry.port === port && entry.protocol === protocol);
}

beforeEach(() => {
  vi.unstubAllEnvs();
  delete process.env['OPENAWORK_PORTS_ENUMERATION_TTL_MS'];
  delete process.env['GATEWAY_PORT'];
  delete process.env['REDIS_URL'];
  resetListeningPortsCacheForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('detectPortEnumerationStrategy', () => {
  it('linux / darwin / win32 各自映射到 procfs / lsof / powershell', () => {
    expect(detectPortEnumerationStrategy('linux')).toEqual({ strategy: 'procfs' });
    expect(detectPortEnumerationStrategy('darwin')).toEqual({ strategy: 'lsof' });
    expect(detectPortEnumerationStrategy('win32')).toEqual({ strategy: 'powershell' });
  });

  it('未知平台 → strategy null 并给出 reason', () => {
    const detected = detectPortEnumerationStrategy('freebsd');
    expect(detected.strategy).toBeNull();
    expect(detected.reason).toContain('freebsd');
  });
});

describe('parseProcNetTcpContent', () => {
  it('解析 hex 地址与端口，只保留 0A（LISTEN）状态', () => {
    const entries = parseProcNetTcpContent(PROC_NET_TCP, 'tcp');
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ port: 8080, bindAddress: '0.0.0.0', protocol: 'tcp' });
    expect(entries[1]).toMatchObject({ port: 34567, bindAddress: '127.0.0.1' });
    // state 01（ESTABLISHED）与 garbage 行均被丢弃
    expect(entries.some((entry) => entry.port === 22)).toBe(false);
  });

  it('tcp6 的 4 段小端字被格式化为压缩 IPv6；格式异常行不抛错', () => {
    const entries = parseProcNetTcpContent(PROC_NET_TCP6, 'tcp6');
    expect(entries.map((entry) => entry.bindAddress)).toEqual(['::1', '::']);
    expect(parseProcNetTcpContent('garbage\n1: xx\n', 'tcp')).toEqual([]);
    expect(parseProcNetTcpContent('', 'tcp6')).toEqual([]);
  });
});

describe('collectProcfsListeningPorts', () => {
  it('用 socket:[inode] 反查 pid/进程名；查不到权限时 pid 为 null 而不是失败', async () => {
    const outcome = await collectProcfsListeningPorts(createFakeProcfs());
    expect(outcome.reason).toBeUndefined();

    const wildcard = findPort(outcome.ports, 8080, 'tcp');
    expect(wildcard).toMatchObject({
      bindAddress: '0.0.0.0',
      pid: 4321,
      processName: 'node',
      source: 'procfs',
    });

    // inode 23456 没有任何 /proc/<pid>/fd 指向它 → 保持 null
    const loopback = findPort(outcome.ports, 34567, 'tcp');
    expect(loopback).toMatchObject({ bindAddress: '127.0.0.1', pid: null, processName: null });

    const ipv6Loopback = findPort(outcome.ports, 8080, 'tcp6');
    expect(ipv6Loopback).toMatchObject({ bindAddress: '::1', pid: 5555, processName: 'python3' });
  });

  it('/proc/net/tcp 完全不可读时降级为 reason 而不是抛错', async () => {
    const io: ProcfsIo = {
      async readTextFile() {
        throw new Error('EACCES: permission denied');
      },
      async readDirNames() {
        throw new Error('EACCES: permission denied');
      },
      async readLink() {
        throw new Error('EACCES: permission denied');
      },
    };
    const outcome = await collectProcfsListeningPorts(io);
    expect(outcome.ports).toEqual([]);
    expect(outcome.reason).toContain('/proc/net/tcp');
  });
});

describe('parseLsofOutput / parsePowerShellOutput', () => {
  it('lsof 行解析出 pid / 进程名 / 绑定地址', () => {
    const ports = parseLsofOutput(LSOF_OUTPUT);
    expect(findPort(ports, 34567, 'tcp')).toMatchObject({
      bindAddress: '127.0.0.1',
      pid: 33333,
      processName: 'node',
      source: 'lsof',
    });
    expect(findPort(ports, 8080, 'tcp6')).toMatchObject({ bindAddress: '::' });
    expect(findPort(ports, 9000, 'tcp6')).toMatchObject({ bindAddress: '::1', pid: 44444 });
    expect(ports.some((entry) => entry.port === 3000)).toBe(true);
  });

  it('powershell 的单个 JSON 对象也按数组处理；非法 JSON 返回空数组', () => {
    const single = parsePowerShellOutput(
      JSON.stringify({ address: '127.0.0.1', port: 34567, pid: 4321, name: 'node' }),
    );
    expect(single).toEqual([
      {
        port: 34567,
        protocol: 'tcp',
        bindAddress: '127.0.0.1',
        pid: 4321,
        processName: 'node',
        source: 'powershell',
      },
    ]);
    expect(parsePowerShellOutput('not json')).toEqual([]);
    expect(parsePowerShellOutput('')).toEqual([]);
  });
});

describe('listListeningPorts', () => {
  it('过滤网关自身端口与 Redis 端口，其余按端口升序保留', async () => {
    vi.stubEnv('GATEWAY_PORT', '3000');
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
    const exec = vi.fn(async () => ({ stdout: LSOF_OUTPUT, stderr: '' }));

    const snapshot = await listListeningPorts({ strategy: 'lsof', exec });

    expect(snapshot.strategy).toBe('lsof');
    expect(snapshot.reason).toBeUndefined();
    expect(snapshot.ports.map((entry) => entry.port)).toEqual([8080, 9000, 34567]);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(snapshot.collectedAtMs).toBeGreaterThan(0);
  });

  it('GATEWAY_PORT / REDIS_URL 覆盖后按新端口过滤', async () => {
    vi.stubEnv('GATEWAY_PORT', '3100');
    vi.stubEnv('REDIS_URL', 'redis://user:pass@localhost:6380/0');
    const stdout = [
      'COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME',
      'node    11111 user   23u  IPv4  0x1      0t0  TCP *:3000 (LISTEN)',
      'redis   22222 user   24u  IPv4  0x2      0t0  TCP 127.0.0.1:6379 (LISTEN)',
      'node    33333 user   25u  IPv4  0x3      0t0  TCP *:3100 (LISTEN)',
      'redis   44444 user   26u  IPv4  0x4      0t0  TCP 127.0.0.1:6380 (LISTEN)',
      '',
    ].join('\n');

    const snapshot = await listListeningPorts({
      strategy: 'lsof',
      exec: async () => ({ stdout, stderr: '' }),
    });

    expect(snapshot.ports.map((entry) => entry.port)).toEqual([3000, 6379]);
  });

  it('超时 → 降级为空列表并带 reason，不抛错也不挂起', async () => {
    const never = vi.fn(() => new Promise<{ stdout: string; stderr: string }>(() => {}));
    const snapshot = await listListeningPorts({ strategy: 'lsof', exec: never, timeoutMs: 10 });

    expect(snapshot.ports).toEqual([]);
    expect(snapshot.strategy).toBe('lsof');
    expect(snapshot.reason).toContain('超时');
  });

  it('exec 抛错 → 降级为空列表并带 reason', async () => {
    const failing = vi.fn(async () => {
      throw new Error('lsof: command not found');
    });
    const snapshot = await listListeningPorts({ strategy: 'lsof', exec: failing });

    expect(snapshot.ports).toEqual([]);
    expect(snapshot.strategy).toBe('lsof');
    expect(snapshot.reason).toContain('command not found');
  });

  it('TTL 内缓存命中不重复执行，过期后重新枚举', async () => {
    vi.stubEnv('OPENAWORK_PORTS_ENUMERATION_TTL_MS', '3000');
    const clock = { value: 1_000 };
    const exec = vi.fn(async () => ({ stdout: LSOF_OUTPUT, stderr: '' }));
    const now = () => clock.value;

    await listListeningPorts({ strategy: 'lsof', exec, now });
    expect(exec).toHaveBeenCalledTimes(1);

    clock.value += 2_999;
    await listListeningPorts({ strategy: 'lsof', exec, now });
    expect(exec).toHaveBeenCalledTimes(1);

    clock.value += 2;
    await listListeningPorts({ strategy: 'lsof', exec, now });
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it('并发调用共享同一次枚举（单飞）', async () => {
    let release: ((value: { stdout: string; stderr: string }) => void) | undefined;
    const exec = vi.fn(
      () =>
        new Promise<{ stdout: string; stderr: string }>((resolve) => {
          release = resolve;
        }),
    );

    const first = listListeningPorts({ strategy: 'lsof', exec });
    const second = listListeningPorts({ strategy: 'lsof', exec });
    expect(exec).toHaveBeenCalledTimes(1);

    release?.({ stdout: LSOF_OUTPUT, stderr: '' });
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(exec).toHaveBeenCalledTimes(1);
    expect(firstResult).toBe(secondResult);
    expect(firstResult.ports.map((entry) => entry.port)).toEqual([8080, 9000, 34567]);
  });

  it('strategy: "powershell" 走 Get-NetTCPConnection 输出解析', async () => {
    vi.stubEnv('GATEWAY_PORT', '3000');
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
    const payload = JSON.stringify([
      { address: '127.0.0.1', port: 34567, pid: 4321, name: 'node' },
      { address: '::', port: 8080, pid: 5555, name: 'python' },
      { address: '0.0.0.0', port: 3000, pid: 999, name: 'gateway' },
    ]);
    const exec = vi.fn(async (cmd: string) => {
      expect(cmd).toBe('powershell');
      return { stdout: payload, stderr: '' };
    });

    const snapshot = await listListeningPorts({ strategy: 'powershell', exec });

    expect(snapshot.strategy).toBe('powershell');
    expect(snapshot.ports.map((entry) => entry.port)).toEqual([8080, 34567]);
    expect(findPort(snapshot.ports, 34567, 'tcp')).toMatchObject({ pid: 4321 });
    expect(findPort(snapshot.ports, 8080, 'tcp6')).toMatchObject({ bindAddress: '::' });
  });
});
