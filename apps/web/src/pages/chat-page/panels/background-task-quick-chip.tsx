/**
 * 「后台任务」常驻胶囊 + 展开列表（Phase 1）。
 *
 * 落点：`composerFooterSlot`（输入框上方左侧，与「选择工作空间」「停止全部子代理」同处）。
 *
 * 口径：
 * - **仅在有运行中任务时渲染**（`running/pending`），全部完成后自动消失；历史在完整面板看；
 * - 组件内**不发请求**：数据来自 `useBackgroundTaskPanel` 的输出，动作走既有回调；
 * - 停止 / 终止是破坏性操作 → **共用** `BackgroundTaskConfirmDialog`（与完整面板同一份实现），
 *   确认后由父级回调执行（在途态由 `stoppingSubAgentIds` / `pendingKillIds` 驱动）。
 *
 * 可访问性：胶囊为原生 `button`（`aria-haspopup="dialog"` + `aria-expanded`）；弹出层
 * `role="dialog"` + Esc 关闭（焦点回胶囊）+ 点击外部关闭。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import type { BackgroundTaskRow } from './background-task-model.js';
import type { BackgroundTaskPanelModel } from './use-background-task-panel.js';
import {
  BackgroundTaskConfirmDialog,
  type BackgroundTaskPendingConfirm,
} from './background-task-confirm-dialog.js';

export interface BackgroundTaskQuickChipProps {
  model: BackgroundTaskPanelModel;
  stoppingSubAgentIds: ReadonlySet<string>;
  pendingKillIds: ReadonlySet<string>;
  onOpenSession: (childSessionId: string) => void;
  onStopSubagent: (childSessionId: string) => void;
  onStopAllSubagents: () => void;
  onPreviewTerminal: (terminalId: string) => void;
  onKillTerminal: (terminalId: string) => void;
  /** 打开完整「后台任务」面板（classic / fusion 路由由父级决定）。 */
  onOpenPanel: () => void;
}

/** 运行中 / 排队中都算「活跃」（与面板汇总口径一致）。 */
function isActiveRow(row: BackgroundTaskRow): boolean {
  return row.state === 'running' || row.state === 'pending';
}

const CHIP_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 24,
  padding: '0 10px',
  borderRadius: 999,
  border: '1px solid var(--border-default)',
  background: 'var(--bg-overlay)',
  color: 'var(--fg-default)',
  fontSize: 11.5,
  fontWeight: 600,
  cursor: 'pointer',
  flexShrink: 0,
};

const POPOVER_STYLE: CSSProperties = {
  position: 'absolute',
  left: 0,
  bottom: 'calc(100% + 6px)',
  width: 320,
  // 极矮视口（< ~500px 高）下 320px 固定高度会被对话面板的 `overflow: hidden` 裁掉底部；
  // 用 vh 上限做廉价加固（正常视口仍是 320px 封顶）。
  maxHeight: 'min(320px, 45vh)',
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: 10,
  borderRadius: 12,
  border: '1px solid var(--border-default)',
  background: 'var(--bg-overlay)',
  boxShadow: 'var(--shadow-lg, 0 12px 32px rgb(0 0 0 / 0.28))',
  zIndex: 40,
};

const ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 8px',
  borderRadius: 8,
  background: 'var(--bg-surface)',
  minWidth: 0,
};

const ROW_TITLE_STYLE: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 12,
  color: 'var(--fg-strong)',
};

