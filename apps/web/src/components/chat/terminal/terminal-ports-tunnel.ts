/**
 * 「复制隧道命令」的纯逻辑（无 React、无 I/O）：把一条远端监听翻译成一条用户在
 * **本机**执行的 `ssh -L` 命令字符串。面板只负责复制，不建立任何连接 —— 网关也
 * 不做转发，命令是否可用取决于用户的 SSH 连接与部署拓扑（见文末）。
 *
 * 绑定地址归类（`describeBindAddress`）从 `TerminalPortsPanel` 移到这里：`-L` 目标
 * 地址的推导与行内「仅本机 / 全网可达 / 指定地址」标注必须用**同一套**判定，
 * 分开写两份迟早会漂移。
 *
 * 为什么 `-L` 的目标地址必须随绑定地址变化（而不是固定写 `localhost`）：
 * `-L` 冒号后那一段是**由 SSH 服务端（网关所在宿主机）解析**的目标，不是本机。
 *  - 回环监听（127.0.0.0/8 / ::1 / localhost）与通配监听（0.0.0.0 / ::）在网关机器上
 *    都能用 `127.0.0.1` 连上 —— 通配 socket 本身就是「接受任意本地地址的连接」，
 *    回环连接自然在内，所以两者目标统一写 `127.0.0.1`；
 *  - `specific` 监听只接受绑定到的那一个地址，宿主机上写 `127.0.0.1` 会被拒绝 →
 *    目标必须是实际绑定地址。写错这一步的表现是「命令能连上但隧道报 connection
 *    refused」，比不生成命令更难排查，所以这里必须按绑定地址推导。
 *
 * 为什么这条命令在容器拓扑下可能是无效的（因此 UI 必须在按钮 title / 远端说明里
 * 讲清楚）：网关常见部署是 Docker 容器，监听位于**容器网络命名空间**内；而 `ssh -L`
 * 的出口在宿主机网络命名空间，`-L` 目标也由宿主机解析 —— 所以宿主机的 `localhost`
 * 与宿主机的 `ssh -L` 都到不了容器内的监听，只有**显式发布到宿主机**的端口
 * （`docker run -p` / compose `ports:`）才可达。命令在「网关直接跑在宿主机上」的
 * 部署里成立，在容器里只对已发布端口成立。
 */

import type { SSHConnectionEntry } from '@openAwork/web-client';

export interface BindAddressDescriptor {
  kind: 'loopback' | 'wildcard' | 'specific';
  label: string;
}

/** 归一化绑定地址：trim + 小写 + 去掉 IPv4-mapped 前缀（`::ffff:127.0.0.1` ≈ `127.0.0.1`）。 */
function normalizeBindAddress(bindAddress: string): string {
  const normalized = bindAddress.trim().toLowerCase();
  return normalized.startsWith('::ffff:') ? normalized.slice('::ffff:'.length) : normalized;
}

/** 绑定地址 → 「仅本机 / 全网可达 / 指定地址」；其余地址如实标注为指定地址。 */
export function describeBindAddress(bindAddress: string): BindAddressDescriptor {
  const address = normalizeBindAddress(bindAddress);
  // 127.0.0.0/8 整段都是回环（不只 127.0.0.1）。
  if (address === '::1' || address === 'localhost' || address.startsWith('127.')) {
    return { kind: 'loopback', label: '仅本机' };
  }
  if (address === '::' || address === '0.0.0.0') {
    return { kind: 'wildcard', label: '全网可达' };
  }
  return { kind: 'specific', label: '指定地址' };
}

/**
 * `-L` 规格里的目标主机（由 SSH 服务端即网关宿主机解析）。
 *
 * 回环 / 通配监听 → 统一 `127.0.0.1`（见文件头）；`specific` → 实际绑定地址，
 * 并在含冒号时加方括号 —— `-L` 的目标是 `host[:port]` 语法，裸 IPv6 字面量的冒号
 * 会被当成端口分隔符解析。
 */
export function tunnelTargetHost(bindAddress: string): string {
  switch (describeBindAddress(bindAddress).kind) {
    case 'loopback':
    case 'wildcard':
      // 通配 socket 接受回环连接：两类监听的目标统一写 127.0.0.1。
      return '127.0.0.1';
    case 'specific': {
      const address = normalizeBindAddress(bindAddress);
      return address.includes(':') ? `[${address}]` : address;
    }
  }
}

/** 生成命令所需的最小 SSH 连接信息（与 web-client 的 `SSHConnectionEntry` 结构兼容）。 */
export type SshTunnelConnection = Pick<SSHConnectionEntry, 'host' | 'port' | 'username'>;

export interface SshTunnelCommandInput {
  /** 远端监听端口。本机侧沿用同一端口号：粘贴命令后 `localhost:<port>` 直接可用。 */
  port: number;
  /** 绑定地址原样来自网关快照，不做调用方归一化（本模块负责判定语义）。 */
  bindAddress: string;
  /** 选定的 SSH 连接；null = 没有可用连接（未配置，或列表读取失败）。 */
  ssh: SshTunnelConnection | null;
}

export type SshTunnelCommandResult =
  { form: 'ready'; command: string; summary: string } | { form: 'placeholder'; command: string };

/** ssh 客户端默认就连 22：默认端口下 `-p 22` 是噪音，省略。 */
const DEFAULT_SSH_PORT = 22;

/**
 * 生成 `ssh -L` 隧道命令。
 *
 * `ssh` 为 null 时输出**占位模板**（保留按绑定地址算好的 `-L` 规格，用户名 / 主机
 * 留成明显可替换的尖括号）—— 用户没有配置 SSH 连接时，模板仍然把最难推导的部分
 * 算好了，比不给任何东西有用；复制反馈会明确播报「模板」而不是假装命令可用。
 */
export function buildSshTunnelCommand(input: SshTunnelCommandInput): SshTunnelCommandResult {
  const forward = `${input.port}:${tunnelTargetHost(input.bindAddress)}:${input.port}`;
  if (input.ssh === null) {
    return { form: 'placeholder', command: `ssh -L ${forward} <用户名>@<主机>` };
  }
  const portFlag = input.ssh.port === DEFAULT_SSH_PORT ? '' : ` -p ${input.ssh.port}`;
  return {
    form: 'ready',
    command: `ssh -L ${forward}${portFlag} ${input.ssh.username}@${input.ssh.host}`,
    summary: `${input.ssh.username}@${input.ssh.host}`,
  };
}

/**
 * 从用户的 SSH 连接列表里挑一条用于隧道命令。
 *
 * 端口快照里没有「这个监听对应哪条 SSH 连接」的信息，只能启发式挑选：优先取
 * `connected` 的条目（正在用的连接最可能就是网关那台机器），否则取列表第一条。
 * 空列表返回 null，调用方据此退化为占位模板；选中结果会以 `user@host` 出现在
 * 复制播报里，用户能立即核对选的是不是自己想连的机器。
 */
export function pickSshConnection(
  connections: readonly SSHConnectionEntry[],
): SSHConnectionEntry | null {
  return connections.find((entry) => entry.status === 'connected') ?? connections[0] ?? null;
}
