import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  collectProcfsListeningPorts,
  defaultEnumerationTimeoutMs,
  detectPortEnumerationStrategy,
  listListeningPorts,
  parseLsofOutput,
  parsePowerShellOutput,
  parseProcNetTcpContent,
  parseProcStatPpid,
  resetListeningPortsCacheForTests,
  resolveOwnedTerminalForPid,
  type ListeningPort,
  type ProcfsIo,
  type TerminalAttribution,
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

/** 生成一行 `/proc/net/tcp{,6}` 记录：字段顺序与内核一致（sl / local / remote / st / … / inode）。 */
function procNetTcpLine(
  slot: number,
  local: string,
  state: string,
  inode: number,
  remote = '00000000:0000',
): string {
  return `  ${slot}: ${local} ${remote} ${state} 00000000:00000000 00:00000000 00000000     0        0 ${inode} 1 0000000000000000 100 0 0 10 0`;
}

/** 混合状态夹具：8080 监听中且有 2 条 ESTABLISHED；22 只有 ESTABLISHED（不是监听端口）。 */
const PROC_NET_TCP_MIXED = [
  '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode',
  procNetTcpLine(0, '00000000:1F90', '0A', 11111),
  procNetTcpLine(1, '00000000:1F90', '01', 0, '0100007F:C001'),
  procNetTcpLine(2, '00000000:1F90', '01', 0, '0100007F:C002'),
  procNetTcpLine(3, '00000000:1388', '0A', 22222),
  procNetTcpLine(4, '0100007F:8707', '0A', 33333),
  procNetTcpLine(5, '0100007F:0016', '01', 0, '0A000001:C350'),
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
      '/proc/4321/stat': statLine(4321, 'node', 1),
      '/proc/5555/comm': 'python3\n',
      '/proc/5555/stat': statLine(5555, 'python3', 1),
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
  it('解析 hex 地址与端口，只保留 0A（LISTEN）状态；01 行只进计数不成条目', () => {
    const parsed = parseProcNetTcpContent(PROC_NET_TCP, 'tcp');
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.entries[0]).toMatchObject({
      port: 8080,
      bindAddress: '0.0.0.0',
      protocol: 'tcp',
    });
    expect(parsed.entries[1]).toMatchObject({ port: 34567, bindAddress: '127.0.0.1' });
    // state 01（ESTABLISHED）与 garbage 行均不进条目；01 行按本地端口计数。
    expect(parsed.entries.some((entry) => entry.port === 22)).toBe(false);
    expect(parsed.establishedCountByPort.get(22)).toBe(1);
    // 没有 ESTABLISHED 行的监听端口不产生计数条目（消费方按 0 处理）。
    expect(parsed.establishedCountByPort.get(8080)).toBeUndefined();
  });

  it('tcp6 的 4 段小端字被格式化为压缩 IPv6；格式异常行不抛错', () => {
    const entries = parseProcNetTcpContent(PROC_NET_TCP6, 'tcp6').entries;
    expect(entries.map((entry) => entry.bindAddress)).toEqual(['::1', '::']);
    expect(parseProcNetTcpContent('garbage\n1: xx\n', 'tcp').entries).toEqual([]);
    expect(parseProcNetTcpContent('', 'tcp6').entries).toEqual([]);
  });

  it('一次解析同时给出 LISTEN 条目与按本地端口聚合的 ESTABLISHED 计数', () => {
    const parsed = parseProcNetTcpContent(PROC_NET_TCP_MIXED, 'tcp');
    expect(parsed.entries.map((entry) => entry.port)).toEqual([8080, 5000, 34567]);
    // 8080 有 2 条 ESTABLISHED（本地端口都是 8080）；22 不是监听端口，只计数。
    expect(parsed.establishedCountByPort.get(8080)).toBe(2);
    expect(parsed.establishedCountByPort.get(22)).toBe(1);
    // 5000 / 34567 没有 ESTABLISHED 行 —— 不产生计数项，由调用方折算成确定的 0。
    expect(parsed.establishedCountByPort.has(5000)).toBe(false);
    expect(parsed.establishedCountByPort.has(34567)).toBe(false);
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

  it('没有 ESTABLISHED 行的监听端口是确定的 0；pid 未知时 processAlive 为 null', async () => {
    const outcome = await collectProcfsListeningPorts(createFakeProcfs());
    const wildcard = findPort(outcome.ports, 8080, 'tcp');
    expect(wildcard).toMatchObject({ establishedConnections: 0, processAlive: true });
    const ipv6Loopback = findPort(outcome.ports, 8080, 'tcp6');
    expect(ipv6Loopback).toMatchObject({ establishedConnections: 0, processAlive: true });
    // 反查不到 pid：谈不上存活，未知必须是 null 而不是 false。
    expect(findPort(outcome.ports, 34567, 'tcp')?.processAlive).toBeNull();
  });

  it('连接数按协议文件隔离：tcp 与 tcp6 的同号端口各数自己文件里的 ESTABLISHED 行', async () => {
    const io = createFakeProcfsIo({
      files: {
        '/proc/net/tcp': [
          '  sl  local_address rem_address   st',
          procNetTcpLine(0, '00000000:0BB8', '0A', 11111),
          procNetTcpLine(1, '00000000:0BB8', '01', 0, '0100007F:C001'),
          procNetTcpLine(2, '00000000:0BB8', '01', 0, '0100007F:C002'),
          procNetTcpLine(3, '00000000:0BB8', '01', 0, '0100007F:C003'),
          '',
        ].join('\n'),
        '/proc/net/tcp6': [
          '  sl  local_address                         remote_address                        st',
          procNetTcpLine(0, '00000000000000000000000000000000:0BB8', '0A', 22222),
          procNetTcpLine(1, '00000000000000000000000000000000:0BB8', '01', 0, '00..C001'),
          procNetTcpLine(2, '00000000000000000000000000000000:0BB8', '01', 0, '00..C002'),
          '',
        ].join('\n'),
      },
      dirs: {},
      links: {},
    });

    const outcome = await collectProcfsListeningPorts(io);
    expect(findPort(outcome.ports, 3000, 'tcp')?.establishedConnections).toBe(3);
    expect(findPort(outcome.ports, 3000, 'tcp6')?.establishedConnections).toBe(2);
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

/** 两个监听端口同属 pid 7001（两个 fd → 两个 inode），用于存活检查的去重断言。 */
function createSharedPidProcfs(): FakeProcfs {
  return {
    files: {
      '/proc/net/tcp': [
        '  sl  local_address rem_address   st',
        procNetTcpLine(0, '00000000:0FA0', '0A', 111),
        procNetTcpLine(1, '00000000:1388', '0A', 222),
        '',
      ].join('\n'),
      '/proc/net/tcp6': '  sl  local_address rem_address   st\n',
      '/proc/7001/comm': 'node\n',
      '/proc/7001/stat': statLine(7001, 'node', 1),
    },
    dirs: {
      '/proc': ['7001', 'self', '1'],
      '/proc/7001/fd': ['3', '4'],
    },
    links: {
      '/proc/7001/fd/3': 'socket:[111]',
      '/proc/7001/fd/4': 'socket:[222]',
    },
  };
}

/** 把 `/proc/<pid>/stat` 的读取替换成固定失败，模拟权限拒绝 / 瞬时 IO 故障。 */
function withStatFailure(io: ProcfsIo, error: Error): ProcfsIo {
  return {
    readTextFile: (path) =>
      /^\/proc\/\d+\/stat$/.test(path) ? Promise.reject(error) : io.readTextFile(path),
    readDirNames: (path) => io.readDirNames(path),
    readLink: (path) => io.readLink(path),
  };
}

describe('collectProcfsListeningPorts：processAlive 语义', () => {
  it('stat 可读 → true；同一 pid 的多个端口只读一次 /proc/<pid>/stat', async () => {
    const tracked = createTrackedProcfsIo(createSharedPidProcfs());
    const outcome = await collectProcfsListeningPorts(tracked.io);

    expect(findPort(outcome.ports, 4000, 'tcp')?.processAlive).toBe(true);
    expect(findPort(outcome.ports, 5000, 'tcp')?.processAlive).toBe(true);
    expect(tracked.textReads.filter((path) => path === '/proc/7001/stat')).toHaveLength(1);
  });

  it('stat 读取 ENOENT（进程已退出）→ false', async () => {
    const fake = createSharedPidProcfs();
    delete fake.files['/proc/7001/stat'];

    const outcome = await collectProcfsListeningPorts(createFakeProcfsIo(fake));
    expect(findPort(outcome.ports, 4000, 'tcp')?.processAlive).toBe(false);
    expect(findPort(outcome.ports, 5000, 'tcp')?.processAlive).toBe(false);
  });

  it('stat 读取 EACCES / 其它错误 → null（未知），绝不误报「已退出」', async () => {
    const base = createFakeProcfsIo(createSharedPidProcfs());
    for (const error of [new Error('EACCES: permission denied'), new Error('EIO: i/o error')]) {
      const outcome = await collectProcfsListeningPorts(withStatFailure(base, error));
      expect(findPort(outcome.ports, 4000, 'tcp')?.processAlive).toBeNull();
      expect(findPort(outcome.ports, 5000, 'tcp')?.processAlive).toBeNull();
    }
  });
});

describe('collectProcfsListeningPorts：归属扫描的并发确定性与单操作超时', () => {
  it('同一 inode 被多个 pid 命中时，无论 /proc 顺序如何都取最小 pid', async () => {
    const io = createFakeProcfsIo({
      files: {
        '/proc/net/tcp': [
          '  sl  local_address rem_address   st',
          procNetTcpLine(0, '00000000:0FA0', '0A', 111),
          '',
        ].join('\n'),
        '/proc/net/tcp6': '  sl  local_address rem_address   st\n',
        '/proc/9000/comm': 'high\n',
        '/proc/9000/stat': statLine(9000, 'high', 1),
        '/proc/5000/comm': 'low\n',
        '/proc/5000/stat': statLine(5000, 'low', 1),
      },
      // 高 pid 排在 /proc 前面：若按完成顺序取归属，会错拿 9000。
      dirs: {
        '/proc': ['9000', '5000', '1'],
        '/proc/9000/fd': ['3'],
        '/proc/5000/fd': ['3'],
      },
      links: {
        '/proc/9000/fd/3': 'socket:[111]',
        '/proc/5000/fd/3': 'socket:[111]',
      },
    });

    const outcome = await collectProcfsListeningPorts(io);
    expect(findPort(outcome.ports, 4000, 'tcp')).toMatchObject({
      pid: 5000,
      processName: 'low',
    });
  });

  it('单个 fd 的 readlink 永不返回时，只丢失该 inode 的归属，其余端口照常解析', async () => {
    vi.useFakeTimers();
    try {
      const base = createFakeProcfsIo({
        files: {
          '/proc/net/tcp': [
            '  sl  local_address rem_address   st',
            procNetTcpLine(0, '00000000:0FA0', '0A', 111),
            procNetTcpLine(1, '00000000:1388', '0A', 222),
            '',
          ].join('\n'),
          '/proc/net/tcp6': '  sl  local_address rem_address   st\n',
          '/proc/7777/comm': 'node\n',
          '/proc/7777/stat': statLine(7777, 'node', 1),
        },
        dirs: { '/proc': ['7777', '1'], '/proc/7777/fd': ['3', '4'] },
        links: {
          '/proc/7777/fd/3': 'socket:[111]',
          '/proc/7777/fd/4': 'socket:[222]',
        },
      });
      const io: ProcfsIo = {
        readTextFile: (path) => base.readTextFile(path),
        readDirNames: (path) => base.readDirNames(path),
        readLink: (path) =>
          path === '/proc/7777/fd/4' ? new Promise<string>(() => undefined) : base.readLink(path),
      };

      const pending = collectProcfsListeningPorts(io);
      await vi.advanceTimersByTimeAsync(1_000);
      const outcome = await pending;

      expect(findPort(outcome.ports, 4000, 'tcp')).toMatchObject({ pid: 7777 });
      // fd 4 的 readlink 卡住 → inode 222 归属缺失，但枚举整体仍完成。
      expect(findPort(outcome.ports, 5000, 'tcp')).toMatchObject({ pid: null, processName: null });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('parseLsofOutput / parsePowerShellOutput', () => {
  it('lsof 行解析出 pid / 进程名 / 绑定地址；连接数与存活状态一律 null（平台不提供）', () => {
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
    for (const entry of ports) {
      expect(entry).toMatchObject({ establishedConnections: null, processAlive: null });
    }
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
        establishedConnections: null,
        processAlive: null,
        terminal: null,
      },
    ]);
    expect(parsePowerShellOutput('not json')).toEqual([]);
    expect(parsePowerShellOutput('')).toEqual([]);
  });
});

/** 构造一行 `/proc/<pid>/stat`；`comm` 可含空格 / 括号，解析必须扛得住。 */
function statLine(pid: number, comm: string, ppid: number): string {
  return `${pid} (${comm}) S ${ppid} ${pid} 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 12345 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0`;
}

/** 只提供 `/proc/<pid>/stat` 的假 IO；其余读取一律失败（模拟权限 / 进程已退出）。 */
function createWalkProcfsIo(stats: Record<number, string>): ProcfsIo {
  return {
    async readTextFile(path) {
      const match = /^\/proc\/(\d+)\/stat$/.exec(path);
      const content = match?.[1] !== undefined ? stats[Number.parseInt(match[1], 10)] : undefined;
      if (content === undefined) {
        throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      }
      return content;
    },
    async readDirNames() {
      throw new Error('EACCES: permission denied');
    },
    async readLink() {
      throw new Error('ENOENT: no such file or directory');
    },
  };
}

function ownedMap(
  entries: ReadonlyArray<{ pid: number; sessionId: string; terminalId: string }>,
): Map<number, TerminalAttribution> {
  return new Map(
    entries.map((entry) => [
      entry.pid,
      { sessionId: entry.sessionId, terminalId: entry.terminalId },
    ]),
  );
}

/** 生成一条 `entry → entry+100 → …` 的父链；`depthToOwner` 是监听进程到终端 pid 的层数。 */
function parentChainStats(entryPid: number, depthToOwner: number): Record<number, string> {
  const step = 100;
  const stats: Record<number, string> = {};
  for (let hop = 0; hop < depthToOwner; hop += 1) {
    const pid = entryPid + hop * step;
    stats[pid] = statLine(pid, 'node', pid + step);
  }
  const ownerPid = entryPid + depthToOwner * step;
  stats[ownerPid] = statLine(ownerPid, 'bash', 1);
  return stats;
}

/** 归属集成测试用假 /proc：4000/tcp 由 pid 9001 监听（父链 9001 → 8500 → 8000 终端 shell），5000/tcp 的 inode 反查不到进程。 */
function createAttributionProcfs(): FakeProcfs {
  return {
    files: {
      '/proc/net/tcp': [
        '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode',
        '   0: 00000000:0FA0 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 77777 1 0000000000000000 100 0 0 10 0',
        '   1: 00000000:1388 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 55555 1 0000000000000000 100 0 0 10 0',
        '',
      ].join('\n'),
      '/proc/net/tcp6': '  sl  local_address rem_address   st\n',
      '/proc/9001/comm': 'node\n',
      '/proc/9001/stat': statLine(9001, 'node', 8500),
      '/proc/8500/stat': statLine(8500, 'npm exec', 8000),
      '/proc/8000/stat': statLine(8000, 'bash', 1),
    },
    dirs: {
      '/proc': ['9001', 'self', '1'],
      '/proc/9001/fd': ['7'],
    },
    links: {
      '/proc/9001/fd/7': 'socket:[77777]',
    },
  };
}

/** 记录每次 readTextFile 的假 IO，用来断言「缓存命中不重复读 /proc」。 */
function createTrackedProcfsIo(fake: FakeProcfs): { io: ProcfsIo; textReads: string[] } {
  const textReads: string[] = [];
  const io = createFakeProcfsIo(fake);
  return {
    textReads,
    io: {
      async readTextFile(path) {
        textReads.push(path);
        return io.readTextFile(path);
      },
      readDirNames: (path) => io.readDirNames(path),
      readLink: (path) => io.readLink(path),
    },
  };
}

describe('parseProcStatPpid', () => {
  it('以最后一个右括号为界解析第 4 字段；comm 含空格 / 括号也不误读', () => {
    expect(parseProcStatPpid(statLine(9001, 'node', 8000))).toBe(8000);
    expect(parseProcStatPpid(statLine(9002, 'my (weird) name', 8001))).toBe(8001);
  });

  it('无右括号 / 字段缺失 / ppid 非数字 → null，不抛错', () => {
    expect(parseProcStatPpid('garbage')).toBeNull();
    expect(parseProcStatPpid('1 (init) S')).toBeNull();
    expect(parseProcStatPpid('1 (init) S abc 1')).toBeNull();
  });
});

describe('resolveOwnedTerminalForPid：监听进程 → 所属终端（父链回溯）', () => {
  const owned = ownedMap([{ pid: 8000, sessionId: 's-1', terminalId: 't-1' }]);
  const expected = { sessionId: 's-1', terminalId: 't-1' };

  it('监听 pid 本身就是终端 pid → 0 层直接命中', async () => {
    const io = createWalkProcfsIo({ 8000: statLine(8000, 'bash', 1) });
    await expect(resolveOwnedTerminalForPid({ io, pid: 8000, ownedByPid: owned })).resolves.toEqual(
      expected,
    );
  });

  it('监听进程是终端 shell 的子进程（npm run dev）→ 沿 PPid 向上命中', async () => {
    const io = createWalkProcfsIo({
      9001: statLine(9001, 'node', 8500),
      8500: statLine(8500, 'npm exec', 8000),
    });
    await expect(resolveOwnedTerminalForPid({ io, pid: 9001, ownedByPid: owned })).resolves.toEqual(
      expected,
    );
  });

  it('pid 未知（stat 不可读）→ null，而不是抛错', async () => {
    const io = createWalkProcfsIo({});
    await expect(
      resolveOwnedTerminalForPid({ io, pid: 9999, ownedByPid: owned }),
    ).resolves.toBeNull();
  });

  it('pid 为 null / 0 / 负数 → null（边界值不进入 /proc 读取）', async () => {
    const io = createWalkProcfsIo({ 1: statLine(1, 'init', 0) });
    await expect(
      resolveOwnedTerminalForPid({ io, pid: null, ownedByPid: owned }),
    ).resolves.toBeNull();
    await expect(resolveOwnedTerminalForPid({ io, pid: 0, ownedByPid: owned })).resolves.toBeNull();
    await expect(
      resolveOwnedTerminalForPid({ io, pid: -3, ownedByPid: owned }),
    ).resolves.toBeNull();
  });

  it('深度上限（默认 8）：8 层命中，9 层返回 null（不猜更远的祖先）', async () => {
    const near = 70_000;
    const nearOwned = ownedMap([{ pid: near + 800, sessionId: 's-near', terminalId: 't-near' }]);
    await expect(
      resolveOwnedTerminalForPid({
        io: createWalkProcfsIo(parentChainStats(near, 8)),
        pid: near,
        ownedByPid: nearOwned,
      }),
    ).resolves.toEqual({ sessionId: 's-near', terminalId: 't-near' });

    const far = 90_000;
    const farOwned = ownedMap([{ pid: far + 900, sessionId: 's-far', terminalId: 't-far' }]);
    await expect(
      resolveOwnedTerminalForPid({
        io: createWalkProcfsIo(parentChainStats(far, 9)),
        pid: far,
        ownedByPid: farOwned,
      }),
    ).resolves.toBeNull();
  });

  it('显式 maxDepth 生效：链上第 3 层是终端，maxDepth=2 归不到、=3 能归到', async () => {
    const entry = 50_000;
    const chainOwned = ownedMap([{ pid: entry + 300, sessionId: 's-3', terminalId: 't-3' }]);
    const io = createWalkProcfsIo(parentChainStats(entry, 3));
    await expect(
      resolveOwnedTerminalForPid({ io, pid: entry, ownedByPid: chainOwned, maxDepth: 2 }),
    ).resolves.toBeNull();
    await expect(
      resolveOwnedTerminalForPid({ io, pid: entry, ownedByPid: chainOwned, maxDepth: 3 }),
    ).resolves.toEqual({ sessionId: 's-3', terminalId: 't-3' });
  });

  it('stat 数据畸形（无右括号 / ppid 非数字）→ null', async () => {
    const io = createWalkProcfsIo({
      9001: 'garbage without closing paren',
      9002: '9002 (node) S not-a-number 9002',
    });
    await expect(
      resolveOwnedTerminalForPid({ io, pid: 9001, ownedByPid: owned }),
    ).resolves.toBeNull();
    await expect(
      resolveOwnedTerminalForPid({ io, pid: 9002, ownedByPid: owned }),
    ).resolves.toBeNull();
  });

  it('父链成环（异常数据）→ null，不无限回溯', async () => {
    const io = createWalkProcfsIo({
      9100: statLine(9100, 'a', 9200),
      9200: statLine(9200, 'b', 9100),
    });
    await expect(
      resolveOwnedTerminalForPid({ io, pid: 9100, ownedByPid: owned }),
    ).resolves.toBeNull();
  });

  it('可归属终端列表为空 → null（跨用户场景的最终形态：别人的终端不在名单里）', async () => {
    const io = createWalkProcfsIo({ 9001: statLine(9001, 'node', 8000) });
    await expect(
      resolveOwnedTerminalForPid({ io, pid: 9001, ownedByPid: new Map() }),
    ).resolves.toBeNull();
  });
});

describe('listListeningPorts：归属接线与用户隔离', () => {
  const LOOKUP_A = (
    userId: string,
  ): ReadonlyArray<{
    pid: number;
    sessionId: string;
    terminalId: string;
  }> => (userId === 'user-a' ? [{ pid: 8000, sessionId: 's-a', terminalId: 't-a' }] : []);

  it('procfs：命中的端口写入 terminal，未归属的保持 null', async () => {
    const snapshot = await listListeningPorts({
      strategy: 'procfs',
      procfsIo: createFakeProcfsIo(createAttributionProcfs()),
      userId: 'user-a',
      listOwnedTerminalPids: LOOKUP_A,
    });

    expect(snapshot.attributionSupported).toBe(true);
    expect(findPort(snapshot.ports, 4000, 'tcp')?.terminal).toEqual({
      sessionId: 's-a',
      terminalId: 't-a',
    });
    // inode 55555 反查不到 pid（权限 / 进程已退出）→ 无从归属，保持 null。
    expect(findPort(snapshot.ports, 5000, 'tcp')).toMatchObject({ pid: null, terminal: null });
  });

  it('未传 userId / 查询注入 → 即使 pid 可读也一律 null（不猜归属），attributionSupported 为 false', async () => {
    const snapshot = await listListeningPorts({
      strategy: 'procfs',
      procfsIo: createFakeProcfsIo(createAttributionProcfs()),
    });

    expect(snapshot.attributionSupported).toBe(false);
    expect(findPort(snapshot.ports, 4000, 'tcp')).toMatchObject({ pid: 9001, terminal: null });
  });

  it('别的用户的终端不会归属给当前用户（查询按用户过滤）', async () => {
    const snapshot = await listListeningPorts({
      strategy: 'procfs',
      procfsIo: createFakeProcfsIo(createAttributionProcfs()),
      userId: 'user-b',
      listOwnedTerminalPids: LOOKUP_A,
    });

    // 监听者 9001 的祖先是 user-a 的终端（8000）；user-b 拿不到任何归属。
    expect(findPort(snapshot.ports, 4000, 'tcp')?.terminal).toBeNull();
  });

  it('查询注入抛错 → 端口列表照常返回（全部 null），不降级为错误', async () => {
    const snapshot = await listListeningPorts({
      strategy: 'procfs',
      procfsIo: createFakeProcfsIo(createAttributionProcfs()),
      userId: 'user-a',
      listOwnedTerminalPids: () => {
        throw new Error('registry unavailable');
      },
    });

    expect(snapshot.reason).toBeUndefined();
    expect(findPort(snapshot.ports, 4000, 'tcp')).toMatchObject({ pid: 9001, terminal: null });
  });

  it('非 procfs 策略（lsof）本轮不做归属 → terminal: null 且 attributionSupported 为 false', async () => {
    const snapshot = await listListeningPorts({
      strategy: 'lsof',
      exec: async () => ({ stdout: LSOF_OUTPUT, stderr: '' }),
      userId: 'user-a',
      listOwnedTerminalPids: LOOKUP_A,
    });

    expect(snapshot.attributionSupported).toBe(false);
    expect(findPort(snapshot.ports, 34567, 'tcp')).toMatchObject({ pid: 33333, terminal: null });
  });

  it('快照缓存按用户隔离：TTL 内 A 的归属不会服务给 B（B 触发新枚举）', async () => {
    vi.stubEnv('OPENAWORK_PORTS_ENUMERATION_TTL_MS', '3000');
    const tracked = createTrackedProcfsIo(createAttributionProcfs());
    const now = () => 1_000;
    const enumerationReads = (): number =>
      tracked.textReads.filter((path) => path === '/proc/net/tcp').length;

    const first = await listListeningPorts({
      strategy: 'procfs',
      procfsIo: tracked.io,
      userId: 'user-a',
      listOwnedTerminalPids: LOOKUP_A,
      now,
    });
    expect(findPort(first.ports, 4000, 'tcp')?.terminal).toEqual({
      sessionId: 's-a',
      terminalId: 't-a',
    });
    expect(enumerationReads()).toBe(1);

    const second = await listListeningPorts({
      strategy: 'procfs',
      procfsIo: tracked.io,
      userId: 'user-b',
      listOwnedTerminalPids: LOOKUP_A,
      now,
    });
    expect(enumerationReads()).toBe(2);
    expect(findPort(second.ports, 4000, 'tcp')?.terminal).toBeNull();
  });

  it('同一用户的 TTL 内直接复用快照（不重复读 /proc）', async () => {
    vi.stubEnv('OPENAWORK_PORTS_ENUMERATION_TTL_MS', '3000');
    const tracked = createTrackedProcfsIo(createAttributionProcfs());
    const now = () => 1_000;

    const first = await listListeningPorts({
      strategy: 'procfs',
      procfsIo: tracked.io,
      userId: 'user-a',
      listOwnedTerminalPids: LOOKUP_A,
      now,
    });
    const second = await listListeningPorts({
      strategy: 'procfs',
      procfsIo: tracked.io,
      userId: 'user-a',
      listOwnedTerminalPids: LOOKUP_A,
      now,
    });

    expect(tracked.textReads.filter((path) => path === '/proc/net/tcp')).toHaveLength(1);
    expect(second).toBe(first);
  });

  it('不同用户的并发调用不会共享单飞（各自枚举、各自归属）', async () => {
    const tracked = createTrackedProcfsIo(createAttributionProcfs());
    const [a, b] = await Promise.all([
      listListeningPorts({
        strategy: 'procfs',
        procfsIo: tracked.io,
        userId: 'user-a',
        listOwnedTerminalPids: LOOKUP_A,
      }),
      listListeningPorts({
        strategy: 'procfs',
        procfsIo: tracked.io,
        userId: 'user-b',
        listOwnedTerminalPids: LOOKUP_A,
      }),
    ]);

    expect(findPort(a.ports, 4000, 'tcp')?.terminal).toEqual({
      sessionId: 's-a',
      terminalId: 't-a',
    });
    expect(findPort(b.ports, 4000, 'tcp')?.terminal).toBeNull();
    expect(tracked.textReads.filter((path) => path === '/proc/net/tcp')).toHaveLength(2);
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

  it('OPENAWORK_PORTS_ENUMERATION_TIMEOUT_MS 覆盖总超时预算', async () => {
    vi.stubEnv('OPENAWORK_PORTS_ENUMERATION_TIMEOUT_MS', '5');
    const hanging: ProcfsIo = {
      readTextFile: () => new Promise<string>(() => undefined),
      readDirNames: () => new Promise<string[]>(() => undefined),
      readLink: () => new Promise<string>(() => undefined),
    };

    const snapshot = await listListeningPorts({ strategy: 'procfs', procfsIo: hanging });

    expect(snapshot.ports).toEqual([]);
    expect(snapshot.reason).toContain('超时');
    expect(snapshot.reason).toContain('5ms');
  });

  const hangingExec = (): Promise<{ stdout: string; stderr: string }> =>
    new Promise<{ stdout: string; stderr: string }>(() => undefined);

  it('默认预算按策略区分：procfs 3s，lsof / powershell 10s（Windows 冷启动不被 3s 顶穿）', async () => {
    expect(defaultEnumerationTimeoutMs('procfs')).toBe(3_000);
    expect(defaultEnumerationTimeoutMs('lsof')).toBe(10_000);
    expect(defaultEnumerationTimeoutMs('powershell')).toBe(10_000);

    vi.useFakeTimers();
    try {
      const pending = listListeningPorts({ strategy: 'powershell', exec: hangingExec });

      // 3s 是 procfs 的预算，不能拿来卡子进程策略：此处不应提前降级。
      await vi.advanceTimersByTimeAsync(3_000);
      // 推进到 10s 才到子进程策略的预算上限，此时才允许降级为空列表。
      await vi.advanceTimersByTimeAsync(7_000);
      const snapshot = await pending;

      expect(snapshot.ports).toEqual([]);
      expect(snapshot.reason).toContain('10000ms');
    } finally {
      vi.useRealTimers();
    }
  });

  it('OPENAWORK_PORTS_ENUMERATION_TIMEOUT_MS 对子进程策略同样是绝对值覆盖', async () => {
    vi.useFakeTimers();
    try {
      vi.stubEnv('OPENAWORK_PORTS_ENUMERATION_TIMEOUT_MS', '5');
      const pending = listListeningPorts({ strategy: 'lsof', exec: hangingExec });

      await vi.advanceTimersByTimeAsync(5);
      expect((await pending).reason).toContain('5ms');
    } finally {
      vi.useRealTimers();
    }
  });

  it('子进程策略把超时预算透传给 exec（到点可杀，不留孤儿进程）', async () => {
    const powershellExec = vi.fn(async () => ({ stdout: '', stderr: '' }));
    await listListeningPorts({ strategy: 'powershell', exec: powershellExec, timeoutMs: 1234 });
    expect(powershellExec).toHaveBeenCalledWith('powershell', expect.any(Array), {
      timeoutMs: 1234,
    });

    const lsofExec = vi.fn(async () => ({ stdout: LSOF_OUTPUT, stderr: '' }));
    await listListeningPorts({ strategy: 'lsof', exec: lsofExec, timeoutMs: 4321 });
    expect(lsofExec).toHaveBeenCalledWith('lsof', expect.any(Array), { timeoutMs: 4321 });
  });

  it('procfs 归属反查卡死时只丢 pid / 归属，仍返回已读到的 LISTEN 列表（不整份降级）', async () => {
    const hangingOwnerScanIo: ProcfsIo = {
      readTextFile: async (path) => {
        if (path === '/proc/net/tcp') {
          return [
            '  sl  local_address rem_address   st',
            procNetTcpLine(0, '00000000:0FA0', '0A', 111),
            '',
          ].join('\n');
        }
        if (path === '/proc/net/tcp6') return '  sl  local_address rem_address   st\n';
        throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      },
      readDirNames: async (path) => {
        if (path === '/proc') return ['4321'];
        // /proc/<pid>/fd 永久挂起：模拟 D-state / 卡住的挂载点。
        return new Promise<string[]>(() => undefined);
      },
      readLink: () => new Promise<string>(() => undefined),
    };

    const snapshot = await listListeningPorts({
      strategy: 'procfs',
      procfsIo: hangingOwnerScanIo,
      timeoutMs: 700,
    });

    // 富化停手点（早于外层超时）已到：端口列表照常返回，仅 pid / 进程名缺失。
    expect(snapshot.ports).toHaveLength(1);
    expect(findPort(snapshot.ports, 4000, 'tcp')).toMatchObject({ pid: null, processName: null });
    expect(snapshot.reason).toBeUndefined();
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

  it('默认缓存 TTL 严格大于 5s 轮询间隔：下一拍命中缓存而不是再起一次进程', async () => {
    vi.useFakeTimers();
    try {
      const exec = vi.fn(async () => ({ stdout: LSOF_OUTPUT, stderr: '' }));

      await listListeningPorts({ strategy: 'lsof', exec });
      expect(exec).toHaveBeenCalledTimes(1);

      // 快照按「枚举完成时刻」入缓存，下一拍请求到达时年龄已是 5s + ε；
      // TTL 若等于 5000 会因命中判定是严格 `<` 而每次都 miss —— 这里锁死必须真正复用。
      await vi.advanceTimersByTimeAsync(5_000);
      await listListeningPorts({ strategy: 'lsof', exec });
      expect(exec).toHaveBeenCalledTimes(1);

      // 超过 TTL 之后才允许重新枚举。
      await vi.advanceTimersByTimeAsync(3_000);
      await listListeningPorts({ strategy: 'lsof', exec });
      expect(exec).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
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
    expect(snapshot.attributionSupported).toBe(false);
    expect(snapshot.ports.map((entry) => entry.port)).toEqual([8080, 34567]);
    expect(findPort(snapshot.ports, 34567, 'tcp')).toMatchObject({
      pid: 4321,
      establishedConnections: null,
      processAlive: null,
    });
    expect(findPort(snapshot.ports, 8080, 'tcp6')).toMatchObject({ bindAddress: '::' });
  });
});
