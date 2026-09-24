/**
 * 内置浏览器的控制台面板。
 *
 * 职责：按级别/关键字过滤日志、渲染每一条（含网络请求的请求/响应详情）、
 * 以及把条目复制到剪贴板或引用进聊天输入框。
 *
 * 数据由宿主（`BuiltInBrowser`）收集后传入——iframe 注入脚本的 postMessage 与
 * 网关侧实时引擎（`/browser-live`）两条来源共用同一套 `ConsoleEntry` 模型；
 * 本面板不订阅任何来源，便于单独测试。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConsoleEntry, ConsoleLevel, NetworkExchange } from './browser-console-types.js';
import {
  buildCurlCommand,
  formatEntryText,
  formatNetworkRequestText,
  formatNetworkResponseText,
} from './browser-console-format.js';
import { copyTextToClipboard, quoteEntryIntoComposer } from './browser-clipboard.js';
import { buildConsoleStackView } from './browser-console-stack.js';
import { ConsoleStackSection } from './browser-console-stack-view.js';
import { BrowserPill } from './browser-pill.js';
import { NetworkWaterfall } from './NetworkWaterfall.js';
import type { NetworkCaptureStatus } from './NetworkWaterfall.js';
import { BrowserInspectorPanel } from './BrowserInspectorPanel.js';
import type { BrowserInspectorPanelProps } from './BrowserInspectorPanel.js';

const LEVEL_COLORS: Record<ConsoleLevel, string> = {
  log: 'var(--fg-default)',
  info: 'var(--accent)',
  warn: 'var(--warning)',
  error: 'var(--danger)',
  debug: 'var(--chart-5)',
  network: 'var(--aux)',
};

const LEVEL_BG: Record<ConsoleLevel, string> = {
  log: 'transparent',
  info: 'transparent',
  warn: 'color-mix(in oklch, var(--warning) 6%, transparent)',
  error: 'color-mix(in oklch, var(--danger) 6%, transparent)',
  debug: 'transparent',
  network: 'color-mix(in oklch, var(--aux) 4%, transparent)',
};

const LEVEL_ICONS: Record<ConsoleLevel, string> = {
  log: '›',
  info: 'ℹ️',
  warn: '⚠️',
  error: '❌',
  debug: '›',
  network: '🌐',
};

const FEEDBACK_CLEAR_MS = 1_600;

export function BrowserConsolePanel({
  logs,
  endRef,
  onClear,
  onClose,
  tauriMode,
  liveAvailable,
  pageUrl,
  pageTitle,
  networkCaptureStatus,
  inspector,
}: {
  logs: ConsoleEntry[];
  /** 列表底部的自动滚动锚点；缺省时列表不跟随新日志。 */
  endRef?: React.RefObject<HTMLDivElement | null>;
  /** 清空回调；缺省时「清空」按钮禁用（harness / 预览场景只读展示）。 */
  onClear?: () => void;
  /** 关闭回调；缺省时不渲染关闭按钮（嵌入型宿主自行控制显隐）。 */
  onClose?: () => void;
  tauriMode?: boolean;
  /**
   * 网关侧实时引擎（`/browser-live`）是否可用。CDP 采集不受同源策略限制，
   * 可用时不能再说"跨域页面无法注入"。
   */
  liveAvailable?: boolean;
  /** 当前页面 URL：瀑布视图导出 HAR 的上下文。 */
  pageUrl?: string | null;
  /** 当前页面标题：瀑布视图导出 HAR 的上下文。 */
  pageTitle?: string | null;
  /** 网络采集状态；缺省视为正常采集（由宿主按实时引擎状态传入）。 */
  networkCaptureStatus?: NetworkCaptureStatus;
  /**
   * 元素检查器视图的注入边界：宿主透传信封与回调，本面板只负责在视图切换时挂载。
   * 缺省时不渲染「元素」pill —— 未接线的宿主（含既有测试）行为完全不变。
   */
  inspector?: BrowserInspectorPanelProps | null;
}) {
  const [filter, setFilter] = useState<ConsoleLevel | 'all'>('all');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'list' | 'waterfall' | 'inspect'>('list');

  const keyword = query.trim().toLowerCase();
  const filteredLogs = logs.filter((entry) => {
    if (filter !== 'all' && entry.level !== filter) return false;
    if (keyword.length === 0) return true;
    // 网络条目的 URL / 请求体 / 响应体也要能搜到，否则"搜接口名"没结果。
    const haystacks = [entry.message, entry.network?.url, entry.network?.responseBody];
    return haystacks.some(
      (value) => typeof value === 'string' && value.toLowerCase().includes(keyword),
    );
  });
  const errorCount = logs.filter((l) => l.level === 'error').length;
  const warnCount = logs.filter((l) => l.level === 'warn').length;

  return (
    <div
      data-testid="browser-console-panel"
      style={{
        flexShrink: 0,
        // 检查器要读树与样式表，沿用控制台的 280px 高度会把两侧内容都压成一条缝。
        height:
          view === 'inspect' && inspector
            ? 'clamp(260px, 56vh, 560px)'
            : 'clamp(140px, 32vh, 280px)',
        display: 'flex',
        flexDirection: 'column',
        borderTop: '1px solid var(--border-default)',
        background: 'var(--bg-base)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 8px',
          borderBottom: '1px solid var(--border-subtle)',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-default)', marginRight: 4 }}>
          控制台
        </span>
        {tauriMode === true && liveAvailable === true ? (
          <span
            data-testid="console-capture-badge"
            title="Tauri 原生窗口无法直接注入页面：控制台与网络由网关侧实时引擎在独立页面中采集，窗口内的点击等交互不会同步到采集页面。"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              height: 16,
              padding: '0 5px',
              borderRadius: 8,
              border: '1px solid color-mix(in oklch, var(--aux) 40%, transparent)',
              background: 'color-mix(in oklch, var(--aux) 10%, transparent)',
              color: 'var(--aux)',
              fontSize: 9,
              flexShrink: 0,
            }}
          >
            网关采集
          </span>
        ) : null}

        <BrowserPill
          label="列表"
          title="列表视图：按级别展示控制台日志"
          active={view === 'list'}
          onClick={() => setView('list')}
          size="sm"
        />
        <BrowserPill
          label="瀑布"
          title="瀑布视图：按时间轴展示网络请求，可导出 HAR"
          active={view === 'waterfall'}
          onClick={() => setView('waterfall')}
          size="sm"
        />
        {inspector ? (
          <BrowserPill
            label="元素"
            title="元素检查器：DOM 树 / 无障碍树与计算样式"
            active={view === 'inspect'}
            onClick={() => setView('inspect')}
            testId="browser-console-view-inspect"
            size="sm"
          />
        ) : null}

        {view === 'list' ? (
          <>
            <FilterPill
              label="全部"
              count={logs.length}
              active={filter === 'all'}
              onClick={() => setFilter('all')}
            />
            <FilterPill
              label="错误"
              count={errorCount}
              active={filter === 'error'}
              onClick={() => setFilter('error')}
              color="var(--danger)"
            />
            <FilterPill
              label="警告"
              count={warnCount}
              active={filter === 'warn'}
              onClick={() => setFilter('warn')}
              color="var(--warning)"
            />
            <FilterPill
              label="日志"
              count={logs.filter((l) => l.level === 'log').length}
              active={filter === 'log'}
              onClick={() => setFilter('log')}
            />
            <FilterPill
              label="网络"
              count={logs.filter((l) => l.level === 'network').length}
              active={filter === 'network'}
              onClick={() => setFilter('network')}
              color="var(--aux)"
            />
          </>
        ) : null}

        <div style={{ flex: 1 }} />

        {view === 'list' ? (
          <>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索日志 / 接口…"
              aria-label="搜索控制台日志"
              style={{
                width: 140,
                height: 20,
                padding: '0 6px',
                borderRadius: 4,
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-overlay)',
                color: 'var(--fg-default)',
                fontSize: 9.5,
              }}
            />
            <button
              type="button"
              onClick={() => downloadConsoleLogs(filteredLogs)}
              disabled={filteredLogs.length === 0}
              title="导出当前可见日志为 .log 文件"
              style={{
                height: 20,
                padding: '0 6px',
                borderRadius: 4,
                border: '1px solid var(--border-subtle)',
                background: 'transparent',
                color: 'var(--fg-muted)',
                fontSize: 9,
                cursor: filteredLogs.length === 0 ? 'not-allowed' : 'pointer',
                opacity: filteredLogs.length === 0 ? 0.5 : 1,
              }}
            >
              导出（{filteredLogs.length}）
            </button>
          </>
        ) : null}
        <button
          type="button"
          onClick={onClear}
          disabled={onClear === undefined}
          title="清空控制台"
          style={{
            height: 20,
            padding: '0 6px',
            borderRadius: 4,
            border: '1px solid var(--border-subtle)',
            background: 'transparent',
            color: 'var(--fg-muted)',
            fontSize: 9,
            cursor: onClear === undefined ? 'not-allowed' : 'pointer',
            opacity: onClear === undefined ? 0.5 : 1,
          }}
        >
          清空
        </button>
        {onClose !== undefined ? (
          <button
            type="button"
            onClick={onClose}
            title="关闭控制台"
            style={{
              width: 20,
              height: 20,
              borderRadius: 4,
              border: 'none',
              background: 'transparent',
              color: 'var(--fg-muted)',
              fontSize: 11,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ✕
          </button>
        ) : null}
      </div>

      {view === 'inspect' && inspector ? (
        <BrowserInspectorPanel {...inspector} />
      ) : view === 'waterfall' ? (
        <NetworkWaterfall
          entries={logs}
          context={{ url: pageUrl ?? null, title: pageTitle ?? null }}
          captureStatus={networkCaptureStatus}
        />
      ) : (
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: '2px 0',
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: 11,
            lineHeight: 1.5,
          }}
        >
          {filteredLogs.length === 0 ? (
            <div
              style={{
                padding: '16px',
                textAlign: 'center',
                color: 'var(--text-4)',
                fontSize: 11,
                lineHeight: 1.6,
              }}
            >
              <ConsoleEmptyState
                tauriMode={tauriMode === true}
                liveAvailable={liveAvailable === true}
                hasAnyLogs={logs.length > 0}
              />
            </div>
          ) : (
            filteredLogs.map((entry) => <ConsoleEntryRow key={entry.id} entry={entry} />)
          )}
          <div ref={endRef} />
        </div>
      )}
    </div>
  );
}

