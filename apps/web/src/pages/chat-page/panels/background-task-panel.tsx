/**
 * 「后台任务」面板主体（T-05）。
 *
 * 自上而下：汇总条（计数 / 全部停止 / 同步时间）→ 子代理任务区 → 后台命令区。
 * 三态：loading（骨架）/ error（文案 + 重试）/ empty（总空态 + 触发说明）；
 * 有数据时若对账失败，错误降级为顶部横幅，保留已有数据可读。
 *
 * 约定：
 * - 数据全部来自 props（W1 的 `BackgroundTaskPanelModel`），组件内**不发请求**；
 * - 停止子代理 / 终止命令都是破坏性操作 → 逐行二次确认（复用 `AppDialog`），
 *   确认弹窗的初始焦点给「取消」（与 `BatchStopSubAgentsControl` 一致）；
 * - 行组件从 `./background-task-rows.js` 导入（NodeNext 需要 `.js` 后缀）。
 */
import React, { useId, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  BackgroundTaskConfirmDialog,
  type BackgroundTaskPendingConfirm,
} from './background-task-confirm-dialog.js';
import type { BackgroundTaskRow, BackgroundTaskSummary } from './background-task-model.js';
import type { BackgroundTaskPanelModel } from './use-background-task-panel.js';
import {
  BackgroundTaskActionButton,
  ShellTaskRow,
  SubagentTaskRow,
  formatSyncAge,
} from './background-task-rows.js';

/** 超过该时长未对账，同步时间降级为 warning（避免把旧状态当实时）。 */
const SYNC_STALE_MS = 30_000;

// ── 样式 ─────────────────────────────────────────────────────────

const PANEL_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  minWidth: 0,
};

const SUMMARY_BAR_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: 8,
  padding: '8px 12px',
  borderRadius: 10,
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-surface)',
};

const SUMMARY_COUNTS_STYLE: CSSProperties = {
  fontSize: 11,
  fontWeight: 650,
  lineHeight: 1.5,
  color: 'var(--fg-strong)',
  minWidth: 0,
};

const SUMMARY_ACTIONS_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 8,
};

const SECTION_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  minWidth: 0,
};

const SECTION_HEAD_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
};

const SECTION_TITLE_STYLE: CSSProperties = {
  margin: 0,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.01em',
  color: 'var(--fg-default)',
};

const SECTION_COUNT_STYLE: CSSProperties = {
  padding: '0 6px',
  borderRadius: 999,
  background: 'var(--bg-hover)',
  color: 'var(--fg-muted)',
  fontSize: 9.5,
  fontWeight: 700,
  lineHeight: '16px',
};

const SECTION_EMPTY_STYLE: CSSProperties = {
  margin: 0,
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px dashed var(--border-default)',
  color: 'var(--fg-subtle)',
  fontSize: 10.5,
  lineHeight: 1.6,
};

const ROW_LIST_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  margin: 0,
  padding: 0,
  listStyle: 'none',
};

const EMPTY_BLOCK_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
  padding: '24px 12px',
  borderRadius: 10,
  border: '1px dashed var(--border-default)',
  background: 'var(--bg-overlay)',
  textAlign: 'center',
};

const EMPTY_TITLE_STYLE: CSSProperties = {
  fontSize: 11.5,
  fontWeight: 650,
  color: 'var(--fg-default)',
};

const EMPTY_HINT_STYLE: CSSProperties = {
  fontSize: 10.5,
  lineHeight: 1.6,
  color: 'var(--fg-muted)',
};

const ERROR_BLOCK_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: 8,
  padding: '8px 12px',
  borderRadius: 10,
  border: '1px solid var(--danger-border)',
  background: 'var(--danger-muted)',
};

const ERROR_TEXT_STYLE: CSSProperties = {
  fontSize: 10.5,
  lineHeight: 1.6,
  color: 'var(--danger)',
  minWidth: 0,
  overflowWrap: 'anywhere',
};

const SKELETON_ROW_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 12,
  borderRadius: 10,
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-overlay)',
};

const SKELETON_LINE_STYLE: CSSProperties = {
  height: 8,
  borderRadius: 4,
  background: 'var(--bg-hover)',
};

const SKELETON_KEYFRAMES = `
@keyframes background-task-skeleton-pulse { 0%, 100% { opacity: 0.45 } 50% { opacity: 0.85 } }
@media (prefers-reduced-motion: reduce) {
  [data-background-task-skeleton] { animation: none !important }
}
`;

// ── 子组件 ───────────────────────────────────────────────────────