const ROW_DETAIL_STYLE: CSSProperties = {
  flexShrink: 0,
  fontSize: 10.5,
  color: 'var(--fg-muted)',
  maxWidth: 96,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

function resolveStateColor(state: BackgroundTaskRow['state']): string {
  if (state === 'running') {
    return 'var(--accent)';
  }
  if (state === 'pending') {
    return 'var(--warning)';
  }
  if (state === 'failed') {
    return 'var(--danger)';
  }
  return 'var(--fg-muted)';
}

function StatusDot({ row }: { row: BackgroundTaskRow }) {
  return (
    <span
      aria-hidden="true"
      data-testid="background-task-chip-row-status"
      style={{
        width: 6,
        height: 6,
        borderRadius: '50%',
        flexShrink: 0,
        background: resolveStateColor(row.state),
        ...(row.state === 'running'
          ? { boxShadow: '0 0 0 3px color-mix(in oklch, var(--accent) 16%, transparent)' }
          : {}),
      }}
    />
  );
}

/** 紧凑动作按钮：hover / active / focus-visible 齐备（禁止裸样式）。 */
function ChipAction({
  label,
  testId,
  tone = 'default',
  disabled = false,
  onClick,
}: {
  label: string;
  testId: string;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const danger = tone === 'danger';
  const baseColor = danger ? 'var(--danger)' : 'var(--fg-default)';
  const borderColor = danger ? 'var(--danger-border)' : 'var(--border-subtle)';

  return (
    <button
      type="button"
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 22,
        padding: '0 8px',
        borderRadius: 6,
        border: `1px solid ${borderColor}`,
        background: hovered && !disabled ? 'var(--bg-hover)' : 'transparent',
        color: baseColor,
        fontSize: 10.5,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        transition: 'background 120ms ease, box-shadow 120ms ease',
        ...(focused
          ? {
              outline: '2px solid var(--accent)',
              outlineOffset: 2,
              boxShadow: '0 0 0 4px var(--accent-subtle)',
            }
          : {}),
      }}
    >
      {label}
    </button>
  );
}

