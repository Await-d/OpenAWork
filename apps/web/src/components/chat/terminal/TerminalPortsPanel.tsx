/**
 * TerminalPortsPanel — 「端口」页签的只读内容（T-15 只读列表 + P0 面板体验收口）。
 *
 * 数据来自网关 `GET /sessions/ports/listening`（T-14 客户端 `createListeningPortsClient`）；
 * 只读展示监听端口，**不做**端口转发 / 代理 —— 所以远端网关时没有可达路径，
 * 「在浏览器打开」显式禁用并说明原因，而不是给一个点了必然失败的按钮。
 * 同机也有一种连不上的情况：监听绑在具体地址（`specific`）时 `localhost` 不是那个
 * 地址，同样禁用打开并说明原因（复制地址不受影响）。
 *
 * 「复制隧道命令」（additive，仅远端网关渲染 —— 同机的直连链接已覆盖该场景）：
 * 只生成并复制一条 `ssh -L` 命令字符串，网关不参与任何转发；命令构造、`-L` 目标
 * 随绑定地址变化的理由与容器拓扑的限制见 `terminal-ports-tunnel.ts`。
 * 生成命令需要用户已配置的 SSH 连接（`createSshClient(...).list`）：只在远端网关
 * 面板挂载时取一次；未配置 / 读取失败 / 请求尚未返回，一律退化为占位模板，
 * 永不阻塞端口列表。
 *
 * 终止（additive）：仅当网关把监听进程归属到「本网关为当前用户拉起的终端」
 * （`port.terminal !== null`）时，行内才出现「终止该终端」；它先弹贴底确认条，
 * 确认后调用既有的 `POST /sessions/:sessionId/terminals/:terminalId/kill`
 * （web-client 的 `kill(token, sessionId, terminalId)`），成功后静默刷新列表。
 * 归属失败的行没有动作并说明原因 —— 前端**不发送 pid**，也没有任何按 pid 杀进程的路径。
 *
 * 端口状态（additive，A）：状态列展示该端口的连接状态（procfs 下是解析
 * `/proc/net/tcp{,6}` 时顺带统计的 ESTABLISHED 行数，与快照同寿的时点值）与
 * 「进程已退出」警示。`null` = 平台统计不了（非 linux/procfs），**不显示成 0**；
 * 只有 `processAlive === false` 才提示异常，`null` 的原因放 title —— 一个恒亮的
 * 「运行中」只会变成噪音。
 *
 * 归属 chip（additive，B）：三态 —— 「本网关终端」（可在此终止）/「外部进程」/
 * 「归属不可用」（`snapshot.attributionSupported === false` 时的显式结论）。
 * 能力判据只能用快照的 `attributionSupported`，**不得**从 `strategy` 名称推断：
 * 平台不支持归属时 `terminal` 同样是 null，把它说成「外部进程」就是撒谎。
 *
 * 取数策略：见 `use-terminal-ports-feed.ts` —— 挂载取数 + 可见时 5s 轮询；P0 起支持
 * 手动「刷新」与「暂停 / 继续」（暂停只停自动轮询，手动刷新仍可用）。
 *
 * 布局（P0）：
 *  - L1：表头 sticky 在滚动容器顶部（solid 背景 + 底边线，行滚过时不透出）；
 *  - L3 / L4：计数 + 快照年龄 + 筛选 + 暂停 / 刷新收进滚动容器**外**的单条工具条，
 *    远端说明与降级说明改为紧凑 chip，避免堆叠的说明块吃掉 120–900px 高度域里的列表空间；
 *  - L2 / L5：窄容器下每行改三行（首行端口 + 协议 + 可达性标注 + 操作，次行进程·pid +
 *    绑定地址，末行归属 chip + 连接状态 + 「进程已退出」），「进程」在任何宽度都不再被
 *    隐藏；端口数字右对齐 + `tabular-nums`。
 *
 * 为什么重排用**容器查询**而不是视口 media：面板可侧停靠到 `clamp(280px, 32%, 560px)`
 * 的窄列，1440px 视口下端口表可能只有 300px 宽 —— 视口 media 对此完全不可见。
 * 容器注册在 `.terminal-ports` 根上（`container-type: inline-size`）；已核对子树内
 * 没有 `position: fixed`（fixed 会被 layout containment 改变包含块），因此安全。
 *
 * 同机判定（与 `utils/gateway/desktop-gateway.ts` 同源，口径对齐 `canOpenPathInSystem`）：
 *  - 网关 host 是回环（127.0.0.1 / localhost / ::1）→ 同机；
 *  - 桌面端（Tauri 标志）默认 sidecar 同机，但显式切到「远端网关」模式时不算同机。
 * 同机时用 `http://localhost:<port>` 打开、复制 `localhost:<port>`；远端没有可达路径，
 * 打开保持禁用，**也不渲染「复制地址」** —— `<网关 host>:<port>` 在用户机器上同样不可达，
 * 把网关 host 拼上端口当作可复制地址是在承诺一个多数情况下不存在的能力；诚实的替代是
 * 「复制隧道命令」（`ssh -L`，自带容器拓扑提醒）。远端可达地址（端口转发 / 网关侧代理）
 * 是独立的安全评审交付，已明确不在本轮范围。
 *
 * 面板本地视图状态（过滤词 / 暂停 / 复制反馈）随面板卸载重置：端口页只在页签激活时
 * 挂载、切走即卸载（`QuickTerminalPanel` 的页签是真切换内容），这是有意取舍 ——
 * 不把临时视图偏好写进 store。
 */

