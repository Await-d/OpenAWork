/**
 * 终端列表的筛选与批量处置工具栏。
 *
 * 会话终端在两处出现：顶栏 chip 的 popover（`SessionTerminalsPanel`）
 * 和 fusion 布局右侧面板的 terminals tab（`RightPanelTerminalsContent`）。
 * 状态筛选、关键字过滤、批量终止 / 批量清理这三件事在两处是同一套语义，
 * 因此抽到这里，避免两份实现各自漂移。
 */

import { useCallback, useMemo, useState } from 'react';
import type { SessionTerminalView } from '../../conversation-runtime/terminals/terminals-api.js';

/** 状态筛选维度：全部 / 仅活跃 / 仅已结束。 */
export type TerminalStatusFilter = 'all' | 'active' | 'closed';

export interface TerminalFilterState {
  statusFilter: TerminalStatusFilter;
  query: string;
}

const ACTIVE_STATUSES: ReadonlySet<string> = new Set(['running', 'tmux-spawned']);

/** 一条终端记录是否仍然活跃（有进程在跑）。 */
export function isActiveTerminal(terminal: SessionTerminalView): boolean {
  return ACTIVE_STATUSES.has(terminal.status);
}

/** 关键字是否命中一条终端记录（命令 / 别名 / 描述 / 工作目录）。 */
export function matchesTerminalQuery(terminal: SessionTerminalView, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  const haystacks = [terminal.command, terminal.name, terminal.description, terminal.cwd];
  return haystacks.some(
    (value) => typeof value === 'string' && value.toLowerCase().includes(needle),
  );
}

/** 按筛选状态过滤终端列表，保持调用方传入的顺序。 */
export function filterSessionTerminals(
  terminals: readonly SessionTerminalView[],
  filter: TerminalFilterState,
): SessionTerminalView[] {
  return terminals.filter((terminal) => {
    if (filter.statusFilter === 'active' && !isActiveTerminal(terminal)) return false;
    if (filter.statusFilter === 'closed' && isActiveTerminal(terminal)) return false;
    return matchesTerminalQuery(terminal, filter.query);
  });
}

export interface SessionTerminalFilterHandle extends TerminalFilterState {
  setStatusFilter: (value: TerminalStatusFilter) => void;
  setQuery: (value: string) => void;
  reset: () => void;
  /** 是否处于「有筛选条件」状态——空结果文案据此区分"没有数据"和"没匹配上"。 */
  isFiltering: boolean;
}

/** 筛选状态的受控 hook，供两个终端列表复用。 */
export function useSessionTerminalFilter(): SessionTerminalFilterHandle {
  const [statusFilter, setStatusFilter] = useState<TerminalStatusFilter>('all');
  const [query, setQuery] = useState('');
  const reset = useCallback(() => {
    setStatusFilter('all');
    setQuery('');
  }, []);
  const isFiltering = statusFilter !== 'all' || query.trim().length > 0;
  return useMemo(
    () => ({ statusFilter, query, setStatusFilter, setQuery, reset, isFiltering }),
    [statusFilter, query, reset, isFiltering],
  );
}

export interface TerminalListToolbarProps {
  totalCount: number;
  activeCount: number;
  closedCount: number;
  filter: SessionTerminalFilterHandle;
  /** 批量终止全部活跃终端；存在活跃终端时按钮才出现。 */
  onKillAllActive?: (() => void | Promise<void>) | undefined;
  /** 批量清理全部已结束终端；存在已结束记录时按钮才出现。 */
  onCleanupAllClosed?: (() => void | Promise<void>) | undefined;
  /**
   * 批量按钮实际作用的目标数量。筛选生效时小于 `activeCount` /
   * `closedCount`——按钮文案与动作必须一致，否则用户会以为"只杀这一条"
   * 却把整个会话的终端都杀了。
   */
  batchActiveCount?: number;
  batchCleanupCount?: number;
  /** 批量操作进行中：两个按钮都置灰，避免重复触发。 */
  busy?: boolean;
  /** 紧凑模式：右侧面板空间窄，省略按钮上的计数后缀。 */
  compact?: boolean;
}

const FILTER_OPTIONS: ReadonlyArray<{ value: TerminalStatusFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'active', label: '运行中' },
  { value: 'closed', label: '已结束' },
];

