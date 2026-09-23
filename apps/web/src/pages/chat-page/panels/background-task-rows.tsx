/**
 * 「后台任务」面板行组件（T-04）。
 *
 * - `SubagentTaskRow`：后台子代理任务（`task` / `Agent`，`run_in_background=true`）。
 * - `ShellTaskRow`：后台命令（`run_bash_in_background`）。
 *
 * 约定：
 * - 数据全部来自 props（W1 的 `BackgroundTaskRow`），组件内**不发请求**、不 import web-client；
 * - 停止 / 终止是破坏性操作，本层只触发回调，二次确认由面板层（T-05）统一承担；
 * - 耗时不依赖父级重渲染：活跃行自带 1s 行内时钟。React Compiler 会按 props 记忆化组件
 *   输出，父级的 `model.now` 心跳不一定能穿透到行，行内时钟才能保证秒级推进；
 * - 颜色 / 间距走既有 CSS 变量与 4/8/12/16 阶梯，禁止硬编码色值。
 */
import React, { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { BackgroundTaskRow, BackgroundTaskState } from './background-task-model.js';

/** 复制成功 / 失败反馈的保留时长。 */
const COPY_FEEDBACK_MS = 1600;
/** 行内时钟步进：只服务耗时展示。 */
const ROW_CLOCK_INTERVAL_MS = 1000;
/** cwd 折叠阈值：超过该长度只保留「…/父目录/末级」。 */
const CWD_COMPACT_MAX_LENGTH = 28;
/** 与 `--font-mono` 一致的等宽字体栈（变量未定义时的兜底与既有组件保持一致）。 */
const MONO_FONT = 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)';

type CopyFeedback = 'idle' | 'copied' | 'failed';
export type BackgroundTaskTone = 'accent' | 'warning' | 'success' | 'danger' | 'muted';

const TONE_COLOR: Record<BackgroundTaskTone, string> = {
  accent: 'var(--accent)',
  warning: 'var(--warning)',
  success: 'var(--success)',
  danger: 'var(--danger)',
  muted: 'var(--fg-subtle)',
};

// ── 纯格式化函数（导出以便单测直接覆盖） ─────────────────────────────

/** 状态文案：面板与 `aria-label` 共用，避免「状态点无文字」的无障碍缺口。 */
export function formatTaskStateLabel(state: BackgroundTaskState): string {
  switch (state) {
    case 'running':
      return '运行中';
    case 'pending':
      return '排队中';
    case 'succeeded':
      return '已完成';
    case 'failed':
      return '失败';
    case 'cancelled':
      return '已取消';
    default:
      return '未知';
  }
}

/** 状态点 tone：running=accent / pending=warning / 终态 muted（failed 用 danger）。 */
export function resolveTaskStateTone(state: BackgroundTaskState): BackgroundTaskTone {
  if (state === 'running') return 'accent';
  if (state === 'pending') return 'warning';
  if (state === 'failed') return 'danger';
  return 'muted';
}