import { useEffect, useRef, useState } from 'react';
import {
  createSshClient,
  type ListeningPortTerminalRef,
  type ListeningPortView,
  type SSHConnectionEntry,
} from '@openAwork/web-client';
import { killSessionTerminal } from '../../conversation-runtime/terminals/terminals-api.js';
import {
  isLocalGatewayUrl,
  isTauriRuntime,
  readDesktopGatewayMode,
} from '../../../utils/gateway/desktop-gateway.js';
import {
  AlertTriangleIcon,
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  LinkIcon,
  PauseIcon,
  PlayIcon,
  PlugIcon,
  RefreshIcon,
  SearchIcon,
  SquareStopIcon,
} from './TerminalIcons.js';
import { writeClipboardText } from './terminal-key-handlers.js';
import { TERMINAL_UI_INPUT_ATTR } from './terminal-panel-shortcuts.js';
import type { BindAddressDescriptor } from './terminal-ports-tunnel.js';
import {
  buildSshTunnelCommand,
  describeBindAddress,
  pickSshConnection,
  tunnelTargetHost,
} from './terminal-ports-tunnel.js';
import { PORTS_AGE_TICK_MS, useTerminalPortsFeed } from './use-terminal-ports-feed.js';
import './terminal-panel.css';

export interface TerminalPortsPanelProps {
  gatewayUrl: string;
  token: string | null;
}

/** 复制反馈（按钮对勾 + 读屏播报）的驻留时长，到点一起复位。 */
const COPY_FEEDBACK_MS = 2_000;

/** 终止成功提示的驻留时长；失败提示不自动消失（用户需要看到失败原因）。 */
const KILL_SUCCESS_NOTICE_MS = 4_000;

interface CopyFeedback {
  /** 命中的行 key：只让被操作的那一行换对勾。 */
  rowKey: string;
  /** 命中的动作：复制反馈不能串台（「复制地址」与「复制隧道命令」是两条独立路径）。 */
  action: 'address' | 'tunnel';
  ok: boolean;
  message: string;
}

/**
 * 同机判定：同机才允许「在浏览器打开」。
 *
 * 这里复用既有的网关地址工具而不是自己解析 URL —— 见 `desktop-gateway.ts` 的
 * `isLocalGatewayUrl`（hostname ∈ 127.0.0.1 / localhost / ::1）。桌面端标志单独放行
 * 是有前提的：Tauri 的 sidecar 拓扑里网关就在本机；但用户在设置里显式选了远端网关
 * （`desktop_gateway_mode === 'remote'`）时，`localhost:<port>` 指向的是用户自己的机器，
 * 必须按远端处理 —— 与 `open-in-system.ts` 的 `canOpenPathInSystem()` 同一口径。
 */
function isSameMachineGateway(gatewayUrl: string): boolean {
  if (isLocalGatewayUrl(gatewayUrl)) return true;
  if (isTauriRuntime()) return readDesktopGatewayMode() !== 'remote';
  return false;
}

/**
 * 「在浏览器打开」的禁用原因；null = 可以打开（同机且绑定地址不是 specific）。
 *
 * 两个原因是独立的：远端网关没有网络路径；同机 + specific 绑定则是 `localhost`
 * 不是监听所在的那个地址 —— 后者是本次修复的真实缺陷，不能因为「同机」就继续
 * 渲染一个点了必然连不上的链接。
 */
function openDisabledReason(
  port: ListeningPortView,
  bindKind: BindAddressDescriptor['kind'],
  sameMachine: boolean,
): string | null {
  switch (bindKind) {
    case 'specific': {
      const reason = `端口只监听 ${port.bindAddress}，localhost 无法访问`;
      return sameMachine ? reason : `需要反向代理，当前未启用；且${reason}`;
    }
    case 'loopback':
    case 'wildcard':
      return sameMachine ? null : '需要反向代理，当前未启用';
  }
}

/** 进程列：`processName + pid` 的组合；两者都缺时用 `—` 兜底（best-effort 字段，不是错误）。 */
function formatProcess(port: ListeningPortView): string {
  const name = port.processName?.trim() ?? '';
  if (name.length > 0 && port.pid !== null) return `${name} · pid ${port.pid}`;
  if (name.length > 0) return name;
  if (port.pid !== null) return `pid ${port.pid}`;
  return '—';
}

/**
 * 进程列的 `title`：归属成功时说明「这是你的终端、可在此终止」；否则说明为什么
 * 没有终止动作 —— 归属失败不是错误，但用户要知道该去哪台机器处理。
 * 平台不支持归属时不能声称「不是你的终端」：那会把「不知道」说成结论。
 */