/** 汇总条：计数 + 全部停止 + 同步时间。 */
function SummaryBar({
  summary,
  nowMs,
  lastSyncedAtMs,
  onRequestStopAll,
}: {
  summary: BackgroundTaskSummary;
  nowMs: number;
  lastSyncedAtMs: number | null;
  onRequestStopAll: () => void;
}) {
  const stale = lastSyncedAtMs !== null && nowMs - lastSyncedAtMs > SYNC_STALE_MS;

  return (
    <div data-testid="background-task-summary" style={SUMMARY_BAR_STYLE}>
      <span
        data-testid="background-task-summary-counts"
        aria-live="polite"
        style={SUMMARY_COUNTS_STYLE}
      >
        {summary.runningSubagents} 个子代理运行中 · {summary.runningShells} 个后台命令
      </span>
      <div style={SUMMARY_ACTIONS_STYLE}>
        {summary.runningSubagents > 0 ? (
          <BackgroundTaskActionButton
            label="全部停止子代理"
            ariaLabel="全部停止子代理"
            testId="background-task-stop-all"
            tone="danger"
            onClick={onRequestStopAll}
          />
        ) : null}
        <span
          data-testid="background-task-sync-label"
          data-stale={stale ? 'true' : undefined}
          title={stale ? '对账已超时，列表可能不是最新状态' : '最近一次后台状态对账时间'}
          style={{
            fontSize: 10.5,
            lineHeight: 1.5,
            whiteSpace: 'nowrap',
            color: stale ? 'var(--warning)' : 'var(--fg-muted)',
          }}
        >
          {formatSyncAge(nowMs, lastSyncedAtMs)}
        </span>
      </div>
    </div>
  );
}

/** 加载骨架：仅在「无任何行 + loading」时出现，避免有数据时闪骨架。 */
function PanelSkeleton() {
  return (
    <div
      data-testid="background-task-loading"
      role="status"
      aria-label="正在加载后台任务"
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <style>{SKELETON_KEYFRAMES}</style>
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          data-background-task-skeleton="true"
          aria-hidden="true"
          style={{
            ...SKELETON_ROW_STYLE,
            animation: 'background-task-skeleton-pulse 1.4s ease-in-out infinite',
          }}
        >
          <div style={{ ...SKELETON_LINE_STYLE, width: '62%' }} />
          <div style={{ ...SKELETON_LINE_STYLE, width: '38%' }} />
        </div>
      ))}
    </div>
  );
}

/** 错误态：文案 + 重试（`onReloadTerminals`）。 */
function PanelErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div data-testid="background-task-error" role="alert" style={ERROR_BLOCK_STYLE}>
      <span style={ERROR_TEXT_STYLE}>后台任务同步失败：{message}</span>
      <BackgroundTaskActionButton
        label="重试"
        ariaLabel="重新加载后台任务"
        testId="background-task-retry"
        onClick={onRetry}
      />
    </div>
  );
}

/** 总空态：解释「什么情况下会出现在这里」。 */
function PanelEmptyState() {
  return (
    <div data-testid="background-task-empty" style={EMPTY_BLOCK_STYLE}>
      <span style={EMPTY_TITLE_STYLE}>当前没有后台任务</span>
      <span style={EMPTY_HINT_STYLE}>模型派发后台子代理或后台命令后，会在这里出现。</span>
    </div>
  );
}

/** 分区外壳：标题 + 计数 + 分区空态 / 行列表。 */
function TaskSection({
  testId,
  title,
  count,
  emptyTestId,
  emptyText,
  children,
}: {
  testId: string;
  title: string;
  count: number;
  emptyTestId: string;
  emptyText: string;
  children: React.ReactNode;
}) {
  const titleId = useId();

  return (
    <section data-testid={testId} aria-labelledby={titleId} style={SECTION_STYLE}>
      <header style={SECTION_HEAD_STYLE}>
        <h3 id={titleId} style={SECTION_TITLE_STYLE}>
          {title}
        </h3>
        <span style={SECTION_COUNT_STYLE} aria-live="polite">
          {count}
        </span>
      </header>
      {count === 0 ? (
        <p data-testid={emptyTestId} style={SECTION_EMPTY_STYLE}>
          {emptyText}
        </p>
      ) : (
        <ul style={ROW_LIST_STYLE}>{children}</ul>
      )}
    </section>
  );
}

// ── 导出的面板主体（冻结签名，勿改） ──────────────────────────────

