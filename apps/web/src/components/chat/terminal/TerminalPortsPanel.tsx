/**
 * TerminalPortsPanel — 「端口」页签的只读内容（T-15，方案 C：只读列表 + 同机直接打开）。
 *
 * 数据来自网关 `GET /sessions/ports/listening`（T-14 客户端 `createListeningPortsClient`）；
 * 只读展示监听端口，**不做**端口转发 / 代理 —— 所以远端网关时没有可达路径，
 * 「在浏览器打开」显式禁用并说明原因，而不是给一个点了必然失败的按钮。
 *
 * 取数策略（T-13，TASK 2）：见 `use-terminal-ports-feed.ts` —— 挂载取数 + 可见时 5s
 * 轮询；页签不可见由调用方卸载达成，浏览器标签页不可见由 `visibilitychange` 暂停。
 *
 * 同机判定（与 `utils/gateway/desktop-gateway.ts` 同源，口径对齐 `canOpenPathInSystem`）：
 *  - 网关 host 是回环（127.0.0.1 / localhost / ::1）→ 同机；
 *  - 桌面端（Tauri 标志）默认 sidecar 同机，但显式切到「远端网关」模式时不算同机。
 * 同机时用 `http://localhost:<port>` 打开：网关与本机浏览器同名，回环端口直接可达。
 */

import { useEffect, useState } from 'react';
import type {
  ListeningPortView,
  ListeningPortsSnapshotView,
} from '@openAwork/web-client';
import {
  isLocalGatewayUrl,
  isTauriRuntime,
  readDesktopGatewayMode,
} from '../../../utils/gateway/desktop-gateway.js';
import { PlugIcon } from './TerminalIcons.js';
import { PORTS_AGE_TICK_MS, useTerminalPortsFeed } from './use-terminal-ports-feed.js';
import './terminal-panel.css';

export interface TerminalPortsPanelProps {
  gatewayUrl: string;
  token: string | null;
}

interface BindAddressDescriptor {
  kind: 'loopback' | 'wildcard' | 'specific';
  label: string;
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

/** 绑定地址 → 「仅本机 / 全网可达」标注；其余地址如实标注为指定地址。 */
function describeBindAddress(bindAddress: string): BindAddressDescriptor {
  const normalized = bindAddress.trim().toLowerCase();
  // 双栈 socket 常以 IPv4-mapped 形式出现（`::ffff:127.0.0.1`），按 IPv4 语义标注。
  const ipv4 = normalized.startsWith('::ffff:') ? normalized.slice('::ffff:'.length) : normalized;
  // 127.0.0.0/8 整段都是回环（不只 127.0.0.1）。
  if (ipv4 === '::1' || ipv4 === 'localhost' || ipv4.startsWith('127.')) {
    return { kind: 'loopback', label: '仅本机' };
  }
  if (ipv4 === '::' || ipv4 === '0.0.0.0') {
    return { kind: 'wildcard', label: '全网可达' };
  }
  return { kind: 'specific', label: '指定地址' };
}

/** 进程列：`processName + pid` 的组合；两者都缺时用 `—` 兜底（best-effort 字段，不是错误）。 */
function formatProcess(port: ListeningPortView): string {
  const name = port.processName?.trim() ?? '';
  if (name.length > 0 && port.pid !== null) return `${name} · pid ${port.pid}`;
  if (name.length > 0) return name;
  if (port.pid !== null) return `pid ${port.pid}`;
  return '—';
}

function sortPorts(ports: readonly ListeningPortView[]): ListeningPortView[] {
  return [...ports].sort(
    (left, right) =>
      left.port - right.port || left.protocol.localeCompare(right.protocol) ||
      left.bindAddress.localeCompare(right.bindAddress),
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

function PortRow({ port, sameMachine }: { port: ListeningPortView; sameMachine: boolean }): React.ReactNode {
  const bind = describeBindAddress(port.bindAddress);
  const processLabel = formatProcess(port);
  return (
    <tr className="terminal-ports__row" data-testid={`terminal-ports-row-${port.port}`}>
      <td className="terminal-ports__cell terminal-ports__cell--port">
        <span className="terminal-ports__port-number">{port.port}</span>
        <span className="terminal-ports__protocol">{port.protocol}</span>
      </td>
      <td className="terminal-ports__cell terminal-ports__col-process" title={processLabel}>
        {processLabel}
      </td>
      <td className="terminal-ports__cell">
        <span className="terminal-ports__bind-address">{port.bindAddress}</span>
        <span className={`terminal-ports__bind-tag terminal-ports__bind-tag--${bind.kind}`}>
          {bind.label}
        </span>
      </td>
      <td className="terminal-ports__cell terminal-ports__cell--actions">
        {sameMachine ? (
          <a
            className="terminal-ports__open"
            href={`http://localhost:${port.port}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            在浏览器打开
          </a>
        ) : (
          <button
            type="button"
            className="terminal-ports__open"
            disabled
            title="需要反向代理，当前未启用"
          >
            在浏览器打开
          </button>
        )}
      </td>
    </tr>
  );
}

export function TerminalPortsPanel({ gatewayUrl, token }: TerminalPortsPanelProps) {
  const { state, retry } = useTerminalPortsFeed(gatewayUrl, token);

  const sameMachine = isSameMachineGateway(gatewayUrl);

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
          <button type="button" className="terminal-ports__retry" onClick={retry}>
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

  return (
    <div className="terminal-ports" data-testid="terminal-ports-panel">
      <div className="terminal-ports__scroll">
        <div className="terminal-ports__meta">
          <span className="terminal-ports__count">共 {ports.length} 个监听端口</span>
          <PortsFreshnessLabel collectedAtMs={snapshot.collectedAtMs} />
          {snapshot.reason ? (
            <span className="terminal-ports__note">部分来源不可读：{snapshot.reason}</span>
          ) : null}
        </div>
        {sameMachine ? null : (
          <p className="terminal-ports__notice" data-testid="terminal-ports-remote-notice">
            监听端口属于远端网关，在浏览器打开需要反向代理，当前未启用。
          </p>
        )}
        <table className="terminal-ports__table" data-testid="terminal-ports-table">
          <caption className="terminal-ports__sr-only">监听端口列表（按端口升序）</caption>
          <thead>
            <tr>
              <th scope="col">端口</th>
              <th scope="col" className="terminal-ports__col-process">
                进程
              </th>
              <th scope="col">绑定地址</th>
              <th scope="col" className="terminal-ports__cell--actions">
                <span className="terminal-ports__sr-only">操作</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {ports.map((port) => (
              <PortRow
                key={`${port.port}-${port.protocol}-${port.bindAddress}`}
                port={port}
                sameMachine={sameMachine}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