function formatProcessTitle(port: ListeningPortView, attributionSupported: boolean): string {
  if (port.terminal !== null) {
    return `该端口由你启动的终端（会话 ${port.terminal.sessionId}）占用，可在此终止`;
  }
  if (!attributionSupported) {
    return '当前平台无法判断占用者是否属于本网关终端（仅 linux/procfs 支持归属）';
  }
  return '占用者不是本网关为你启动的终端，请在那台机器上处理';
}

type OwnerChipVariant = 'gateway' | 'external' | 'unavailable';

interface OwnerChip {
  variant: OwnerChipVariant;
  label: string;
  title: string;
}

/**
 * 归属 chip 的三态。`attributionSupported === false` 时必须是「归属不可用」：
 * 此时 `terminal === null` 只代表没做过判定，不代表占用者是外部进程。
 */
function describeOwnerChip(port: ListeningPortView, attributionSupported: boolean): OwnerChip {
  if (port.terminal !== null) {
    return {
      variant: 'gateway',
      label: '本网关终端',
      title: `该端口由你启动的终端占用（会话 ${port.terminal.sessionId} · 终端 ${port.terminal.terminalId}），可在此终止`,
    };
  }
  if (!attributionSupported) {
    return {
      variant: 'unavailable',
      label: '归属不可用',
      title: '当前平台无法把端口归属到本网关终端（仅 linux/procfs 支持归属），不代表它是外部进程',
    };
  }
  return {
    variant: 'external',
    label: '外部进程',
    title:
      '占用进程不在本网关为当前用户启动的终端列表里，无法从此处处理，请到运行该进程的机器上处理',
  };
}

/** 连接状态：null 什么都不显示（原因在 title），0 → 无连接，N → N 条连接。 */
function formatConnectionsLabel(port: ListeningPortView): string | null {
  if (port.establishedConnections === null) return null;
  if (port.establishedConnections <= 0) return '无连接';
  return `${port.establishedConnections} 条连接`;
}

/**
 * 状态单元格的 `title`：讲清「为什么看不到连接数 / 存活状态」。
 * 未知不是错误，但用户需要知道它不代表 0、也不代表进程已退出。
 */
function portStatusTitle(port: ListeningPortView): string {
  const parts: string[] = [
    port.establishedConnections === null
      ? '连接数：当前平台无法统计（非 linux/procfs），不代表为 0'
      : `连接数：最近一次快照统计到 ${port.establishedConnections} 条 ESTABLISHED 连接（≤5 秒缓存，非实时）`,
  ];
  if (port.processAlive === null) {
    parts.push('进程存活：无法判断（pid 未知或读取受限），不代表进程已退出');
  }
  return parts.join('；');
}

const PROCESS_EXITED_TITLE =
  '快照读到该监听进程已不存在（进程可能在枚举与展示之间退出），端口可能已释放';

function sortPorts(ports: readonly ListeningPortView[]): ListeningPortView[] {
  return [...ports].sort(
    (left, right) =>
      left.port - right.port ||
      left.protocol.localeCompare(right.protocol) ||
      left.bindAddress.localeCompare(right.bindAddress),
  );
}

/** 行标识：与 React key 同源，复制反馈据此定位「哪一行刚复制过」。 */
function portRowKey(port: ListeningPortView): string {
  return `${port.port}-${port.protocol}-${port.bindAddress}`;
}

/**
 * 「复制地址」的完整地址；`null` = 该模式下没有可达地址，调用方**不得**渲染复制动作。
 *
 * 同机（`sameMachine`）：`localhost:<port>` —— 浏览器与网关在同一台机器上，这个地址成立。
 * 远端：返回 null。监听 socket 位于网关的网络命名空间（容器部署里就是容器网络命名空间），
 * `<网关 host>:<port>` 只有在端口被显式发布到宿主机时才偶然可达；把它摆成可复制地址是在
 * 承诺一个多数情况下不存在的能力。真正的远端可达地址需要端口转发 / 网关侧代理，那是要过
 * 安全评审的独立交付，已明确不在本轮范围；面板只保留诚实的替代「复制隧道命令」（`ssh -L`）。
 */
function formatCopyAddress(port: number, sameMachine: boolean): string | null {
  if (sameMachine) return `localhost:${port}`;
  return null;
}

/**
 * 隧道按钮的 `title`：把本行会复制出的 `-L` 规格算出来给用户看（目标地址随绑定地址
 * 变化，不能在点击前猜），并带上容器拓扑的注意事项 —— 命令在容器部署里可能无效，
 * 必须在动手前讲清，而不是复制完才让人白试一次。
 */
function tunnelButtonTitle(port: ListeningPortView): string {
  const target = tunnelTargetHost(port.bindAddress);
  return (
    `复制 ssh -L ${port.port}:${target}:${port.port} 隧道命令：在网关所在机器建立隧道后，` +
    `用本机 localhost:${port.port} 访问。未配置 SSH 连接时复制占位模板（可在设置中添加）。` +
    `注意：网关运行在容器中时，宿主机的 ssh -L 目标由 SSH 服务端解析，容器内的监听需端口已发布到宿主机才可达。`
  );
}