export function BackgroundTaskPanel(props: {
  model: BackgroundTaskPanelModel;
  loading: boolean;
  error: string | null;
  lastSyncedAtMs: number | null;
  stoppingSubAgentIds: ReadonlySet<string>;
  pendingKillIds: ReadonlySet<string>;
  onReloadTerminals: () => void;
  onOpenSession: (childSessionId: string) => void;
  onStopSubagent: (childSessionId: string) => void;
  onStopAllSubagents: () => void;
  onPreviewTerminal: (terminalId: string) => void;
  onKillTerminal: (terminalId: string) => void;
}): React.ReactElement {
  const {
    model,
    loading,
    error,
    lastSyncedAtMs,
    stoppingSubAgentIds,
    pendingKillIds,
    onReloadTerminals,
    onOpenSession,
    onStopSubagent,
    onStopAllSubagents,
    onPreviewTerminal,
    onKillTerminal,
  } = props;

  const [pendingConfirm, setPendingConfirm] = useState<BackgroundTaskPendingConfirm | null>(null);
  // 破坏性确认：初始焦点给「取消」，避免回车直接触发停止 / 终止。

  const subagentRows: BackgroundTaskRow[] = model.rows.filter((row) => row.kind === 'subagent');
  const shellRows: BackgroundTaskRow[] = model.rows.filter((row) => row.kind === 'shell');
  const hasRows = model.rows.length > 0;
  const showSkeleton = !hasRows && error === null && loading;
  const showErrorState = !hasRows && error !== null;
  const showEmptyState = !hasRows && error === null && !loading;

  const closeConfirm = () => setPendingConfirm(null);

  const handleConfirm = () => {
    const pending = pendingConfirm;
    if (pending === null) {
      return;
    }
    // 先关闭弹窗再回调：请求在途态由父级（stoppingSubAgentIds / pendingKillIds）驱动行内按钮。
    setPendingConfirm(null);
    if (pending.kind === 'stop-subagent') {
      onStopSubagent(pending.sessionId);
    } else if (pending.kind === 'kill-shell') {
      onKillTerminal(pending.terminalId);
    } else {
      onStopAllSubagents();
    }
  };

  return (
    <div data-testid="background-task-panel" style={PANEL_STYLE}>
      <SummaryBar
        summary={model.summary}
        nowMs={model.now}
        lastSyncedAtMs={lastSyncedAtMs}
        onRequestStopAll={() =>
          setPendingConfirm({ kind: 'stop-all', count: model.summary.runningSubagents })
        }
      />

      {hasRows && error !== null ? (
        <PanelErrorState message={error} onRetry={onReloadTerminals} />
      ) : null}
      {showSkeleton ? <PanelSkeleton /> : null}
      {showErrorState ? (
        <PanelErrorState message={error ?? ''} onRetry={onReloadTerminals} />
      ) : null}
      {showEmptyState ? <PanelEmptyState /> : null}

      {hasRows ? (
        <>
          <TaskSection
            testId="background-task-subagent-section"
            title="子代理任务"
            count={subagentRows.length}
            emptyTestId="background-task-subagent-empty"
            emptyText="暂无运行中的子代理任务"
          >
            {subagentRows.map((row) => {
              const childSessionId = row.sessionId ?? '';
              return (
                <SubagentTaskRow
                  key={row.key}
                  row={row}
                  stopping={childSessionId.length > 0 && stoppingSubAgentIds.has(childSessionId)}
                  onOpenSession={onOpenSession}
                  onStop={(sessionId) =>
                    setPendingConfirm({
                      kind: 'stop-subagent',
                      sessionId,
                      title: row.title?.trim() || sessionId.slice(0, 8),
                    })
                  }
                />
              );
            })}
          </TaskSection>

          <TaskSection
            testId="background-task-shell-section"
            title="后台命令"
            count={shellRows.length}
            emptyTestId="background-task-shell-empty"
            emptyText="暂无后台命令"
          >
            {shellRows.map((row) => {
              const terminalId = row.terminalId ?? '';
              return (
                <ShellTaskRow
                  key={row.key}
                  row={row}
                  pendingKill={terminalId.length > 0 && pendingKillIds.has(terminalId)}
                  onPreview={onPreviewTerminal}
                  onKill={(nextTerminalId) =>
                    setPendingConfirm({
                      kind: 'kill-shell',
                      terminalId: nextTerminalId,
                      command: row.command?.trim() || row.title?.trim() || nextTerminalId,
                    })
                  }
                />
              );
            })}
          </TaskSection>
        </>
      ) : null}

      <BackgroundTaskConfirmDialog
        pending={pendingConfirm}
        onConfirm={handleConfirm}
        onDismiss={closeConfirm}
      />
    </div>
  );
}
