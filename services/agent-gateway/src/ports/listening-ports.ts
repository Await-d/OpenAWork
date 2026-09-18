/**
 * Listening-port enumeration — a read-only inventory of the TCP listeners
 * visible inside the gateway's own network namespace.
 *
 * Docker note: `docker-compose.yml` runs the gateway on a bridge network, so
 * the gateway has its own netns and `/proc/net/tcp` describes the gateway
 * container, NOT the host. That is the intended population: the ports that
 * matter for the terminal panel are the ones an agent starts inside the same
 * netns (e.g. `npm run dev` spawned through the bash tool). Host ports are out
 * of scope by design — the desktop on the same machine can open
 * `localhost:PORT` directly without any proxy.
 *
 * Three isolated platform strategies, each a small function:
 *   - linux  → procfs: `/proc/net/tcp{,6}` (state `0A` = LISTEN) plus a
 *     best-effort reverse lookup of `/proc/<pid>/fd/*` → `socket:[inode]` for
 *     owner pid/name. Unreadable fds (other users) yield `pid: null`, never an
 *     error.
 *   - darwin → `lsof -nP -iTCP -sTCP:LISTEN`
 *   - win32  → `powershell -NoProfile -Command` with `Get-NetTCPConnection`
 *     → `Get-Process -Id` for process names
 *
 * Nothing here may throw or hang: every exec failure, parse error or timeout
 * degrades to `{ ports: [], strategy, reason }`. A `Promise.race` timeout
 * guards the subprocess strategies (PowerShell cold start is 1–2s, `lsof` can
 * stall). Results are cached with a short TTL (env-overridable) and
 * single-flighted so concurrent callers share one probe instead of spawning a
 * process each.
 *
 * This module is enumeration only. It never opens sockets, forwards traffic or
 * exposes anything — that is a separate, security-reviewed deliverable.
 *
 * 端口状态（additive）：procfs 下每个条目附带 `establishedConnections`（解析
 * `/proc/net/tcp{,6}` 时对同一份文件顺带统计的 ESTABLISHED 行数）与 `processAlive`
 * （读 `/proc/<pid>/stat`，**只有 ENOENT 才算已退出**）。lsof / powershell 的枚举
 * 命令拿不到这两类信息，一律 `null`（未知）——快照级的 `attributionSupported`
 * 同理标出归属能力。消费方不得把「未知」渲染成 0 / false / 「外部进程」。
 *
 * 归属（additive）：procfs 策略下，每个监听 pid 会沿父链回溯，命中「本网关
 * 为**当前请求用户**拉起的终端」时写入 `terminal`；其余一律 `terminal: null`。
 * 归属只读、不猜：命中不了就是 null，本模块永远不提供按 pid 终止的能力 ——
 * 终止只能走既有的 `/sessions/:sessionId/terminals/:terminalId/kill`（带用户校验）。
 */

import { execFile } from 'node:child_process';
import { readFile, readdir, readlink } from 'node:fs/promises';

/** 端口的终端归属：仅当监听进程确实是某个「属于当前用户的本网关终端」的进程树节点时才有值。 */
export interface TerminalAttribution {
  sessionId: string;
  terminalId: string;
}

/**
 * 注入查询的返回项：该用户的「活着且有 pid」的终端。
 * 与 `session-terminal-registry.listOwnedTerminalPids` 结构同形 —— 路由层接线时
 * 由 TypeScript 校验两边字段一致（`src/ports/` 刻意不直接 import 会话层）。
 */
export interface OwnedTerminalPid {
  pid: number;
  sessionId: string;
  terminalId: string;
}

export interface ListeningPort {
  port: number;
  protocol: 'tcp' | 'tcp6';
  bindAddress: string;
  pid: number | null;
  processName: string | null;
  source: 'procfs' | 'lsof' | 'powershell';
  /**
   * 该监听端口的 ESTABLISHED 连接数。
   * `null` = 当前策略无法统计（lsof / powershell 的输出里没有连接状态），
   * **不是 0** —— 消费方不得把 null 显示成「无连接」。
   * 非 null 时也只是本次快照（≤5s 缓存）的时点值，不是实时值。
   */
  establishedConnections: number | null;
  /**
   * 监听进程是否仍存在。
   * `null` = 无法判断（pid 未知 / 权限不足 / 瞬时 IO 失败），**不是 false**：
   * 只有 procfs 明确读到 ENOENT 才是 false。把活着的进程误报为「已退出」比
   * 什么都不显示更糟，所以除 ENOENT 外一律保持未知。
   */
  processAlive: boolean | null;
  /**
   * 该监听进程归属的终端；`null` = 无法归属（不是错误）。
   * 归属失败的原因很多：pid 未知、进程不是终端后代、非 procfs 策略、pid 复用……
   * 消费方**不得**把 null 当作「可以用 pid 直接杀」的许可；能否把 null 解读成
   * 「外部进程」取决于快照的 `attributionSupported`。
   */
  terminal: TerminalAttribution | null;
}