/**
 * 列表视图空态文案。
 *
 * 判定顺序：过滤无匹配 > 实时引擎采集 > Tauri 原生窗口 > iframe 跨域提示。
 * 「有日志但被过滤掉」必须优先于引擎说明——否则用户会误以为采集坏了；
 * 实时引擎可用时（Web 与 Tauri 共用同一条采集通道）也不该再声称无法采集。
 */
function ConsoleEmptyState({
  tauriMode,
  liveAvailable,
  hasAnyLogs,
}: {
  tauriMode: boolean;
  liveAvailable: boolean;
  hasAnyLogs: boolean;
}) {
  if (hasAnyLogs) {
    return '当前过滤条件下无匹配';
  }
  if (liveAvailable) {
    return '暂无控制台输出 · 日志由网关侧实时引擎采集,页面产生日志后会自动显示';
  }
  if (tauriMode) {
    return (
      <>
        Tauri 原生窗口本身无法注入采集,控制台与网络需依赖网关侧实时引擎
        <br />
        <span style={{ opacity: 0.7 }}>
          当前实时引擎不可用:请按上方提示处理,或改用浏览器(Web)模式查看
        </span>
      </>
    );
  }
  return '暂无控制台输出 · 跨域页面(非 localhost)无法注入,只能展示同源页面的日志';
}