export function TerminalListToolbar({
  totalCount,
  activeCount,
  closedCount,
  filter,
  onKillAllActive,
  onCleanupAllClosed,
  batchActiveCount,
  batchCleanupCount,
  busy = false,
  compact = false,
}: TerminalListToolbarProps) {
  const countByFilter: Record<TerminalStatusFilter, number> = {
    all: totalCount,
    active: activeCount,
    closed: closedCount,
  };
  // 批量按钮的目标数量：默认跟随总数，调用方在筛选生效时传入可见数量。
  const killTargets = batchActiveCount ?? activeCount;
  const cleanupTargets = batchCleanupCount ?? closedCount;
  const showBatchRow =
    (killTargets > 0 && onKillAllActive !== undefined) ||
    (cleanupTargets > 0 && onCleanupAllClosed !== undefined);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 6 : 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {FILTER_OPTIONS.map((option) => {
          const selected = filter.statusFilter === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              onClick={() => filter.setStatusFilter(option.value)}
              style={{
                fontSize: 11,
                padding: compact ? '2px 8px' : '3px 9px',
                borderRadius: 9999,
                cursor: 'pointer',
                border: selected
                  ? '1px solid color-mix(in srgb, var(--accent) 60%, transparent)'
                  : '1px solid var(--border-subtle)',
                background: selected
                  ? 'color-mix(in srgb, var(--accent) 16%, transparent)'
                  : 'transparent',
                color: selected ? 'var(--accent)' : 'var(--fg-default)',
              }}
            >
              {compact ? option.label : `${option.label} ${countByFilter[option.value]}`}
            </button>
          );
        })}
        <input
          type="search"
          value={filter.query}
          onChange={(event) => filter.setQuery(event.target.value)}
          placeholder="按命令 / 目录过滤…"
          aria-label="按命令或目录过滤终端"
          style={{
            flex: 1,
            minWidth: 110,
            fontSize: 11,
            padding: compact ? '2px 7px' : '3px 8px',
            borderRadius: 6,
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-base)',
            color: 'var(--fg-strong)',
          }}
        />
      </div>
      {showBatchRow ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {killTargets > 0 && onKillAllActive ? (
            <button
              type="button"
              disabled={busy}
              title={
                killTargets === activeCount
                  ? `终止当前会话中全部 ${killTargets} 个运行中的终端`
                  : `终止当前筛选结果中的 ${killTargets} 个运行中终端（会话共 ${activeCount} 个）`
              }
              onClick={() => {
                void onKillAllActive();
              }}
              style={{
                fontSize: 11,
                padding: compact ? '2px 8px' : '3px 9px',
                borderRadius: 6,
                border: '1px solid color-mix(in srgb, var(--danger) 50%, transparent)',
                background: 'color-mix(in srgb, var(--danger) 12%, transparent)',
                color: 'var(--danger)',
                cursor: busy ? 'wait' : 'pointer',
                opacity: busy ? 0.6 : 1,
              }}
            >
              终止全部运行中{compact ? '' : `（${killTargets}）`}
            </button>
          ) : null}
          {cleanupTargets > 0 && onCleanupAllClosed ? (
            <button
              type="button"
              disabled={busy}
              title={
                cleanupTargets === closedCount
                  ? `清理当前会话中全部 ${cleanupTargets} 条已结束记录`
                  : `清理当前筛选结果中的 ${cleanupTargets} 条已结束记录（会话共 ${closedCount} 条）`
              }
              onClick={() => {
                void onCleanupAllClosed();
              }}
              style={{
                fontSize: 11,
                padding: compact ? '2px 8px' : '3px 9px',
                borderRadius: 6,
                border: '1px solid var(--border-subtle)',
                background: 'transparent',
                color: 'var(--fg-muted)',
                cursor: busy ? 'wait' : 'pointer',
                opacity: busy ? 0.6 : 1,
              }}
            >
              清理全部已结束{compact ? '' : `（${cleanupTargets}）`}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** 筛选后无结果的统一空状态，带一键清除筛选。 */
export function TerminalListNoMatch({ onReset }: { onReset: () => void }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        alignItems: 'center',
        padding: '14px 0',
        fontSize: 11,
        color: 'var(--fg-muted)',
      }}
    >
      <span>没有符合当前筛选条件的终端。</span>
      <button
        type="button"
        onClick={onReset}
        style={{
          fontSize: 11,
          border: '1px solid var(--border-subtle)',
          background: 'transparent',
          color: 'var(--fg-default)',
          padding: '3px 10px',
          borderRadius: 6,
          cursor: 'pointer',
        }}
      >
        清除筛选
      </button>
    </div>
  );
}