export interface ListeningPortsSnapshot {
  ports: ListeningPort[];
  /** 本次枚举实际使用的策略；不可用时为 null 并提供 reason */
  strategy: ListeningPort['source'] | null;
  /**
   * 本次快照是否真的做过终端归属判定 —— 也是「`terminal: null` 能不能解读为
   * 外部进程」的唯一权威判据（只有 linux/procfs 且带用户上下文时为 true）。
   * 消费方必须用它、而不是自己从 strategy 名称推断：非 procfs 平台上的 null
   * 只代表「归属不可用」，绝不代表那些端口属于外部进程。
   */
  attributionSupported: boolean;
  /** 降级原因（供日志与 UI 说明） */
  reason?: string;
  collectedAtMs: number;
}

export type PortEnumerationExec = (
  cmd: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string }>;

export interface ListListeningPortsOptions {
  /** 覆盖策略，供单测注入；默认按 platform 探测 */
  strategy?: ListeningPort['source'] | 'auto';
  /** 默认 3000ms；超时必须返回降级结果而非抛错或挂起 */
  timeoutMs?: number;
  /** 覆盖执行器，供单测注入（禁止在单测里真的起进程） */
  exec?: PortEnumerationExec;
  now?: () => number;
  /**
   * 请求用户 id。缺省时不计算归属（所有端口 `terminal: null`）。
   * 快照缓存以它为键：**不同用户的快照绝不互相复用**（见 `listListeningPorts`）。
   */
  userId?: string;
  /**
   * pid → 该用户终端 的查询注入点，由路由层接 session registry。
   * `src/ports/` 刻意不 import 会话层：那会把只读枚举器耦合进会话状态，
   * 也让归属逻辑无法在单测里纯函数化。
   */
  listOwnedTerminalPids?: (userId: string) => ReadonlyArray<OwnedTerminalPid>;
  /** 覆盖 procfs IO，供单测注入假 /proc；缺省读真实文件系统。 */
  procfsIo?: ProcfsIo;
}

const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_CACHE_TTL_MS = 3_000;
const CACHE_TTL_ENV_KEY = 'OPENAWORK_PORTS_ENUMERATION_TTL_MS';
const DEFAULT_GATEWAY_PORT = 3000;
const DEFAULT_REDIS_PORT = 6379;
const PROC_NET_TCP = '/proc/net/tcp';
const PROC_NET_TCP6 = '/proc/net/tcp6';

/**
 * 归属回溯的深度上限（从监听进程起最多向上检查 8 层祖先）。
 *
 * `npm run dev` / `pnpm exec vite` 这类监听者不是终端 shell 本身，而是它的
 * 1–2 层后代（shell → 包管理器 → runner → 实际 server）；再加上 `sh -c`
 * 包装，4–5 层也绰绰有余。取 8 是「覆盖常见链」与「每个端口最多 8 次
 * /proc/<pid>/stat 读取」之间的折中；超过上限一律返回 null —— 宁可没有归属，
 * 也不能把某个碰巧存在的远端祖先猜成终端。
 */
export const MAX_TERMINAL_ATTRIBUTION_DEPTH = 8;

/** Pure capability probe. Injectable for tests; never throws. */
export function detectPortEnumerationStrategy(
  platform: NodeJS.Platform = globalThis.process?.platform ?? 'linux',
): { strategy: ListeningPort['source'] | null; reason?: string } {
  switch (platform) {
    case 'linux':
      return { strategy: 'procfs' };
    case 'darwin':
      return { strategy: 'lsof' };
    case 'win32':
      return { strategy: 'powershell' };
    default:
      return {
        strategy: null,
        reason: `当前平台 ${platform} 暂无端口枚举策略（仅支持 linux / darwin / win32）。`,
      };
  }
}

/* ------------------------------------------------------------------------- *
 * procfs strategy
 * ------------------------------------------------------------------------- */

export interface ProcfsIo {
  readTextFile(path: string): Promise<string>;
  readDirNames(path: string): Promise<string[]>;
  readLink(path: string): Promise<string>;
}

interface StrategyOutcome {
  ports: ListeningPort[];
  reason?: string;
}

export interface ProcNetTcpEntry {
  inode: number;
  port: number;
  bindAddress: string;
  protocol: ListeningPort['protocol'];
}

const defaultProcfsIo: ProcfsIo = {
  async readTextFile(path) {
    return readFile(path, 'utf-8');
  },
  async readDirNames(path) {
    return readdir(path);
  },
  async readLink(path) {
    return readlink(path);
  },
};

export interface ProcNetTcpParseResult {
  /** LISTEN(0A) 行；与旧版逐行解析的输出完全一致（畸形行照样跳过）。 */
  entries: ProcNetTcpEntry[];
  /** 本地端口 → 该协议文件里的 ESTABLISHED(01) 行数；一次解析顺带得出，不需要二次读文件。 */
  establishedCountByPort: Map<number, number>;
}

