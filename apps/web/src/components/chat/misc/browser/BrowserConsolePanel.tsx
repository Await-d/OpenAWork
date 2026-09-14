/**
 * 内置浏览器的控制台面板。
 *
 * 职责：按级别/关键字过滤日志、渲染每一条（含网络请求的请求/响应详情）、
 * 以及把条目复制到剪贴板或引用进聊天输入框。
 *
 * 数据由宿主（`BuiltInBrowser`）从注入脚本的 postMessage 收集后传入；
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
}: {
  logs: ConsoleEntry[];
  endRef: React.RefObject<HTMLDivElement | null>;
  onClear: () => void;
  onClose: () => void;
  tauriMode?: boolean;
}) {
  const [filter, setFilter] = useState<ConsoleLevel | 'all'>('all');
  const [query, setQuery] = useState('');

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
        height: 'clamp(140px, 32vh, 280px)',
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

        <div style={{ flex: 1 }} />

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
        <button
          type="button"
          onClick={onClear}
          title="清空控制台"
          style={{
            height: 20,
            padding: '0 6px',
            borderRadius: 4,
            border: '1px solid var(--border-subtle)',
            background: 'transparent',
            color: 'var(--fg-muted)',
            fontSize: 9,
            cursor: 'pointer',
          }}
        >
          清空
        </button>
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
      </div>

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
            {tauriMode ? (
              <>
                Tauri 原生窗口模式下无法监听页面控制台与网络
                <br />
                <span style={{ opacity: 0.7 }}>
                  建议在浏览器(Web)模式下使用控制台,或在 dev tools 中查看
                </span>
              </>
            ) : logs.length === 0 ? (
              '暂无控制台输出 · 跨域页面(非 localhost)无法注入,只能展示同源页面的日志'
            ) : (
              '当前过滤条件下无匹配'
            )}
          </div>
        ) : (
          filteredLogs.map((entry) => <ConsoleEntryRow key={entry.id} entry={entry} />)
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
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
