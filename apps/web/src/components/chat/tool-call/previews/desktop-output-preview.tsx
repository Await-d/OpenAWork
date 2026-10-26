/* ── desktop_automation 读取类动作的专用输出视图 ── */

import type {
  DesktopConsoleErrorView,
  DesktopConsoleMessageView,
  DesktopElementMatchView,
  DesktopFrameView,
  DesktopNetworkRequestView,
  DesktopOutputNode,
} from '../shared/desktop-output-view.js';
import { ExpandableOutput } from '../shared/expandable-output.js';
import { JsonPreview } from './json-preview.js';

const MONO =
  'ui-monospace, SFMono-Regular, SFMono, Menlo, Monaco, Consolas, Liberation Mono, monospace';

/** 每类列表的渲染上限（超出给「还有 N 条」，不做虚拟化）。 */
const MAX_CONSOLE_ROWS = 50;
const MAX_NETWORK_ROWS = 50;
const MAX_ELEMENT_ROWS = 30;
const MAX_FRAME_ROWS = 20;

const ROW_BASE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
  fontSize: 11,
  lineHeight: 1.55,
  minWidth: 0,
};

const MUTED_TEXT: React.CSSProperties = { color: 'var(--fg-muted)' };

function EmptyHint({ children }: { children: string }) {
  return <div className="tool-call-inline-empty">{children}</div>;
}

function MoreRows({ hidden }: { hidden: number }) {
  return hidden > 0 ? (
    <div style={{ ...MUTED_TEXT, fontSize: 10 }}>还有 {hidden} 条未展示…</div>
  ) : null;
}

function StatusView({ enabled, started }: { enabled?: boolean; started?: boolean }) {
  const running = started === true;
  const disabled = enabled === false;
  const label = disabled ? '浏览器自动化未启用' : running ? '已启动' : '已启用 · 未启动';
  const color = disabled ? 'var(--fg-muted)' : running ? 'var(--success)' : 'var(--fg-muted)';

  return (
    <div style={{ ...ROW_BASE, alignItems: 'center' }}>
      <span
        aria-hidden="true"
        style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }}
      />
      <span style={{ fontSize: 11.5, color: 'var(--fg-default)' }}>{label}</span>
      <span style={{ ...MUTED_TEXT, fontFamily: MONO, fontSize: 10 }}>
        enabled={String(enabled ?? '—')} · started={String(started ?? '—')}
      </span>
    </div>
  );
}

function consoleLevelColor(level: string): string {
  if (level === 'error') return 'var(--danger)';
  if (level === 'warn') return 'var(--contrast, var(--accent))';
  return 'var(--fg-muted)';
}

function ConsoleRow({
  message,
  error,
}: {
  message?: DesktopConsoleMessageView;
  error?: DesktopConsoleErrorView;
}) {
  const isError = error !== undefined;
  const level = isError ? 'error' : (message?.level ?? 'log');
  const text = isError ? (error?.message ?? '') : (message?.text ?? '');

  return (
    <div style={ROW_BASE}>
      <span
        style={{
          flexShrink: 0,
          minWidth: 34,
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.02em',
          color: consoleLevelColor(level),
        }}
      >
        {isError ? '页面错误' : level}
      </span>
      <span style={{ flex: 1, minWidth: 0, fontFamily: MONO, wordBreak: 'break-word' }}>
        {text}
      </span>
    </div>
  );
}

function ConsoleView({
  messages,
  errors,
  truncated,
}: {
  messages: DesktopConsoleMessageView[];
  errors: DesktopConsoleErrorView[];
  truncated: boolean;
}) {
  if (messages.length === 0 && errors.length === 0) {
    return <EmptyHint>（控制台没有捕获到消息）</EmptyHint>;
  }

  const rows = messages.length + errors.length;
  const visibleMessages = messages.slice(0, MAX_CONSOLE_ROWS);
  const remaining = MAX_CONSOLE_ROWS - visibleMessages.length;
  const visibleErrors = errors.slice(0, Math.max(0, remaining));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {visibleMessages.map((message, index) => (
        <ConsoleRow key={`m-${index}`} message={message} />
      ))}
      {visibleErrors.map((error, index) => (
        <ConsoleRow key={`e-${index}`} error={error} />
      ))}
      <MoreRows hidden={Math.max(0, rows - visibleMessages.length - visibleErrors.length)} />
      {truncated && (
        <div style={{ ...MUTED_TEXT, fontSize: 10 }}>控制台捕获已按上限截断（较早消息已淘汰）</div>
      )}
    </div>
  );
}

function networkStatusColor(request: DesktopNetworkRequestView): string {
  if (request.failureText) return 'var(--danger)';
  if (request.status === undefined) return 'var(--fg-muted)';
  return request.status >= 200 && request.status < 400 ? 'var(--success)' : 'var(--danger)';
}

function NetworkRow({ request }: { request: DesktopNetworkRequestView }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '48px 42px minmax(0, 1fr) 60px',
        gap: 8,
        alignItems: 'baseline',
        fontSize: 11,
        lineHeight: 1.55,
        fontFamily: MONO,
      }}
    >
      <span style={{ color: 'var(--fg-default)' }}>{request.method}</span>
      <span style={{ color: networkStatusColor(request) }}>
        {request.failureText ? '失败' : (request.status ?? '—')}
      </span>
      <span
        title={request.failureText ? `${request.url}\n${request.failureText}` : request.url}
        style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {request.url}
      </span>
      <span style={{ ...MUTED_TEXT, textAlign: 'right' }}>
        {request.durationMs !== undefined ? `${Math.round(request.durationMs)}ms` : '—'}
      </span>
    </div>
  );
}