/**
 * 单条记录。网络条目可展开查看请求/响应全文，并提供分块复制。
 *
 * 复制/引用按钮没有做 hover 隐藏：jsdom 里没有 hover 语义，常驻渲染既方便
 * 测试，也避免用户第一次用的时候找不到入口（用低透明度保持视觉克制）。
 */
function ConsoleEntryRow({ entry }: { entry: ConsoleEntry }) {
  const [expanded, setExpanded] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (feedbackTimerRef.current !== null) {
        window.clearTimeout(feedbackTimerRef.current);
      }
    },
    [],
  );

  const flashFeedback = useCallback((message: string) => {
    setFeedback(message);
    if (feedbackTimerRef.current !== null) {
      window.clearTimeout(feedbackTimerRef.current);
    }
    feedbackTimerRef.current = window.setTimeout(() => {
      feedbackTimerRef.current = null;
      setFeedback(null);
    }, FEEDBACK_CLEAR_MS);
  }, []);

  const runCopy = useCallback(
    (text: string) => {
      void copyTextToClipboard(text).then((ok) => flashFeedback(ok ? '已复制' : '复制失败'));
    },
    [flashFeedback],
  );

  const network: NetworkExchange | undefined = entry.network;
  const isNetwork = entry.level === 'network' && network !== undefined;
  const stackView = buildConsoleStackView(entry);

  return (
    <div
      data-testid="console-entry"
      style={{
        borderBottom: '1px solid color-mix(in oklch, var(--border-subtle) 50%, transparent)',
        background: LEVEL_BG[entry.level],
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 6,
          padding: '2px 8px',
          minHeight: 20,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            fontSize: 9,
            fontWeight: 600,
            color: LEVEL_COLORS[entry.level],
            width: 18,
            flexShrink: 0,
            paddingTop: 2,
          }}
        >
          {LEVEL_ICONS[entry.level]}
        </span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            color: LEVEL_COLORS[entry.level],
            wordBreak: 'break-word',
            whiteSpace: 'pre-wrap',
          }}
        >
          {entry.message}
        </span>
        {feedback ? (
          <span
            role="status"
            style={{ fontSize: 9, color: 'var(--success)', flexShrink: 0, paddingTop: 3 }}
          >
            {feedback}
          </span>
        ) : null}
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            flexShrink: 0,
            opacity: 0.6,
          }}
        >
          {isNetwork ? (
            <>
              <EntryAction
                label="复制请求"
                onClick={() => runCopy(formatNetworkRequestText(network))}
              />
              <EntryAction
                label="复制响应"
                onClick={() => runCopy(formatNetworkResponseText(network))}
              />
              <EntryAction label="复制为 cURL" onClick={() => runCopy(buildCurlCommand(network))} />
              <EntryAction
                label={expanded ? '收起详情' : '查看详情'}
                onClick={() => setExpanded((prev) => !prev)}
              />
            </>
          ) : null}
          <EntryAction label="复制" onClick={() => runCopy(formatEntryText(entry))} />
          <EntryAction
            label="引用到输入框"
            onClick={() => {
              quoteEntryIntoComposer(entry);
              flashFeedback('已引用');
            }}
          />
        </span>
        <span
          style={{
            fontSize: 9,
            color: 'var(--text-4)',
            flexShrink: 0,
            paddingTop: 2,
          }}
        >
          {formatTime(entry.timestamp)}
        </span>
      </div>
      {isNetwork && expanded ? (
        <div
          style={{ padding: '0 8px 6px 32px', display: 'flex', flexDirection: 'column', gap: 4 }}
        >
          <NetworkBlock
            title="请求"
            text={formatNetworkRequestText(network)}
            onCopy={() => runCopy(formatNetworkRequestText(network))}
          />
          <NetworkBlock
            title="响应"
            text={formatNetworkResponseText(network)}
            onCopy={() => runCopy(formatNetworkResponseText(network))}
          />
        </div>
      ) : null}
      {stackView !== null ? <ConsoleStackSection view={stackView} onCopyFrame={runCopy} /> : null}
    </div>
  );
}