/**
 * Parse a `/proc/net/tcp{,6}` dump in a **single pass**: LISTEN rows become entries,
 * ESTABLISHED rows are tallied per local port. Malformed lines are skipped rather
 * than thrown so a kernel quirk can't break the page.
 *
 * 计数键是「本地端口」而不是对端：ESTABLISHED 行的本地地址就是监听地址那一端，
 * 对端才是客户端 —— 这正是「有多少条连接落在这个监听端口上」的答案。调用方必须
 * 按协议把结果贴回对应条目：tcp6 监听者的连接只出现在 `/proc/net/tcp6`。
 */
export function parseProcNetTcpContent(
  content: string,
  protocol: ListeningPort['protocol'],
): ProcNetTcpParseResult {
  const entries: ProcNetTcpEntry[] = [];
  const establishedCountByPort = new Map<number, number>();
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const fields = line.split(/\s+/);
    if (fields.length < 10) continue;
    if (fields[0] === 'sl') continue; // header row
    const state = (fields[3] ?? '').toUpperCase();
    const local = fields[1];
    if (local === undefined) continue;
    const separator = local.lastIndexOf(':');
    if (separator <= 0) continue;
    const port = Number.parseInt(local.slice(separator + 1), 16);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) continue;
    if (state === '01') {
      establishedCountByPort.set(port, (establishedCountByPort.get(port) ?? 0) + 1);
      continue;
    }
    if (state !== '0A') continue; // LISTEN only
    const hexAddress = local.slice(0, separator);
    const bindAddress =
      protocol === 'tcp' ? formatProcIpv4(hexAddress) : formatProcIpv6(hexAddress);
    if (bindAddress === null) continue;
    const inode = Number.parseInt(fields[9] ?? '', 10);
    entries.push({
      inode: Number.isInteger(inode) && inode > 0 ? inode : 0,
      port,
      bindAddress,
      protocol,
    });
  }
  return { entries, establishedCountByPort };
}

/** `/proc/net/tcp` stores IPv4 octets in host (little-endian) order. */
function formatProcIpv4(hex: string): string | null {
  if (!/^[0-9A-Fa-f]{8}$/.test(hex)) return null;
  const bytes = hex.match(/.{2}/g);
  if (bytes === null || bytes.length !== 4) return null;
  const octets = bytes.reverse().map((byte) => Number.parseInt(byte, 16));
  if (octets.some((octet) => !Number.isInteger(octet))) return null;
  return octets.join('.');
}

/** `/proc/net/tcp6` stores 4 little-endian 32-bit words. */
function formatProcIpv6(hex: string): string | null {
  if (!/^[0-9A-Fa-f]{32}$/.test(hex)) return null;
  const groups: number[] = [];
  for (let word = 0; word < 4; word += 1) {
    const chunk = hex.slice(word * 8, word * 8 + 8);
    const bytes = chunk.match(/.{2}/g);
    if (bytes === null || bytes.length !== 4) return null;
    const bigEndian = bytes.reverse().join('');
    groups.push(
      Number.parseInt(bigEndian.slice(0, 4), 16),
      Number.parseInt(bigEndian.slice(4), 16),
    );
  }
  if (groups.some((group) => !Number.isInteger(group))) return null;
  return formatIpv6Groups(groups);
}

/**
 * `::ffff:a.b.c.d` is rendered in its IPv4-mapped form because that is what
 * dual-stack sockets usually surface; everything else is compressed at the
 * longest zero run, matching `inet_ntop` output.
 */