/** 复制反馈命中判定：对勾只出现在刚被点击的那一行的对应按钮上（地址 / 隧道互不影响）。 */
function isCopyFeedbackFor(
  feedback: CopyFeedback | null,
  port: ListeningPortView,
  action: CopyFeedback['action'],
): boolean {
  return (
    feedback !== null &&
    feedback.ok &&
    feedback.action === action &&
    feedback.rowKey === portRowKey(port)
  );
}

/**
 * 筛选：先 trim、再统一小写；命中端口数字 / 进程名 / 绑定地址 / 协议任一即可。
 * 不做 debounce —— 这是纯内存过滤，输入即筛选才符合「输入框在过滤」的直觉；
 * 空查询等价于不过滤。
 */
function matchesFilter(port: ListeningPortView, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  return (
    String(port.port).includes(needle) ||
    (port.processName ?? '').toLowerCase().includes(needle) ||
    port.bindAddress.toLowerCase().includes(needle) ||
    port.protocol.toLowerCase().includes(needle)
  );
}

/** 快照年龄 → 文案；60s 以上退到分钟，避免「更新于 517 秒前」这种读不出的数字。 */
function formatAgeLabel(ageSeconds: number): string {
  if (ageSeconds < 2) return '刚刚更新';
  if (ageSeconds < 60) return `更新于 ${ageSeconds} 秒前`;
  return `更新于 ${Math.floor(ageSeconds / 60)} 分钟前`;
}

/**
 * 「更新于 N 秒前」。
 *
 * 独立成子组件：1s 一拍的重渲染只影响这一行文案，不会连累整张端口表的 diff。
 * `collectedAtMs` 每次刷新都会变，所以定时器随它重排 —— 年龄的基准始终是
 * **最近一次成功取数**，而不是最早的渲染时刻。
 */
function PortsFreshnessLabel({ collectedAtMs }: { collectedAtMs: number }): React.ReactNode {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), PORTS_AGE_TICK_MS);
    return () => clearInterval(timer);
  }, [collectedAtMs]);

  const ageSeconds = Math.max(0, Math.round((nowMs - collectedAtMs) / 1000));
  return (
    <span
      className="terminal-ports__age"
      data-testid="terminal-ports-age"
      title={new Date(collectedAtMs).toLocaleTimeString()}
    >
      {formatAgeLabel(ageSeconds)}
    </span>
  );
}

interface PortRowProps {
  port: ListeningPortView;
  sameMachine: boolean;
  /** 快照级归属能力：决定 `terminal === null` 是「外部进程」还是「归属不可用」（不得从 strategy 推断）。 */
  attributionSupported: boolean;
  /** 「复制地址」的完整地址；null = 远端等无可达地址的模式，不渲染该动作。 */
  copyAddress: string | null;
  /** 复制反馈命中的按钮；两者互斥，对勾只出现在被点击的那个上。 */
  addressCopied: boolean;
  tunnelCopied: boolean;
  onCopy: () => void;
  /** 复制 `ssh -L` 隧道命令；仅远端渲染该按钮（同机由直连链接覆盖）。 */
  onCopyTunnel: () => void;
  /** 打开终止确认条；仅当 `port.terminal !== null` 时父级会渲染终止按钮并接线。 */
  onRequestKill: () => void;
}

/**
 * 单行端口。宽容器是五列；窄容器（CSS 容器查询）里同一份 DOM 重排成三行 ——
 * 首行 端口|可达性标注|操作，次行 进程·pid + 绑定地址，末行 归属 chip + 连接状态 +
 * 「已退出」警示（280px 放不下的信息宁可单独占一行，也不横向溢出）。
 * 标记类名就是重排契约，布局全部由 `terminal-panel.css` 决定（jsdom 不评估容器查询，
 * 测试只锁类名/DOM）。
 */
