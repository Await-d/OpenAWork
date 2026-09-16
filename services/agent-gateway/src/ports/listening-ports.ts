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
 */

import { execFile } from 'node:child_process';
import { readFile, readdir, readlink } from 'node:fs/promises';

export interface ListeningPort {
  port: number;
  protocol: 'tcp' | 'tcp6';
  bindAddress: string;
  pid: number | null;
  processName: string | null;
  source: 'procfs' | 'lsof' | 'powershell';
}

export interface ListeningPortsSnapshot {
  ports: ListeningPort[];
  /** 本次枚举实际使用的策略；不可用时为 null 并提供 reason */
  strategy: ListeningPort['source'] | null;
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
}

const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_CACHE_TTL_MS = 3_000;
const CACHE_TTL_ENV_KEY = 'OPENAWORK_PORTS_ENUMERATION_TTL_MS';
const DEFAULT_GATEWAY_PORT = 3000;
const DEFAULT_REDIS_PORT = 6379;
const PROC_NET_TCP = '/proc/net/tcp';
const PROC_NET_TCP6 = '/proc/net/tcp6';

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

/**
 * Parse a `/proc/net/tcp{,6}` dump. Only `0A` (LISTEN) rows survive; malformed
 * lines are skipped rather than thrown so a kernel quirk can't break the page.
 */
export function parseProcNetTcpContent(
  content: string,
  protocol: ListeningPort['protocol'],
): ProcNetTcpEntry[] {
  const entries: ProcNetTcpEntry[] = [];
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const fields = line.split(/\s+/);
    if (fields.length < 10) continue;
    if (fields[0] === 'sl') continue; // header row
    if ((fields[3] ?? '').toUpperCase() !== '0A') continue; // LISTEN only
    const local = fields[1];
    if (local === undefined) continue;
    const separator = local.lastIndexOf(':');
    if (separator <= 0) continue;
    const hexAddress = local.slice(0, separator);
    const port = Number.parseInt(local.slice(separator + 1), 16);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) continue;
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
  return entries;
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
  error?: string;
}

async function readProcNetTcpFile(
  io: ProcfsIo,
  path: string,
  protocol: ListeningPort['protocol'],
): Promise<ProcNetReadResult> {
  try {
    const content = await io.readTextFile(path);
    return { entries: parseProcNetTcpContent(content, protocol) };
  } catch (error) {
    return { entries: [], error: describeError(error) };
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
  const wantedInodes = new Set(entries.map((entry) => entry.inode).filter((inode) => inode > 0));
  const owners = await resolveSocketOwners(io, wantedInodes);
  const ports = dedupePorts(
    entries.map((entry) => {
      const owner = owners.get(entry.inode);
      return {
        port: entry.port,
        protocol: entry.protocol,
        bindAddress: entry.bindAddress,
        pid: owner?.pid ?? null,
        processName: owner?.processName ?? null,
        source: 'procfs' as const,
      };
    }),
  );
  // IPv6 can legitimately be absent in a container; surface it as a partial
  // degradation instead of silently pretending the namespace has no v6 stack.
  const reason = ipv4.error ?? ipv6.error;
  return reason === undefined ? { ports } : { ports, reason };
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
        : Number.parseInt(String(candidate.port ?? ''), 10);
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
    ports.push({ port, protocol, bindAddress, pid, processName, source: 'powershell' });
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
          reject(error);
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
): Promise<StrategyOutcome> {
  if (strategy === 'procfs') return collectProcfsListeningPorts();
  if (strategy === 'lsof') return collectLsofListeningPorts(exec);
  return collectPowerShellListeningPorts(exec);
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
  timeoutMs: number,
): Promise<StrategyOutcome | null> {
  const work = runStrategy(strategy, exec);
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
  timeoutMs: number,
  now: () => number,
): Promise<ListeningPortsSnapshot> {
  try {
    const outcome = await runStrategyWithTimeout(strategy, exec, timeoutMs);
    if (outcome === null) {
      return {
        ports: [],
        strategy,
        reason: `端口枚举超时（>${timeoutMs}ms），已降级为空列表。`,
        collectedAtMs: now(),
      };
    }
    const excluded = resolveExcludedPorts();
    const ports = sortAndDedupePorts(outcome.ports.filter((port) => !excluded.has(port.port)));
    return {
      ports,
      strategy,
      ...(outcome.reason !== undefined ? { reason: outcome.reason } : {}),
      collectedAtMs: now(),
    };
  } catch (error) {
    return {
      ports: [],
      strategy,
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

let cachedSnapshot: { atMs: number; snapshot: ListeningPortsSnapshot } | null = null;
let inflightEnumeration: Promise<ListeningPortsSnapshot> | null = null;

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
      reason: resolved.reason ?? `当前平台 ${platform} 暂无端口枚举策略。`,
      collectedAtMs: now(),
    };
  }
  const strategy = resolved.strategy;
  const ttlMs = resolveCacheTtlMs();
  if (
    cachedSnapshot !== null &&
    cachedSnapshot.snapshot.strategy === strategy &&
    now() - cachedSnapshot.atMs < ttlMs
  ) {
    return cachedSnapshot.snapshot;
  }
  if (inflightEnumeration !== null) return inflightEnumeration;
  const exec = options.exec ?? defaultPortEnumerationExec;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  inflightEnumeration = enumerateListeningPorts(strategy, exec, timeoutMs, now)
    .then((snapshot) => {
      cachedSnapshot = { atMs: now(), snapshot };
      return snapshot;
    })
    .finally(() => {
      inflightEnumeration = null;
    });
  return inflightEnumeration;
}