function formatIpv6Groups(groups: number[]): string {
  const isMapped =
    groups.length === 8 && groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  if (isMapped) {
    const high = groups[6] ?? 0;
    const low = groups[7] ?? 0;
    return `::ffff:${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
  }
  const hex = groups.map((group) => group.toString(16));
  let bestStart = -1;
  let bestLength = 0;
  let runStart = -1;
  let runLength = 0;
  for (let index = 0; index < hex.length; index += 1) {
    if (hex[index] === '0') {
      if (runStart < 0) runStart = index;
      runLength += 1;
      if (runLength > bestLength) {
        bestLength = runLength;
        bestStart = runStart;
      }
    } else {
      runStart = -1;
      runLength = 0;
    }
  }
  if (bestLength < 2) return hex.join(':');
  return `${hex.slice(0, bestStart).join(':')}::${hex.slice(bestStart + bestLength).join(':')}`;
}

interface ProcNetReadResult {
  entries: ProcNetTcpEntry[];
  establishedCountByPort: Map<number, number>;
  error?: string;
}

async function readProcNetTcpFile(
  io: ProcfsIo,
  path: string,
  protocol: ListeningPort['protocol'],
): Promise<ProcNetReadResult> {
  try {
    const content = await io.readTextFile(path);
    const parsed = parseProcNetTcpContent(content, protocol);
    return { entries: parsed.entries, establishedCountByPort: parsed.establishedCountByPort };
  } catch (error) {
    return { entries: [], establishedCountByPort: new Map(), error: describeError(error) };
  }
}

interface SocketOwner {
  pid: number;
  processName: string | null;
}

function parseSocketInode(linkTarget: string): number | null {
  const match = /^socket:\[(\d+)\]$/.exec(linkTarget);
  if (match?.[1] === undefined) return null;
  const inode = Number.parseInt(match[1], 10);
  return Number.isInteger(inode) && inode > 0 ? inode : null;
}

/**
 * Best-effort inode → pid reverse lookup by walking `/proc/<pid>/fd/*`. A pid
 * we cannot read (EACCES for other users, already exited) is skipped, so the
 * caller keeps `pid: null` instead of failing the whole enumeration.
 */
async function resolveSocketOwners(
  io: ProcfsIo,
  wantedInodes: Set<number>,
): Promise<Map<number, SocketOwner>> {
  const owners = new Map<number, SocketOwner>();
  if (wantedInodes.size === 0) return owners;
  let pidNames: string[];
  try {
    pidNames = await io.readDirNames('/proc');
  } catch {
    return owners;
  }
  for (const pidName of pidNames) {
    if (!/^\d+$/.test(pidName)) continue;
    const pid = Number.parseInt(pidName, 10);
    let fdNames: string[];
    try {
      fdNames = await io.readDirNames(`/proc/${pidName}/fd`);
    } catch {
      continue;
    }
    for (const fdName of fdNames) {
      let target: string;
      try {
        target = await io.readLink(`/proc/${pidName}/fd/${fdName}`);
      } catch {
        continue;
      }
      const inode = parseSocketInode(target);
      if (inode === null || !wantedInodes.has(inode) || owners.has(inode)) continue;
      owners.set(inode, { pid, processName: await readProcessName(io, pidName) });
    }
    if (owners.size >= wantedInodes.size) break;
  }
  return owners;
}

async function readProcessName(io: ProcfsIo, pidName: string): Promise<string | null> {
  try {
    const raw = await io.readTextFile(`/proc/${pidName}/comm`);
    const name = raw.trim();
    return name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

/**
 * 只有 ENOENT 代表进程已退出：EACCES（别的用户的进程）与瞬时 IO 失败都是
 * 「不知道」，必须保持 null。把活着的进程误报为「已退出」会把用户引向一个
 * 不存在的问题，比什么都不显示更糟。
 */
function isEnoentError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if ('code' in error && typeof error.code === 'string') return error.code === 'ENOENT';
  // 注入的假 IO（单测）只带消息：ENOENT 在这套 seam 里是约定前缀。
  return error.message.includes('ENOENT');
}

async function readProcessAlive(io: ProcfsIo, pid: number): Promise<boolean | null> {
  try {
    await io.readTextFile(`/proc/${pid}/stat`);
    return true;
  } catch (error) {
    return isEnoentError(error) ? false : null;
  }
}

/**
 * 给每个端口补 `processAlive`，同一个 pid 只检查一次（多个端口可能同属一个
 * 进程）。复用枚举本身的 IO seam 与超时预算：卡住的 /proc 读取降级为整份
 * 快照超时，而不是挂起请求。
 */
async function attachProcessLiveness(
  ports: ListeningPort[],
  io: ProcfsIo,
): Promise<ListeningPort[]> {
  const aliveByPid = new Map<number, boolean | null>();
  const result: ListeningPort[] = [];
  for (const port of ports) {
    const pid = port.pid;
    if (pid === null || !Number.isInteger(pid) || pid <= 0) {
      result.push({ ...port, processAlive: null });
      continue;
    }
    let alive = aliveByPid.get(pid);
    if (alive === undefined) {
      alive = await readProcessAlive(io, pid);
      aliveByPid.set(pid, alive);
    }
    result.push({ ...port, processAlive: alive });
  }
  return result;
}

export async function collectProcfsListeningPorts(
  io: ProcfsIo = defaultProcfsIo,
): Promise<StrategyOutcome> {
  const [ipv4, ipv6] = await Promise.all([
    readProcNetTcpFile(io, PROC_NET_TCP, 'tcp'),
    readProcNetTcpFile(io, PROC_NET_TCP6, 'tcp6'),
  ]);
  if (ipv4.error !== undefined && ipv6.error !== undefined) {
    return { ports: [], reason: `读取 ${PROC_NET_TCP} 失败：${ipv4.error}` };
  }
  const entries = [...ipv4.entries, ...ipv6.entries];
  // 连接数按协议文件隔离：tcp6 监听者的 ESTABLISHED 行只出现在 /proc/net/tcp6，
  // 把 tcp 文件的计数贴到 tcp6 条目上会数成 0（或张冠李戴）。
  const establishedByProtocol: Record<ListeningPort['protocol'], ReadonlyMap<number, number>> = {
    tcp: ipv4.establishedCountByPort,
    tcp6: ipv6.establishedCountByPort,
  };
  const wantedInodes = new Set(entries.map((entry) => entry.inode).filter((inode) => inode > 0));
  const owners = await resolveSocketOwners(io, wantedInodes);
  const ports = await attachProcessLiveness(
    dedupePorts(
      entries.map((entry) => {
        const owner = owners.get(entry.inode);
        return {
          port: entry.port,
          protocol: entry.protocol,
          bindAddress: entry.bindAddress,
          pid: owner?.pid ?? null,
          processName: owner?.processName ?? null,
          source: 'procfs' as const,
          // 没有 ESTABLISHED 行就是确定的 0；读取失败的协议文件不会产生任何条目。
          establishedConnections: establishedByProtocol[entry.protocol].get(entry.port) ?? 0,
          processAlive: null,
          terminal: null,
        };
      }),
    ),
    io,
  );
  // IPv6 can legitimately be absent in a container; surface it as a partial
  // degradation instead of silently pretending the namespace has no v6 stack.
  const reason = ipv4.error ?? ipv6.error;
  return reason === undefined ? { ports } : { ports, reason };
}

/* ------------------------------------------------------------------------- *
 * 终端归属（procfs only）
 * ------------------------------------------------------------------------- */

/**
 * 从 `/proc/<pid>/stat` 解析 PPid（第 4 字段）。
 *
 * 不能「按空白切分后取第 4 段」：第 2 字段 `comm` 允许包含空格和括号
 * （进程名可以是 `my (weird) name`）。可靠做法是以**最后一个** `)` 为界，
 * 其后依次是 state（第 3 字段）与 ppid（第 4 字段）。
 */
export function parseProcStatPpid(content: string): number | null {
  const closing = content.lastIndexOf(')');
  if (closing < 0) return null;
  const fields = content
    .slice(closing + 1)
    .trim()
    .split(/\s+/);
  const ppid = Number.parseInt(fields[1] ?? '', 10);
  return Number.isInteger(ppid) && ppid >= 0 ? ppid : null;
}

/** 把注入查询结果折成 pid → 归属 的索引；非法 / 重复 pid 直接跳过（重复时保留先出现的最新行）。 */
function buildOwnedPidIndex(
  ownedTerminals: ReadonlyArray<OwnedTerminalPid>,
): Map<number, TerminalAttribution> {
  const index = new Map<number, TerminalAttribution>();
  for (const entry of ownedTerminals) {
    if (!Number.isInteger(entry.pid) || entry.pid <= 1 || index.has(entry.pid)) continue;
    index.set(entry.pid, { sessionId: entry.sessionId, terminalId: entry.terminalId });
  }
  return index;
}

export interface ResolveOwnedTerminalInput {
  io: ProcfsIo;
  pid: number | null;
  ownedByPid: ReadonlyMap<number, TerminalAttribution>;
  maxDepth?: number;
}

/**
 * 从监听 pid 沿 PPid 父链向上找第一个「属于当前用户的终端」。
 *
 * 监听者经常不是终端 shell 本身，而是它的后代（`npm run dev` → node →
 * esbuild…），所以必须回溯而不是只比 pid 相等。每一步都按「拿不到确切证据
 * 就返回 null」处理：stat 缺失 / 不可解析、ppid 非法、进程已退出、环、
 * 超过深度上限 —— 一律 null，绝不抛错、绝不猜。外层枚举超时（Promise.race）
 * 也覆盖这段回溯：卡住的 /proc 读取降级为整份快照超时，而不是挂起请求。
 */
export async function resolveOwnedTerminalForPid(
  input: ResolveOwnedTerminalInput,
): Promise<TerminalAttribution | null> {
  const startPid = input.pid;
  if (startPid === null || !Number.isInteger(startPid) || startPid <= 0) return null;
  const maxDepth = input.maxDepth ?? MAX_TERMINAL_ATTRIBUTION_DEPTH;
  const visited = new Set<number>();
  let current = startPid;
  for (let depth = 0; depth <= maxDepth; depth += 1) {
    if (visited.has(current)) return null; // 异常数据成环：不做归属
    visited.add(current);
    const owned = input.ownedByPid.get(current);
    if (owned !== undefined) return owned;
    if (current <= 1) return null; // 已到 init：再向上不存在终端
    let stat: string;
    try {
      stat = await input.io.readTextFile(`/proc/${current}/stat`);
    } catch {
      return null; // 进程已退出 / 无权限：拿不到父链，不归属
    }
    const ppid = parseProcStatPpid(stat);
    if (ppid === null || ppid <= 0 || ppid === current) return null;
    current = ppid;
  }
  return null; // 超过深度上限：不把更远的祖先猜成终端
}

interface AttributionContext {
  io: ProcfsIo;
  ownedTerminals: ReadonlyArray<OwnedTerminalPid>;
}

async function attachTerminalAttribution(
  ports: ListeningPort[],
  attribution: AttributionContext,
): Promise<ListeningPort[]> {
  const ownedByPid = buildOwnedPidIndex(attribution.ownedTerminals);
  if (ownedByPid.size === 0) return ports;
  const attributed: ListeningPort[] = [];
  for (const port of ports) {
    attributed.push({
      ...port,
      terminal: await resolveOwnedTerminalForPid({
        io: attribution.io,
        pid: port.pid,
        ownedByPid,
      }),
    });
  }
  return attributed;
}

function safeListOwnedTerminalPids(
  lookup: (userId: string) => ReadonlyArray<OwnedTerminalPid>,
  userId: string,
): ReadonlyArray<OwnedTerminalPid> {
  try {
    return lookup(userId);
  } catch (error) {
    // 查询失败只损失归属能力：端口列表照常返回、全部 terminal: null，
    // 不能让一次 registry 异常把只读枚举整体降级为错误。
    console.warn(`[listening-ports] 查询用户终端 pid 失败：${describeError(error)}`);
    return [];
  }
}

/* ------------------------------------------------------------------------- *
 * lsof strategy (macOS)
 * ------------------------------------------------------------------------- */

export function parseLsofOutput(output: string): ListeningPort[] {
  const ports: ListeningPort[] = [];
  for (const rawLine of output.split('\n')) {
    const line = rawLine.replace(/\(LISTEN\)\s*$/, '').trim();
    if (line.length === 0 || line.startsWith('COMMAND')) continue;
    const fields = line.split(/\s+/);
    if (fields.length < 6) continue;
    const name = fields[fields.length - 1];
    if (name === undefined) continue;
    const split = splitAddressAndPort(name);
    if (split === null) continue;
    const type = fields[4] ?? '';
    const protocol: ListeningPort['protocol'] =
      type === 'IPv6' || name.startsWith('[') ? 'tcp6' : 'tcp';
    const bindAddress =
      split.address === '*' ? (protocol === 'tcp' ? '0.0.0.0' : '::') : split.address;
    const pidRaw = fields[1];
    const pid = pidRaw !== undefined && /^\d+$/.test(pidRaw) ? Number.parseInt(pidRaw, 10) : null;
    const command = fields[0];
    ports.push({
      port: split.port,
      protocol,
      bindAddress,
      pid,
      processName: command !== undefined && command.length > 0 ? command : null,
      source: 'lsof',
      // `lsof -sTCP:LISTEN` 的输出里既没有连接状态也没有进程存活信息：这是平台
      // 能力限制，不是失败 —— 一律 null（未知），不要改成 0 / false。
      establishedConnections: null,
      processAlive: null,
      terminal: null,
    });
  }
  return ports;
}

async function collectLsofListeningPorts(exec: PortEnumerationExec): Promise<StrategyOutcome> {
  const { stdout } = await exec('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN']);
  return { ports: dedupePorts(parseLsofOutput(stdout)) };
}

/* ------------------------------------------------------------------------- *
 * PowerShell strategy (Windows)
 * ------------------------------------------------------------------------- */

interface PowerShellPortRecord {
  address?: unknown;
  port?: unknown;
  pid?: unknown;
  name?: unknown;
}

const POWERSHELL_LISTEN_SCRIPT = [
  "$ErrorActionPreference='Stop';",
  '$connections = @(Get-NetTCPConnection -State Listen | Select-Object LocalAddress,LocalPort,OwningProcess);',
  '$names = @{};',
  '$ids = @($connections | ForEach-Object { [int]$_.OwningProcess } | Sort-Object -Unique);',
  'if ($ids.Count -gt 0) { Get-Process -Id $ids -ErrorAction SilentlyContinue | ForEach-Object { $names[[string]$_.Id] = $_.ProcessName } };',
  '$connections | ForEach-Object { [pscustomobject]@{ address = [string]$_.LocalAddress; port = [int]$_.LocalPort; pid = [int]$_.OwningProcess; name = $names[[string]$_.OwningProcess] } } | ConvertTo-Json -Compress',
].join(' ');

export function parsePowerShellOutput(output: string): ListeningPort[] {
  const trimmed = output.trim();
  if (trimmed.length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }
  const records = Array.isArray(parsed) ? parsed : [parsed];
  const ports: ListeningPort[] = [];
  for (const record of records) {
    if (record === null || typeof record !== 'object') continue;
    const candidate = record as PowerShellPortRecord;
    const port =
      typeof candidate.port === 'number'
        ? candidate.port
        : typeof candidate.port === 'string'
          ? Number.parseInt(candidate.port, 10)
          : Number.NaN;
    if (!Number.isInteger(port) || port <= 0 || port > 65535) continue;
    const bindAddress =
      typeof candidate.address === 'string' && candidate.address.length > 0
        ? candidate.address
        : '0.0.0.0';
    const protocol: ListeningPort['protocol'] = bindAddress.includes(':') ? 'tcp6' : 'tcp';
    const pid =
      typeof candidate.pid === 'number' && Number.isInteger(candidate.pid) && candidate.pid > 0
        ? candidate.pid
        : null;
    const processName =
      typeof candidate.name === 'string' && candidate.name.length > 0 ? candidate.name : null;
    ports.push({
      port,
      protocol,
      bindAddress,
      pid,
      processName,
      source: 'powershell',
      // `Get-NetTCPConnection -State Listen` 同样不含连接数与进程存活信息：
      // 一律 null（未知），不要用 0 / false 假装知道。
      establishedConnections: null,
      processAlive: null,
      terminal: null,
    });
  }
  return ports;
}

async function collectPowerShellListeningPorts(
  exec: PortEnumerationExec,
): Promise<StrategyOutcome> {
  const { stdout } = await exec('powershell', ['-NoProfile', '-Command', POWERSHELL_LISTEN_SCRIPT]);
  return { ports: dedupePorts(parsePowerShellOutput(stdout)) };
}

/* ------------------------------------------------------------------------- *
 * Shared helpers: exec, timeout, filtering, caching
 * ------------------------------------------------------------------------- */

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function splitAddressAndPort(name: string): { address: string; port: number } | null {
  const separator = name.lastIndexOf(':');
  if (separator <= 0) return null;
  const port = Number.parseInt(name.slice(separator + 1), 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  let address = name.slice(0, separator);
  if (address.startsWith('[') && address.endsWith(']')) {
    address = address.slice(1, -1);
  }
  return { address, port };
}

function dedupePorts(ports: ListeningPort[]): ListeningPort[] {
  const seen = new Set<string>();
  const result: ListeningPort[] = [];
  for (const port of ports) {
    const key = `${port.port}|${port.protocol}|${port.bindAddress}|${port.pid ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(port);
  }
  return result;
}

function sortAndDedupePorts(ports: ListeningPort[]): ListeningPort[] {
  return dedupePorts(ports).sort((left, right) => {
    if (left.port !== right.port) return left.port - right.port;
    if (left.protocol !== right.protocol) return left.protocol.localeCompare(right.protocol);
    if (left.bindAddress !== right.bindAddress) {
      return left.bindAddress.localeCompare(right.bindAddress);
    }
    return (left.pid ?? 0) - (right.pid ?? 0);
  });
}

/**
 * The gateway's own port and Redis are noise for the terminal panel — the user
 * cannot meaningfully "open" them and they are visible on every deployment.
 */
function resolveExcludedPorts(): Set<number> {
  const excluded = new Set<number>();
  const gatewayRaw = globalThis.process?.env['GATEWAY_PORT'];
  const gatewayPort = gatewayRaw === undefined ? NaN : Number.parseInt(gatewayRaw, 10);
  excluded.add(
    Number.isInteger(gatewayPort) && gatewayPort > 0 ? gatewayPort : DEFAULT_GATEWAY_PORT,
  );
  excluded.add(resolveRedisPort());
  return excluded;
}

function resolveRedisPort(): number {
  const raw = globalThis.process?.env['REDIS_URL'];
  if (raw === undefined || raw.trim().length === 0) return DEFAULT_REDIS_PORT;
  try {
    const parsed = new URL(raw);
    const port = Number.parseInt(parsed.port, 10);
    return Number.isInteger(port) && port > 0 && port <= 65535 ? port : DEFAULT_REDIS_PORT;
  } catch {
    return DEFAULT_REDIS_PORT;
  }
}

function defaultPortEnumerationExec(
  cmd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { encoding: 'utf-8', maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          reject(error instanceof Error ? error : new Error('port enumeration exec failed'));
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

function runStrategy(
  strategy: ListeningPort['source'],
  exec: PortEnumerationExec,
  io: ProcfsIo,
  attribution: AttributionContext | null,
): Promise<StrategyOutcome> {
  if (strategy === 'procfs') return collectProcfsListeningPortsWithAttribution(io, attribution);
  // 归属本轮只在 linux/procfs 实现：lsof / powershell 拿不到「本网关终端 pid 的
  // 进程树」，一律 terminal: null、快照级 attributionSupported 为 false —— 这是
  // 平台能力限制，不是失败：不要据此以为归属在其他平台也可用，也不要把它修成
  // 「这些端口属于外部进程」。
  if (strategy === 'lsof') return collectLsofListeningPorts(exec);
  return collectPowerShellListeningPorts(exec);
}

async function collectProcfsListeningPortsWithAttribution(
  io: ProcfsIo,
  attribution: AttributionContext | null,
): Promise<StrategyOutcome> {
  const outcome = await collectProcfsListeningPorts(io);
  if (attribution === null || outcome.ports.length === 0) return outcome;
  // 归属与枚举共用同一段超时预算：卡住的 /proc 读取会降级为整份快照超时（带 reason），
  // 而不是让请求无限挂起。
  return { ...outcome, ports: await attachTerminalAttribution(outcome.ports, attribution) };
}

/**
 * `Promise.race` returns the degraded value on timeout instead of rejecting, so
 * a stalled `lsof`/`powershell` can never wedge a request. The losing promise
 * keeps running (it holds no resources beyond a short-lived child process that
 * the runtime reaps) — acceptable for a read-only probe.
 */
async function runStrategyWithTimeout(
  strategy: ListeningPort['source'],
  exec: PortEnumerationExec,
  io: ProcfsIo,
  timeoutMs: number,
  attribution: AttributionContext | null,
): Promise<StrategyOutcome | null> {
  const work = runStrategy(strategy, exec, io, attribution);
  if (!(timeoutMs > 0)) return work;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function enumerateListeningPorts(
  strategy: ListeningPort['source'],
  exec: PortEnumerationExec,
  io: ProcfsIo,
  timeoutMs: number,
  now: () => number,
  attribution: AttributionContext | null,
): Promise<ListeningPortsSnapshot> {
  try {
    const outcome = await runStrategyWithTimeout(strategy, exec, io, timeoutMs, attribution);
    if (outcome === null) {
      return {
        ports: [],
        strategy,
        attributionSupported: attribution !== null,
        reason: `端口枚举超时（>${timeoutMs}ms），已降级为空列表。`,
        collectedAtMs: now(),
      };
    }
    const excluded = resolveExcludedPorts();
    const ports = sortAndDedupePorts(outcome.ports.filter((port) => !excluded.has(port.port)));
    return {
      ports,
      strategy,
      attributionSupported: attribution !== null,
      ...(outcome.reason !== undefined ? { reason: outcome.reason } : {}),
      collectedAtMs: now(),
    };
  } catch (error) {
    return {
      ports: [],
      strategy,
      attributionSupported: attribution !== null,
      reason: `端口枚举失败：${describeError(error)}`,
      collectedAtMs: now(),
    };
  }
}

function resolveCacheTtlMs(): number {
  const raw = globalThis.process?.env[CACHE_TTL_ENV_KEY];
  if (raw === undefined || raw.trim().length === 0) return DEFAULT_CACHE_TTL_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0) return DEFAULT_CACHE_TTL_MS;
  return parsed;
}

interface ListeningPortsCacheEntry {
  atMs: number;
  /**
   * 这份快照的归属计算面向哪个用户。
   * 快照里带着**针对该用户**的终端归属：服务给另一个用户就会泄露「别人的端口
   * 属于哪个终端」。因此 userId 不同一律视为未命中 —— 宁可多跑一次枚举，
   * 也不能跨用户复用（这正是本任务唯一的正确性陷阱）。
   */
  userId: string | null;
  snapshot: ListeningPortsSnapshot;
}

let cachedSnapshot: ListeningPortsCacheEntry | null = null;
let inflightEnumeration: {
  userId: string | null;
  promise: Promise<ListeningPortsSnapshot>;
} | null = null;

/** Test-only: clear the module-level cache/single-flight state between cases. */
export function resetListeningPortsCacheForTests(): void {
  cachedSnapshot = null;
  inflightEnumeration = null;
}

export async function listListeningPorts(
  options: ListListeningPortsOptions = {},
): Promise<ListeningPortsSnapshot> {
  const now = options.now ?? Date.now;
  const platform = globalThis.process?.platform ?? 'linux';
  const requested = options.strategy ?? 'auto';
  const resolved =
    requested === 'auto'
      ? detectPortEnumerationStrategy(platform)
      : { strategy: requested as ListeningPort['source'] | null };
  if (resolved.strategy === null) {
    return {
      ports: [],
      strategy: null,
      attributionSupported: false,
      reason: resolved.reason ?? `当前平台 ${platform} 暂无端口枚举策略。`,
      collectedAtMs: now(),
    };
  }
  const strategy = resolved.strategy;
  const userId = options.userId ?? null;
  const lookup = options.listOwnedTerminalPids;
  const attribution =
    strategy === 'procfs' && userId !== null && lookup !== undefined
      ? {
          io: options.procfsIo ?? defaultProcfsIo,
          ownedTerminals: safeListOwnedTerminalPids(lookup, userId),
        }
      : null;
  const ttlMs = resolveCacheTtlMs();
  if (
    cachedSnapshot !== null &&
    cachedSnapshot.snapshot.strategy === strategy &&
    cachedSnapshot.userId === userId &&
    now() - cachedSnapshot.atMs < ttlMs
  ) {
    return cachedSnapshot.snapshot;
  }
  // 单飞只对同一用户成立；不同用户必须各自枚举（归属不能共享，见上方注释）。
  if (inflightEnumeration !== null && inflightEnumeration.userId === userId) {
    return inflightEnumeration.promise;
  }
  const exec = options.exec ?? defaultPortEnumerationExec;
  const io = options.procfsIo ?? defaultProcfsIo;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const promise = enumerateListeningPorts(strategy, exec, io, timeoutMs, now, attribution)
    .then((snapshot) => {
      cachedSnapshot = { atMs: now(), userId, snapshot };
      return snapshot;
    })
    .finally(() => {
      // 只清理仍是自己的那一笔：跨用户并发时，早到者不能把后来者的单飞记录抹掉。
      if (inflightEnumeration !== null && inflightEnumeration.promise === promise) {
        inflightEnumeration = null;
      }
    });
  inflightEnumeration = { userId, promise };
  return promise;
}