function NetworkListView({
  requests,
  truncated,
}: {
  requests: DesktopNetworkRequestView[];
  truncated: boolean;
}) {
  if (requests.length === 0) {
    return <EmptyHint>（没有捕获到网络请求）</EmptyHint>;
  }

  const visible = requests.slice(0, MAX_NETWORK_ROWS);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {visible.map((request, index) => (
        <NetworkRow key={`${request.id}-${index}`} request={request} />
      ))}
      <MoreRows hidden={requests.length - visible.length} />
      {truncated && <div style={{ ...MUTED_TEXT, fontSize: 10 }}>请求列表已按上限截断</div>}
    </div>
  );
}

function NetworkRequestView({ request }: { request: DesktopNetworkRequestView }) {
  const rows: Array<[string, string]> = [
    ['方法', request.method],
    ['状态', request.failureText ? `失败 · ${request.failureText}` : String(request.status ?? '—')],
    ['地址', request.url],
    ...(request.resourceType.length > 0
      ? ([['类型', request.resourceType]] as Array<[string, string]>)
      : []),
    ...(request.durationMs !== undefined
      ? ([['耗时', `${Math.round(request.durationMs)}ms`]] as Array<[string, string]>)
      : []),
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {rows.map(([label, value]) => (
        <div key={label} style={{ display: 'flex', gap: 10, fontSize: 11, lineHeight: 1.55 }}>
          <span style={{ ...MUTED_TEXT, flexShrink: 0, width: 32 }}>{label}</span>
          <span style={{ minWidth: 0, fontFamily: MONO, wordBreak: 'break-word' }}>{value}</span>
        </div>
      ))}
    </div>
  );
}

function ElementRow({ element }: { element: DesktopElementMatchView }) {
  const name = element.id ? `${element.tag}#${element.id}` : element.tag;
  return (
    <div style={ROW_BASE}>
      <span style={{ flexShrink: 0, fontFamily: MONO, color: 'var(--fg-default)' }}>{name}</span>
      {element.text.length > 0 && (
        <span
          title={element.text}
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {element.text}
        </span>
      )}
      {!element.visible && <span style={{ ...MUTED_TEXT, flexShrink: 0, fontSize: 10 }}>隐藏</span>}
    </div>
  );
}

function ElementsView({ matches }: { matches: DesktopElementMatchView[] }) {
  if (matches.length === 0) {
    return <EmptyHint>（没有匹配到元素）</EmptyHint>;
  }

  const visible = matches.slice(0, MAX_ELEMENT_ROWS);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {visible.map((element, index) => (
        <ElementRow key={`${element.tag}-${index}`} element={element} />
      ))}
      <MoreRows hidden={matches.length - visible.length} />
    </div>
  );
}

function FrameRow({ frame }: { frame: DesktopFrameView }) {
  return (
    <div style={ROW_BASE}>
      <span style={{ ...MUTED_TEXT, flexShrink: 0, width: 18, textAlign: 'right' }}>
        {frame.index}
      </span>
      <span style={{ flexShrink: 0, fontFamily: MONO }}>
        {frame.name.length > 0 ? frame.name : '（未命名）'}
      </span>
      {frame.isMain && (
        <span style={{ flexShrink: 0, fontSize: 10, color: 'var(--accent)' }}>主框架</span>
      )}
      <span
        title={frame.url}
        style={{
          flex: 1,
          minWidth: 0,
          fontFamily: MONO,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {frame.url}
      </span>
    </div>
  );
}

function FramesView({ frames }: { frames: DesktopFrameView[] }) {
  if (frames.length === 0) {
    return <EmptyHint>（页面里没有 iframe）</EmptyHint>;
  }

  const visible = frames.slice(0, MAX_FRAME_ROWS);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {visible.map((frame) => (
        <FrameRow key={frame.index} frame={frame} />
      ))}
      <MoreRows hidden={frames.length - visible.length} />
    </div>
  );
}

function SnapshotView({
  url,
  title,
  openPages,
}: {
  url: string;
  title: string;
  openPages: string[];
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {title.length > 0 && <div style={{ fontSize: 11.5, fontWeight: 600 }}>{title}</div>}
      {url.length > 0 && (
        <div style={{ fontSize: 11, fontFamily: MONO, wordBreak: 'break-word' }}>{url}</div>
      )}
      {openPages.length > 0 && (
        <div style={{ ...MUTED_TEXT, fontSize: 10 }}>
          {openPages.length} 个打开页面 · {openPages.join(' · ')}
        </div>
      )}
    </div>
  );
}

/**
 * 读取类动作的专用输出视图。
 *
 * `none` 返回 `null`，由卡片回退到通用 `ToolOutputPreview`——语义上「不知道形状就
 * 不猜」，避免把普通 JSON 误渲染成空列表。
 */
export function DesktopOutputPreview({ node }: { node: DesktopOutputNode }) {
  switch (node.kind) {
    case 'status':
      return <StatusView enabled={node.enabled} started={node.started} />;
    case 'console':
      return (
        <ConsoleView messages={node.messages} errors={node.errors} truncated={node.truncated} />
      );
    case 'network-list':
      return <NetworkListView requests={node.requests} truncated={node.truncated} />;
    case 'network-request':
      return <NetworkRequestView request={node.request} />;
    case 'elements':
      return <ElementsView matches={node.matches} />;
    case 'frames':
      return <FramesView frames={node.frames} />;
    case 'snapshot':
      return <SnapshotView url={node.url} title={node.title} openPages={node.openPages} />;
    case 'json':
      return <JsonPreview data={node.value} maxLines={14} />;
    case 'text':
      return <ExpandableOutput text={node.text} maxChars={1200} />;
    default:
      return null;
  }
}