function PortRow({
  port,
  sameMachine,
  attributionSupported,
  copyAddress,
  addressCopied,
  tunnelCopied,
  onCopy,
  onCopyTunnel,
  onRequestKill,
}: PortRowProps): React.ReactNode {
  const bind = describeBindAddress(port.bindAddress);
  const processLabel = formatProcess(port);
  const openHref = `http://localhost:${port.port}`;
  const openDisabled = openDisabledReason(port, bind.kind, sameMachine);
  const ownerChip = describeOwnerChip(port, attributionSupported);
  const connectionsLabel = formatConnectionsLabel(port);
  return (
    <tr className="terminal-ports__row" data-testid={`terminal-ports-row-${port.port}`}>
      <td className="terminal-ports__cell terminal-ports__cell--port">
        <span className="terminal-ports__port-number">{port.port}</span>
        <span className="terminal-ports__protocol">{port.protocol}</span>
      </td>
      <td
        className="terminal-ports__cell terminal-ports__col-process"
        title={formatProcessTitle(port, attributionSupported)}
      >
        {processLabel}
      </td>
      <td
        className="terminal-ports__cell terminal-ports__cell--status"
        title={portStatusTitle(port)}
      >
        <span
          className={`terminal-ports__owner-chip terminal-ports__owner-chip--${ownerChip.variant}`}
          data-testid={`terminal-ports-owner-${port.port}`}
          title={ownerChip.title}
        >
          {ownerChip.label}
        </span>
        {connectionsLabel === null ? null : (
          <span className="terminal-ports__connections">{connectionsLabel}</span>
        )}
        {port.processAlive === false ? (
          <span
            className="terminal-ports__exited"
            data-testid={`terminal-ports-exited-${port.port}`}
            title={PROCESS_EXITED_TITLE}
          >
            <AlertTriangleIcon size={11} />
            进程已退出
          </span>
        ) : null}
      </td>
      <td className="terminal-ports__cell terminal-ports__cell--bind">
        <span className="terminal-ports__bind-address" title={port.bindAddress}>
          {port.bindAddress}
        </span>
        <span className={`terminal-ports__bind-tag terminal-ports__bind-tag--${bind.kind}`}>
          {bind.label}
        </span>
      </td>
      <td className="terminal-ports__cell terminal-ports__cell--actions">
        {copyAddress === null ? null : (
          <button
            type="button"
            className="terminal-ports__action terminal-ports__action--copy"
            data-testid={`terminal-ports-copy-${port.port}`}
            data-copied={addressCopied ? 'true' : undefined}
            aria-label="复制地址"
            title={addressCopied ? '已复制' : `复制 ${copyAddress}`}
            onClick={onCopy}
          >
            {addressCopied ? <CheckIcon /> : <CopyIcon />}
          </button>
        )}
        {openDisabled === null ? (
          <a
            className="terminal-ports__action terminal-ports__action--open"
            href={openHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="在浏览器打开"
            title={`在浏览器打开 ${openHref}`}
          >
            <ExternalLinkIcon />
            <span className="terminal-ports__action-label">在浏览器打开</span>
          </a>
        ) : (
          <button
            type="button"
            className="terminal-ports__action terminal-ports__action--open"
            disabled
            aria-label="在浏览器打开"
            title={openDisabled}
          >
            <ExternalLinkIcon />
            <span className="terminal-ports__action-label">在浏览器打开</span>
          </button>
        )}
        {sameMachine ? null : (
          <button
            type="button"
            className="terminal-ports__action terminal-ports__action--tunnel"
            data-testid={`terminal-ports-tunnel-${port.port}`}
            data-copied={tunnelCopied ? 'true' : undefined}
            aria-label="复制隧道命令"
            title={tunnelCopied ? '已复制' : tunnelButtonTitle(port)}
            onClick={onCopyTunnel}
          >
            {tunnelCopied ? <CheckIcon /> : <LinkIcon />}
            <span className="terminal-ports__action-label">复制隧道命令</span>
          </button>
        )}
        {port.terminal !== null ? (
          <button
            type="button"
            className="terminal-ports__action terminal-ports__action--kill"
            data-testid={`terminal-ports-kill-${port.port}`}
            aria-label="终止该终端"
            title={`终止占用此端口的终端（会话 ${port.terminal.sessionId} · 终端 ${port.terminal.terminalId}）`}
            onClick={onRequestKill}
          >
            <SquareStopIcon />
            <span className="terminal-ports__action-label">终止该终端</span>
          </button>
        ) : null}
      </td>
    </tr>
  );
}

interface PortsToolbarProps {
  totalCount: number;
  filteredCount: number;
  hasQuery: boolean;
  collectedAtMs: number;
  reason: string | undefined;
  sameMachine: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  paused: boolean;
  onTogglePaused: () => void;
  onRefresh: () => void;
}

/**
 * 列表上方的单条工具条：计数 + 快照年龄 + 筛选 + 暂停 / 继续 + 刷新。
 *
 * 放在滚动容器**外**，滚动时始终可见（sticky 表头只负责列表内部）；`flex-wrap`
 * 让它在窄容器下自然折成两行，而不是横向溢出。远端 / 降级说明是单行 chip，
 * 窄容器下 ellipsis、`title` 保全文 —— 说明信息不能因为省空间而消失。
 */
function PortsToolbar({
  totalCount,
  filteredCount,
  hasQuery,
  collectedAtMs,
  reason,
  sameMachine,
  query,
  onQueryChange,
  paused,
  onTogglePaused,
  onRefresh,
}: PortsToolbarProps): React.ReactNode {
  return (
    <div className="terminal-ports__toolbar" data-testid="terminal-ports-toolbar">
      <div className="terminal-ports__toolbar-main">
        <span className="terminal-ports__count" data-testid="terminal-ports-count">
          {hasQuery ? `匹配 ${filteredCount} / ${totalCount} 个` : `共 ${totalCount} 个监听端口`}
        </span>
        <PortsFreshnessLabel collectedAtMs={collectedAtMs} />
        <div className="terminal-ports__filter">
          <SearchIcon size={12} />
          <input
            className="terminal-ports__filter-input"
            data-testid="terminal-ports-filter-input"
            // 面板级快捷键放行判据（TERMINAL_UI_INPUT_ATTR = data-terminal-ui-input）：
            // 缺了它，筛选框里的 Ctrl/⌘+Shift+5 会被面板当成「拆分 pane」劫走。
            {...{ [TERMINAL_UI_INPUT_ATTR]: '' }}
            type="text"
            value={query}
            placeholder="筛选端口 / 进程 / 地址"
            aria-label="筛选监听端口"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </div>
        <button
          type="button"
          className="terminal-ports__tool-btn"
          data-testid="terminal-ports-pause"
          aria-label={paused ? '继续自动刷新' : '暂停自动刷新'}
          title={paused ? '继续 5 秒自动刷新' : '暂停 5 秒自动刷新（筛选与手动刷新仍可用）'}
          onClick={onTogglePaused}
        >
          {paused ? <PlayIcon /> : <PauseIcon />}
          <span className="terminal-ports__tool-label">{paused ? '继续' : '暂停'}</span>
        </button>
        <button
          type="button"
          className="terminal-ports__tool-btn"
          data-testid="terminal-ports-refresh"
          aria-label="刷新"
          title="刷新（立即重新读取，不打断筛选）"
          onClick={onRefresh}
        >
          <RefreshIcon />
          <span className="terminal-ports__tool-label">刷新</span>
        </button>
      </div>
      {sameMachine ? null : (
        <p
          className="terminal-ports__chip"
          data-testid="terminal-ports-remote-notice"
          title="监听端口属于远端网关，在浏览器打开需要反向代理，当前未启用。容器内的监听不能从宿主机用 localhost:<端口> 直连，也不能用宿主机的 ssh -L 命中 —— ssh -L 的目标地址由 SSH 服务端（宿主机）解析，而不是容器网络命名空间；只有显式发布到宿主机的端口才可达。"
        >
          监听端口属于远端网关，在浏览器打开需要反向代理，当前未启用；容器内的监听在宿主机上
          localhost 与 ssh -L 均不可达。
        </p>
      )}
      {reason ? (
        <p
          className="terminal-ports__chip"
          data-testid="terminal-ports-degraded-note"
          title={`部分来源不可读：${reason}`}
        >
          部分来源不可读：{reason}
        </p>
      ) : null}
    </div>
  );
}

/** 过滤后无结果：与「确实没有监听端口」区分开 —— 数据还在，只是被筛掉了。 */
function PortsFilterEmpty({
  query,
  onClear,
}: {
  query: string;
  onClear: () => void;
}): React.ReactNode {
  return (
    <div
      className="terminal-ports__filter-empty"
      role="status"
      data-testid="terminal-ports-filter-empty"
    >
      <SearchIcon size={20} />
      <p className="terminal-ports__filter-empty-text">没有匹配「{query.trim()}」的端口</p>
      <button type="button" className="terminal-ports__btn" onClick={onClear}>
        清除筛选
      </button>
    </div>
  );
}

interface PortKillConfirmProps {
  port: ListeningPortView;
  terminal: ListeningPortTerminalRef;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 终止确认条（贴底内嵌，形态对齐 `TerminalPasteConfirm`）：终止是破坏性操作，
 * 不允许单击直接执行；Escape 取消、初始焦点落在确认按钮上（键盘可完成整条路径）。
 * 用 `alertdialog` 而不是全屏遮罩 —— 端口列表要保持可见，用户才能核对自己在终止什么。
 */
function PortKillConfirm({
  port,
  terminal,
  pending,
  onConfirm,
  onCancel,
}: PortKillConfirmProps): React.ReactNode {
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  return (
    <div
      role="alertdialog"
      aria-label="确认终止终端"
      aria-modal="true"
      data-testid="terminal-ports-kill-confirm"
      className="terminal-ports__kill-confirm"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <div className="terminal-ports__kill-confirm-head">
        <span className="terminal-ports__kill-confirm-icon" aria-hidden="true">
          <AlertTriangleIcon size={16} />
        </span>
        <span>
          终止终端 {terminal.terminalId}（会话 {terminal.sessionId}）？
        </span>
      </div>
      <p className="terminal-ports__kill-confirm-desc">
        端口 {port.port} 由该终端占用，终止后这个监听会消失；终端里未保存的工作可能丢失。
      </p>
      <div className="terminal-ports__kill-confirm-foot">
        <button
          type="button"
          className="terminal-ports__btn"
          data-testid="terminal-ports-kill-confirm-cancel"
          onClick={onCancel}
        >
          取消
        </button>
        <button
          ref={confirmRef}
          type="button"
          className="terminal-ports__btn terminal-ports__btn--danger"
          data-testid="terminal-ports-kill-confirm-accept"
          disabled={pending}
          onClick={onConfirm}
        >
          {pending ? '终止中…' : '确认终止'}
        </button>
      </div>
    </div>
  );
}

export function TerminalPortsPanel({ gatewayUrl, token }: TerminalPortsPanelProps) {
  const { state, retry, refresh, paused, togglePaused } = useTerminalPortsFeed(gatewayUrl, token);
  const [query, setQuery] = useState('');
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback | null>(null);
  const [killTarget, setKillTarget] = useState<ListeningPortView | null>(null);
  const [killPending, setKillPending] = useState(false);
  const [killNotice, setKillNotice] = useState<{ ok: boolean; message: string } | null>(null);

  // 这个判定要进 effect 依赖（决定是否取 SSH 连接列表），在提前 return 之前算好。
  const sameMachine = isSameMachineGateway(gatewayUrl);

  // 复制反馈是瞬态提示：2s 后自行消失（对勾 + 读屏播报一起复位）。hook 必须在
  // 下面的提前 return（loading / error / empty）之前无条件执行。
  useEffect(() => {
    if (copyFeedback === null) return;
    const timer = window.setTimeout(() => setCopyFeedback(null), COPY_FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [copyFeedback]);

  // 终止成功提示同样自动消失；失败提示保留到下一次操作 —— 失败原因需要用户看到。
  useEffect(() => {
    if (killNotice?.ok !== true) return;
    const timer = window.setTimeout(() => setKillNotice(null), KILL_SUCCESS_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [killNotice]);

  // 「复制隧道命令」要用的 SSH 连接列表：只在远端网关取一次 —— 同机没有这个动作，
  // 取数是纯浪费。结果存 ref 而不是 state：它只影响点击时生成的命令串，不参与渲染，
  // 端口列表从不被它阻塞（点击发生在列表返回前就退化为占位模板）；读取失败与
  // 「没配置连接」同等对待，静默降级，不在这里弹错误 —— 这是可选辅助能力，
  // 不能让端口列表看起来坏了。
  const sshConnectionsRef = useRef<SSHConnectionEntry[] | null>(null);

  useEffect(() => {
    if (sameMachine || token === null) {
      sshConnectionsRef.current = null;
      return;
    }
    const controller = new AbortController();
    void createSshClient(gatewayUrl)
      .list(token, { signal: controller.signal })
      .then((connections) => {
        sshConnectionsRef.current = connections;
      })
      .catch(() => {
        sshConnectionsRef.current = null;
      });
    return () => {
      sshConnectionsRef.current = null;
      controller.abort();
    };
  }, [gatewayUrl, sameMachine, token]);

  if (state.status === 'loading') {
    return (
      <div className="terminal-ports" data-testid="terminal-ports-panel">
        <div className="terminal-ports__status" role="status" data-testid="terminal-ports-loading">
          <span className="terminal-ports__spinner" aria-hidden="true" />
          正在读取监听端口…
        </div>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="terminal-ports" data-testid="terminal-ports-panel">
        <div className="terminal-ports__status" role="alert" data-testid="terminal-ports-error">
          <p className="terminal-ports__error">{state.message}</p>
          <button type="button" className="terminal-ports__btn" onClick={retry}>
            重试
          </button>
        </div>
      </div>
    );
  }

  const { snapshot } = state;
  const ports = sortPorts(snapshot.ports);

  if (snapshot.strategy === null || ports.length === 0) {
    const unsupported = snapshot.strategy === null;
    return (
      <div className="terminal-ports" data-testid="terminal-ports-panel">
        <div className="terminal-ports-empty" data-testid="terminal-ports-empty">
          <div className="terminal-ports-empty__card">
            <span className="terminal-ports-empty__icon" aria-hidden="true">
              <PlugIcon size={24} />
            </span>
            <h4 className="terminal-ports-empty__title">
              {unsupported ? '当前运行时不支持端口枚举' : '未发现监听端口'}
            </h4>
            <p className="terminal-ports-empty__desc">
              {unsupported
                ? (snapshot.reason ?? '当前环境无法枚举监听端口。')
                : '网关所在环境当前没有监听中的 TCP 端口。'}
            </p>
            {!unsupported && snapshot.reason ? (
              <p className="terminal-ports__note">{snapshot.reason}</p>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  const hasQuery = query.trim().length > 0;
  const visiblePorts = hasQuery ? ports.filter((port) => matchesFilter(port, query)) : ports;

  const handleCopy = (port: ListeningPortView): void => {
    const address = formatCopyAddress(port.port, sameMachine);
    // 远端没有可达地址（formatCopyAddress → null），复制按钮本就不渲染；
    // 这里是防御性兜底，保证任何路径都不会把不可达地址写进剪贴板。
    if (address === null) return;
    void writeClipboardText(address).then(
      () =>
        setCopyFeedback({
          rowKey: portRowKey(port),
          action: 'address',
          ok: true,
          message: `已复制 ${address}`,
        }),
      (error: unknown) =>
        setCopyFeedback({
          rowKey: portRowKey(port),
          action: 'address',
          ok: false,
          message: `复制失败：${error instanceof Error ? error.message : String(error)}`,
        }),
    );
  };

  const handleCopyTunnel = (port: ListeningPortView): void => {
    // 不等待 SSH 请求：列表未归 / 读取失败时 ref 是 null，直接生成占位模板 ——
    // 复制动作永远即时，用户从播报里就能分清拿到的是真命令还是模板。
    const result = buildSshTunnelCommand({
      port: port.port,
      bindAddress: port.bindAddress,
      ssh: pickSshConnection(sshConnectionsRef.current ?? []),
    });
    void writeClipboardText(result.command).then(
      () =>
        setCopyFeedback({
          rowKey: portRowKey(port),
          action: 'tunnel',
          ok: true,
          message:
            result.form === 'ready' ? `已复制隧道命令（${result.summary}）` : '已复制隧道命令模板',
        }),
      (error: unknown) =>
        setCopyFeedback({
          rowKey: portRowKey(port),
          action: 'tunnel',
          ok: false,
          message: `复制失败：${error instanceof Error ? error.message : String(error)}`,
        }),
    );
  };

  const requestKill = (port: ListeningPortView): void => {
    // 未归属行不渲染终止按钮；这里是防御性兜底，保证任何路径都不会走到「猜一个 pid」。
    if (port.terminal === null) return;
    setKillNotice(null);
    setKillTarget(port);
  };

  const confirmKill = (): void => {
    const terminal = killTarget?.terminal ?? null;
    if (killTarget === null || terminal === null || token === null || killPending) return;
    setKillPending(true);
    // 只发 { sessionId, terminalId }：终止路径唯一，且由既有路由做用户 / 会话双重校验。
    void killSessionTerminal({
      gatewayUrl,
      token,
      sessionId: terminal.sessionId,
      terminalId: terminal.terminalId,
    }).then(
      () => {
        setKillPending(false);
        setKillTarget(null);
        setKillNotice({ ok: true, message: '已终止终端，正在刷新端口列表' });
        // 静默刷新：复用 feed 的 refresh()（不闪回 loading），被终止的监听随之消失。
        refresh();
      },
      (error: unknown) => {
        setKillPending(false);
        setKillNotice({
          ok: false,
          message: `终止终端失败：${error instanceof Error ? error.message : String(error)}`,
        });
      },
    );
  };

  const killTerminalRef = killTarget?.terminal ?? null;

  return (
    <div className="terminal-ports" data-testid="terminal-ports-panel">
      <PortsToolbar
        totalCount={ports.length}
        filteredCount={visiblePorts.length}
        hasQuery={hasQuery}
        collectedAtMs={snapshot.collectedAtMs}
        reason={snapshot.reason}
        sameMachine={sameMachine}
        query={query}
        onQueryChange={setQuery}
        paused={paused}
        onTogglePaused={togglePaused}
        onRefresh={refresh}
      />
      {killNotice ? (
        <p
          className={`terminal-ports__notice terminal-ports__notice--${killNotice.ok ? 'ok' : 'error'}`}
          role={killNotice.ok ? 'status' : 'alert'}
          data-testid="terminal-ports-kill-notice"
        >
          {killNotice.message}
        </p>
      ) : null}
      <div className="terminal-ports__scroll">
        {visiblePorts.length === 0 ? (
          <PortsFilterEmpty query={query} onClear={() => setQuery('')} />
        ) : (
          <table className="terminal-ports__table" data-testid="terminal-ports-table">
            <caption className="terminal-ports__sr-only">监听端口列表（按端口升序）</caption>
            <thead>
              <tr>
                <th scope="col" className="terminal-ports__th--port">
                  端口
                </th>
                <th scope="col" className="terminal-ports__th--process">
                  进程
                </th>
                <th scope="col" className="terminal-ports__th--status">
                  状态
                </th>
                <th scope="col" className="terminal-ports__th--bind">
                  绑定地址
                </th>
                <th scope="col" className="terminal-ports__cell--actions">
                  <span className="terminal-ports__sr-only">操作</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visiblePorts.map((port) => (
                <PortRow
                  key={portRowKey(port)}
                  port={port}
                  sameMachine={sameMachine}
                  attributionSupported={snapshot.attributionSupported}
                  copyAddress={formatCopyAddress(port.port, sameMachine)}
                  addressCopied={isCopyFeedbackFor(copyFeedback, port, 'address')}
                  tunnelCopied={isCopyFeedbackFor(copyFeedback, port, 'tunnel')}
                  onCopy={() => handleCopy(port)}
                  onCopyTunnel={() => handleCopyTunnel(port)}
                  onRequestKill={() => requestKill(port)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
      {killTarget !== null && killTerminalRef !== null ? (
        <PortKillConfirm
          port={killTarget}
          terminal={killTerminalRef}
          pending={killPending}
          onConfirm={confirmKill}
          onCancel={() => setKillTarget(null)}
        />
      ) : null}
      <span
        className="terminal-ports__sr-only"
        role="status"
        data-testid="terminal-ports-copy-status"
      >
        {copyFeedback?.message ?? ''}
      </span>
    </div>
  );
}