export function BackgroundTaskQuickChip(props: BackgroundTaskQuickChipProps): ReactElement | null {
  const {
    model,
    onKillTerminal,
    onOpenPanel,
    onOpenSession,
    onPreviewTerminal,
    onStopAllSubagents,
    onStopSubagent,
    pendingKillIds,
    stoppingSubAgentIds,
  } = props;

  const activeRows = useMemo(() => model.rows.filter(isActiveRow), [model.rows]);
  const [open, setOpen] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<BackgroundTaskPendingConfirm | null>(null);
  const chipRef = useRef<HTMLButtonElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setPendingConfirm(null);
  }, []);

  // 点击外部关闭（弹窗打开时由 AppDialog 处理，这里只管列表）。
  useEffect(() => {
    if (!open) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      const container = containerRef.current;
      if (container && event.target instanceof Node && !container.contains(event.target)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        chipRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  if (activeRows.length === 0) {
    return null;
  }

  // 计数一律由**活跃行**派生（含 pending），保证胶囊数字、tooltip 与列表三者一致；
  // summary 只用于「全部停止」的目标数量（runng-only，与完整面板同口径）。
  const activeSubagents = activeRows.filter((row) => row.kind === 'subagent').length;
  const activeShells = activeRows.length - activeSubagents;
  const runningSubagents = model.summary.runningSubagents;
  const label = `后台 ${activeRows.length}`;
  const detail = `${activeSubagents} 个子代理进行中 · ${activeShells} 个后台命令`;

  const handleConfirm = () => {
    const pending = pendingConfirm;
    setPendingConfirm(null);
    if (pending === null) {
      return;
    }
    if (pending.kind === 'stop-subagent') {
      onStopSubagent(pending.sessionId);
    } else if (pending.kind === 'kill-shell') {
      onKillTerminal(pending.terminalId);
    } else {
      onStopAllSubagents();
    }
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        ref={chipRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        data-active="true"
        data-testid="background-task-chip"
        title={detail}
        onClick={() => setOpen((previous) => !previous)}
        onMouseEnter={(event) => {
          event.currentTarget.style.background = 'var(--bg-hover)';
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.background = 'var(--bg-overlay)';
        }}
        onFocus={(event) => {
          event.currentTarget.style.outline = '2px solid var(--accent)';
          event.currentTarget.style.outlineOffset = '2px';
        }}
        onBlur={(event) => {
          event.currentTarget.style.outline = 'none';
        }}
        style={CHIP_STYLE}
      >
        <span
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'var(--accent)',
            animation: 'background-task-chip-pulse 1.6s ease-in-out infinite',
          }}
        />
        {label}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="后台任务快速处理"
          data-testid="background-task-chip-popover"
          style={POPOVER_STYLE}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <span style={{ fontSize: 11.5, fontWeight: 650, color: 'var(--fg-strong)' }}>
              {detail}
            </span>
            {runningSubagents > 0 ? (
              <ChipAction
                label="全部停止"
                testId="background-task-chip-stop-all"
                tone="danger"
                onClick={() => setPendingConfirm({ kind: 'stop-all', count: runningSubagents })}
              />
            ) : null}
          </div>

          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
            {activeRows.slice(0, 6).map((row) => {
              const sessionId = row.sessionId?.trim() ?? '';
              const terminalId = row.terminalId?.trim() ?? '';
              const stopping = sessionId.length > 0 && stoppingSubAgentIds.has(sessionId);
              const killing = terminalId.length > 0 && pendingKillIds.has(terminalId);
              return (
                <li
                  key={row.key}
                  data-kind={row.kind}
                  data-state={row.state}
                  data-testid="background-task-chip-row"
                  style={ROW_STYLE}
                >
                  <StatusDot row={row} />
                  <span style={ROW_TITLE_STYLE} title={row.title}>
                    {row.title}
                  </span>
                  <span style={ROW_DETAIL_STYLE}>
                    {row.kind === 'subagent' ? (row.agent ? `@${row.agent}` : '') : (row.cwd ?? '')}
                  </span>
                  {row.kind === 'subagent' ? (
                    <>
                      <ChipAction
                        label="打开"
                        testId="background-task-chip-row-open-session"
                        disabled={sessionId.length === 0}
                        onClick={() => {
                          if (sessionId.length > 0) {
                            onOpenSession(sessionId);
                            setOpen(false);
                          }
                        }}
                      />
                      <ChipAction
                        label={stopping ? '停止中' : '停止'}
                        testId="background-task-chip-row-stop"
                        tone="danger"
                        disabled={stopping || sessionId.length === 0}
                        onClick={() => {
                          if (sessionId.length > 0) {
                            setPendingConfirm({
                              kind: 'stop-subagent',
                              sessionId,
                              title: row.title,
                            });
                          }
                        }}
                      />
                    </>
                  ) : (
                    <>
                      <ChipAction
                        label="查看"
                        testId="background-task-chip-row-preview-terminal"
                        disabled={terminalId.length === 0}
                        onClick={() => {
                          if (terminalId.length > 0) {
                            onPreviewTerminal(terminalId);
                            setOpen(false);
                          }
                        }}
                      />
                      <ChipAction
                        label={killing ? '终止中' : '终止'}
                        testId="background-task-chip-row-kill-terminal"
                        tone="danger"
                        disabled={killing || terminalId.length === 0}
                        onClick={() => {
                          if (terminalId.length > 0) {
                            setPendingConfirm({
                              kind: 'kill-shell',
                              terminalId,
                              command: row.command ?? row.title,
                            });
                          }
                        }}
                      />
                    </>
                  )}
                </li>
              );
            })}
          </ul>

          {activeRows.length > 6 ? (
            <span style={{ fontSize: 10.5, color: 'var(--fg-muted)', textAlign: 'center' }}>
              另有 {activeRows.length - 6} 项，打开面板查看全部
            </span>
          ) : null}

          <ChipAction
            label="打开后台面板"
            testId="background-task-chip-open-panel"
            onClick={() => {
              close();
              onOpenPanel();
            }}
          />
        </div>
      ) : null}

      <style>{`
        @keyframes background-task-chip-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
        @media (prefers-reduced-motion: reduce) {
          [data-testid="background-task-chip"] span[aria-hidden='true'] { animation: none !important; }
        }
      `}</style>

      <BackgroundTaskConfirmDialog
        pending={pendingConfirm}
        onConfirm={handleConfirm}
        onDismiss={() => setPendingConfirm(null)}
      />
    </div>
  );
}