/** 人读字节数：`1.2 KB` / `3.4 MB`。 */
export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${Math.round(bytes)} B`;
}

/** 紧凑耗时：`12s` / `3m 5s` / `1h 2m`。 */
export function formatTaskDuration(ms: number): string {
  const safeMs = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const totalSeconds = Math.floor(safeMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** cwd 紧凑化：过长时折叠为「…/父目录/末级」，保留末两级以便辨识工作目录。 */
export function formatCompactPath(
  path: string,
  maxLength: number = CWD_COMPACT_MAX_LENGTH,
): string {
  const normalized = path.trim().replace(/\\/g, '/');
  if (normalized.length === 0) return '';
  if (normalized.length <= maxLength) return normalized;
  const segments = normalized.split('/').filter((segment) => segment.length > 0);
  const leaf = segments[segments.length - 1];
  const parent = segments[segments.length - 2];
  if (leaf === undefined || parent === undefined) return normalized;
  return `…/${parent}/${leaf}`;
}

/** 同步时间口径：`尚未同步` / `同步于 12s 前`。 */
export function formatSyncAge(nowMs: number, lastSyncedAtMs: number | null): string {
  if (lastSyncedAtMs === null) return '尚未同步';
  const diffMs = Math.max(0, nowMs - lastSyncedAtMs);
  if (diffMs < 1000) return '刚刚同步';
  if (diffMs < 60_000) return `同步于 ${Math.round(diffMs / 1000)}s 前`;
  if (diffMs < 3_600_000) return `同步于 ${Math.round(diffMs / 60_000)}m 前`;
  return `同步于 ${Math.round(diffMs / 3_600_000)}h 前`;
}

// ── 内部工具 ─────────────────────────────────────────────────────

/**
 * 行内时钟：仅在行处于活跃态（running / pending）时每秒推进。
 * 终态行的耗时来自 `endedAtMs`，不需要时钟。
 */
function useRowClock(active: boolean): number {
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!active) {
      return;
    }
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, ROW_CLOCK_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [active]);

  return nowMs;
}

/** 复制到剪贴板：不可用 / 被拒绝一律返回 false，由调用方呈现「复制失败」。 */
async function writeClipboardText(text: string): Promise<boolean> {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
  if (clipboard === undefined || typeof clipboard.writeText !== 'function') {
    return false;
  }
  try {
    // 直接用成员调用（`clipboard.writeText(text)`）：避免抽取方法引用后调用丢 `this`。
    await clipboard.writeText(text);
    return true;
  } catch {
    // 非安全上下文 / 无权限 / 用户拒绝：降级为行内「复制失败」，不抛给上层。
    return false;
  }
}

/** 活跃行耗时：running 用 now-startedAt；终态用 endedAt-startedAt。 */
function resolveElapsedMs(row: BackgroundTaskRow, nowMs: number): number {
  const endMs = row.endedAtMs ?? nowMs;
  return Math.max(0, endMs - row.startedAtMs);
}

/** 排队时长：优先用 W1 计算的 `queuedMs`，缺失时按 now-startedAt 兜底。 */
function resolveQueuedMs(row: BackgroundTaskRow, nowMs: number): number {
  return Math.max(0, row.queuedMs ?? nowMs - row.startedAtMs);
}

function resolveDurationLabel(row: BackgroundTaskRow, nowMs: number): string {
  if (row.state === 'pending') {
    return `排队 ${formatTaskDuration(resolveQueuedMs(row, nowMs))}`;
  }
  return formatTaskDuration(resolveElapsedMs(row, nowMs));
}

function resolveRowTitle(row: BackgroundTaskRow, fallback: string): string {
  const title = row.title?.trim();
  return title !== undefined && title.length > 0 ? title : fallback;
}

// ── 样式 ─────────────────────────────────────────────────────────

const ROW_CARD_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 12,
  borderRadius: 10,
  border: '1px solid var(--border-default)',
  background: 'var(--bg-overlay)',
  minWidth: 0,
  listStyle: 'none',
};

const ROW_HEAD_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
};

const ROW_TITLE_STYLE: CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontSize: 11.5,
  fontWeight: 650,
  lineHeight: 1.4,
  color: 'var(--fg-strong)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const ROW_META_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 8,
  minWidth: 0,
  fontSize: 10.5,
  lineHeight: 1.4,
  color: 'var(--fg-muted)',
};

const ROW_ACTIONS_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 8,
};

const ROW_ERROR_STYLE: CSSProperties = {
  margin: 0,
  fontSize: 10.5,
  lineHeight: 1.5,
  color: 'var(--danger)',
  overflowWrap: 'anywhere',
};

const MONO_META_STYLE: CSSProperties = {
  fontFamily: MONO_FONT,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

function stateChipStyle(state: BackgroundTaskState): CSSProperties {
  const color = TONE_COLOR[resolveTaskStateTone(state)];
  return {
    flexShrink: 0,
    padding: '1px 6px',
    borderRadius: 999,
    border: `1px solid color-mix(in srgb, ${color} 34%, transparent)`,
    background: `color-mix(in srgb, ${color} 12%, transparent)`,
    color,
    fontSize: 9.5,
    fontWeight: 700,
    lineHeight: 1.6,
    whiteSpace: 'nowrap',
  };
}

// ── 子组件 ───────────────────────────────────────────────────────

/** 状态点：颜色 + 文字双重编码（`aria-label` 给屏幕阅读器）。 */
function StatusDot({ state }: { state: BackgroundTaskState }) {
  const tone = resolveTaskStateTone(state);
  const color = TONE_COLOR[tone];
  const label = formatTaskStateLabel(state);
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-testid="background-task-row-status"
      data-tone={tone}
      data-state={state}
      style={{
        width: 8,
        height: 8,
        flexShrink: 0,
        borderRadius: '50%',
        background: color,
        boxShadow:
          state === 'running' ? `0 0 0 3px color-mix(in srgb, ${color} 18%, transparent)` : 'none',
      }}
    />
  );
}

/**
 * 行内动作按钮：hover / active / focus 三态齐全，focus ring = accent 2px + 4px 光晕。
 * 面板层（汇总条的「全部停止子代理」）复用同一视觉语言。
 */
export function BackgroundTaskActionButton({
  label,
  ariaLabel,
  testId,
  disabled = false,
  tone = 'default',
  onClick,
}: {
  label: string;
  ariaLabel?: string;
  testId: string;
  disabled?: boolean;
  tone?: 'default' | 'danger';
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [active, setActive] = useState(false);
  const [focused, setFocused] = useState(false);
  const danger = tone === 'danger';
  const borderColor = danger ? 'var(--danger-border)' : 'var(--border-default)';
  const hoverBorderColor = danger ? 'var(--danger)' : 'var(--border-strong)';

  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setActive(false);
      }}
      onMouseDown={() => setActive(true)}
      onMouseUp={() => setActive(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        setActive(false);
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        padding: '4px 8px',
        borderRadius: 8,
        border: `1px solid ${hovered && !disabled ? hoverBorderColor : borderColor}`,
        background: active
          ? danger
            ? 'var(--danger-muted)'
            : 'var(--bg-active)'
          : hovered && !disabled
            ? danger
              ? 'var(--danger-muted)'
              : 'var(--bg-hover)'
            : 'transparent',
        color: danger ? 'var(--danger)' : 'var(--fg-default)',
        fontSize: 10.5,
        fontWeight: 650,
        lineHeight: 1.4,
        whiteSpace: 'nowrap',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        // focus ring 用长写属性，避免简写在部分渲染环境下被丢弃。
        outlineStyle: focused ? 'solid' : 'none',
        outlineWidth: focused ? 2 : 0,
        outlineColor: 'var(--accent)',
        outlineOffset: focused ? 2 : 0,
        boxShadow: focused ? '0 0 0 4px var(--accent-subtle)' : 'none',
        transition: 'background 120ms ease, border-color 120ms ease, opacity 120ms ease',
      }}
    >
      {label}
    </button>
  );
}

/** 复制图标：纯装饰，交互语义由按钮的 `aria-label` 承担。 */
function CopyGlyph() {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

/** 可复制 id（`task_id` / `terminalId`）：等宽 + 全文 `title` + 成功 / 失败反馈。 */
function CopyableId({
  value,
  ariaLabel,
  testId,
}: {
  value: string;
  ariaLabel: string;
  testId: string;
}) {
  const [feedback, setFeedback] = useState<CopyFeedback>('idle');
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    },
    [],
  );

  const handleCopy = () => {
    void writeClipboardText(value).then((copied) => {
      setFeedback(copied ? 'copied' : 'failed');
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
      timerRef.current = window.setTimeout(() => {
        setFeedback('idle');
      }, COPY_FEEDBACK_MS);
    });
  };

  const feedbackColor =
    feedback === 'copied'
      ? 'var(--success)'
      : feedback === 'failed'
        ? 'var(--danger)'
        : 'var(--fg-muted)';

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
      <button
        type="button"
        data-testid={testId}
        aria-label={ariaLabel}
        title={`${value}（点击复制）`}
        onClick={handleCopy}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          minWidth: 0,
          maxWidth: '100%',
          padding: '2px 6px',
          borderRadius: 6,
          border: `1px solid ${hovered ? 'var(--border-emphasis)' : 'var(--border-subtle)'}`,
          background: hovered ? 'var(--bg-hover)' : 'transparent',
          color: 'var(--fg-default)',
          fontFamily: MONO_FONT,
          fontSize: 10.5,
          lineHeight: 1.5,
          cursor: 'pointer',
          outlineStyle: focused ? 'solid' : 'none',
          outlineWidth: focused ? 2 : 0,
          outlineColor: 'var(--accent)',
          outlineOffset: focused ? 2 : 0,
          boxShadow: focused ? '0 0 0 4px var(--accent-subtle)' : 'none',
          transition: 'background 120ms ease, border-color 120ms ease',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {value}
        </span>
        <CopyGlyph />
      </button>
      {/* 常驻 live region：复制结果变化时才会被播报，卸载式反馈会漏读。 */}
      <span
        role="status"
        aria-live="polite"
        data-testid={`${testId}-feedback`}
        style={{ fontSize: 9.5, lineHeight: 1.4, color: feedbackColor, whiteSpace: 'nowrap' }}
      >
        {feedback === 'copied' ? '已复制' : feedback === 'failed' ? '复制失败' : ''}
      </span>
    </span>
  );
}

// ── 导出行组件（冻结签名，勿改） ──────────────────────────────────

/** 后台子代理任务行。 */
export function SubagentTaskRow(props: {
  row: BackgroundTaskRow;
  stopping: boolean;
  onOpenSession: (childSessionId: string) => void;
  onStop: (childSessionId: string) => void;
}): React.ReactElement {
  const { row, stopping, onOpenSession, onStop } = props;
  const nowMs = useRowClock(row.state === 'running' || row.state === 'pending');
  const title = resolveRowTitle(row, row.taskId ?? '未命名子代理任务');
  const sessionId = row.sessionId?.trim() ?? '';
  // W1 的 `agent` 是不带 @ 的原始名，`detail` 则是已带 @ 的展示串：二者择一，避免出现 `@@`。
  const agentLabel = row.agent?.trim() ?? '';
  const agent = agentLabel.length > 0 ? `@${agentLabel}` : (row.detail?.trim() ?? '');
  const taskId = row.taskId?.trim() ?? '';
  const hasSession = sessionId.length > 0;

  return (
    <li
      data-testid="background-task-row"
      data-kind="subagent"
      data-state={row.state}
      data-task-key={row.key}
      style={ROW_CARD_STYLE}
    >
      <div style={ROW_HEAD_STYLE}>
        <StatusDot state={row.state} />
        <span style={ROW_TITLE_STYLE} title={title}>
          {title}
        </span>
        <span style={stateChipStyle(row.state)}>{formatTaskStateLabel(row.state)}</span>
      </div>

      <div style={ROW_META_STYLE}>
        {agent.length > 0 && <span>{agent}</span>}
        {hasSession && <span style={MONO_META_STYLE}>会话 {sessionId.slice(0, 8)}</span>}
        <span>{resolveDurationLabel(row, nowMs)}</span>
      </div>

      {taskId.length > 0 && (
        <CopyableId
          value={taskId}
          ariaLabel={`复制任务 ID ${taskId}`}
          testId="background-task-row-copy-id"
        />
      )}

      {row.errorMessage !== undefined && row.errorMessage.trim().length > 0 && (
        <p data-testid="background-task-row-error" style={ROW_ERROR_STYLE}>
          {row.errorMessage}
        </p>
      )}

      <div style={ROW_ACTIONS_STYLE}>
        <BackgroundTaskActionButton
          label="打开子会话"
          ariaLabel={`打开子代理会话 ${title}`}
          testId="background-task-row-open-session"
          disabled={!hasSession}
          onClick={() => {
            if (hasSession) {
              onOpenSession(sessionId);
            }
          }}
        />
        {/* 终态行不提供停止：已完成/失败/取消的子代理再 stop 只会被 skipped。 */}
        {row.state === 'running' || row.state === 'pending' ? (
          <BackgroundTaskActionButton
            label={stopping ? '停止中' : '停止'}
            ariaLabel={`停止子代理 ${title}`}
            testId="background-task-row-stop"
            tone="danger"
            disabled={stopping || !hasSession}
            onClick={() => {
              if (hasSession) {
                onStop(sessionId);
              }
            }}
          />
        ) : null}
      </div>
    </li>
  );
}

/** 后台命令行。 */
export function ShellTaskRow(props: {
  row: BackgroundTaskRow;
  pendingKill: boolean;
  onPreview: (terminalId: string) => void;
  onKill: (terminalId: string) => void;
}): React.ReactElement {
  const { row, pendingKill, onPreview, onKill } = props;
  const nowMs = useRowClock(row.state === 'running' || row.state === 'pending');
  const terminalId = row.terminalId?.trim() ?? '';
  // 展示完整命令（CSS nowrap + 省略号压成单行），`title` 给全文；缺失时退回任务标题。
  const fullCommand = (row.command ?? row.title)?.trim() ?? '';
  const command = fullCommand.length > 0 ? fullCommand : terminalId;
  const cwd = (row.cwd ?? row.detail)?.trim() ?? '';
  const compactCwd = formatCompactPath(cwd);
  const hasTerminal = terminalId.length > 0;

  return (
    <li
      data-testid="background-task-row"
      data-kind="shell"
      data-state={row.state}
      data-task-key={row.key}
      style={ROW_CARD_STYLE}
    >
      <div style={ROW_HEAD_STYLE}>
        <StatusDot state={row.state} />
        <span style={ROW_TITLE_STYLE} title={command}>
          {command}
        </span>
        <span style={stateChipStyle(row.state)}>{formatTaskStateLabel(row.state)}</span>
      </div>

      <div style={ROW_META_STYLE}>
        {compactCwd.length > 0 && <span title={cwd}>{compactCwd}</span>}
        <span>{resolveDurationLabel(row, nowMs)}</span>
        {row.outputBytesTotal !== undefined && (
          <span data-testid="background-task-row-output-bytes">
            {formatByteSize(row.outputBytesTotal)}
          </span>
        )}
      </div>

      {hasTerminal && (
        <CopyableId
          value={terminalId}
          ariaLabel={`复制终端 ID ${terminalId}`}
          testId="background-task-row-copy-id"
        />
      )}

      {row.errorMessage !== undefined && row.errorMessage.trim().length > 0 && (
        <p data-testid="background-task-row-error" style={ROW_ERROR_STYLE}>
          {row.errorMessage}
        </p>
      )}

      <div style={ROW_ACTIONS_STYLE}>
        <BackgroundTaskActionButton
          label="查看"
          ariaLabel={`查看后台命令 ${terminalId}`}
          testId="background-task-row-preview-terminal"
          disabled={!hasTerminal}
          onClick={() => {
            if (hasTerminal) {
              onPreview(terminalId);
            }
          }}
        />
        {/* 终态行不提供终止：已完成/失败的终端再 kill 只会得到 alreadyClosed。 */}
        {row.state === 'running' ? (
          <BackgroundTaskActionButton
            label={pendingKill ? '终止中' : '终止'}
            ariaLabel={`终止后台命令 ${terminalId}`}
            testId="background-task-row-kill-terminal"
            tone="danger"
            disabled={pendingKill || !hasTerminal}
            onClick={() => {
              if (hasTerminal) {
                onKill(terminalId);
              }
            }}
          />
        ) : null}
      </div>
    </li>
  );
}