function NetworkBlock({
  title,
  text,
  onCopy,
}: {
  title: string;
  text: string;
  onCopy: () => void;
}) {
  return (
    <div
      style={{
        border: '1px solid var(--border-subtle)',
        borderRadius: 4,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '2px 6px',
          background: 'var(--bg-overlay)',
          fontSize: 9,
          color: 'var(--fg-muted)',
        }}
      >
        <span>{title}</span>
        <button
          type="button"
          onClick={onCopy}
          style={{
            fontSize: 9,
            border: '1px solid var(--border-subtle)',
            background: 'transparent',
            color: 'var(--fg-default)',
            padding: '0 5px',
            borderRadius: 3,
            cursor: 'pointer',
          }}
        >
          复制{title}全文
        </button>
      </div>
      <pre
        style={{
          margin: 0,
          padding: '5px 6px',
          maxHeight: 140,
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontSize: 10.5,
          color: 'var(--fg-default)',
        }}
      >
        {text}
      </pre>
    </div>
  );
}

function EntryAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontSize: 9,
        lineHeight: 1.4,
        border: '1px solid var(--border-subtle)',
        background: 'var(--bg-overlay)',
        color: 'var(--fg-default)',
        padding: '0 5px',
        borderRadius: 3,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}

function FilterPill({
  label,
  count,
  active,
  onClick,
  color,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  color?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: 18,
        padding: '0 5px',
        borderRadius: 9,
        border: active ? `1px solid ${color || 'var(--accent)'}` : '1px solid var(--border-subtle)',
        background: active
          ? `color-mix(in oklch, ${color || 'var(--accent)'} 12%, transparent)`
          : 'transparent',
        color: active ? color || 'var(--accent)' : 'var(--fg-muted)',
        fontSize: 9,
        fontWeight: 500,
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
      }}
    >
      {label}
      {count > 0 && <span style={{ fontWeight: 700 }}>{count}</span>}
    </button>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}

/**
 * 把当前可见的条目导出成 .log 文件。网络条目会带上请求/响应全文（含
 * cURL 之外的原始头部与 body），方便直接贴到 issue 里让别人复现。
 */
function downloadConsoleLogs(logs: ConsoleEntry[]): void {
  if (logs.length === 0) return;
  const text = logs.map((entry) => formatEntryText(entry)).join('\n\n');
  try {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = `openawork-console-${Date.now()}.log`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  } catch {
    // 沙箱 / 无 document 环境：静默放弃，不打断控制台使用
  }
}
