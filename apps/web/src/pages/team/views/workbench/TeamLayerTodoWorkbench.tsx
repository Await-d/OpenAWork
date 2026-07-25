/**
 * TeamLayerTodoWorkbench · 经典 Team 对话右侧工作台壳组件
 *
 * Props 驱动的纯 UI 组件：
 *   - 顶 tab：任务(count) / 概览 / 度量 / 治理(count)
 *   - tasks tab：layer 概要 + LayerRail + RoleStrip + 上下分栏(todo list ~30% / detail ~70%)
 *   - 其它 tab：渲染对应 slot，无 slot 时展示「内容接入中」
 */

import type { CSSProperties, ReactNode } from 'react';
import { TeamLayerRail, type TeamLayerRailLayer } from './TeamLayerRail.js';
import { TeamRoleStrip, type TeamRoleStripRole } from './TeamRoleStrip.js';
import {
  TeamTodoListPanel,
  type TodoFilterKey,
  type TeamTodoListItem,
} from './TeamTodoListPanel.js';
import {
  TeamTodoDetailStream,
  type MsgFilterKey,
  type TeamTodoDetailStreamTodo,
  type TeamTodoDetailMessage,
} from './TeamTodoDetailStream.js';

/* ─── props ─── */

export type WorkbenchTab = 'tasks' | 'overview' | 'metrics' | 'governance';

export interface TeamLayerTodoWorkbenchProps {
  readonly tab: WorkbenchTab;
  readonly onTabChange: (tab: WorkbenchTab) => void;

  readonly layers: readonly TeamLayerRailLayer[];
  readonly activeLayerId: string | null;
  readonly onSelectLayer: (layerId: string) => void;

  readonly roles: readonly TeamRoleStripRole[];
  readonly activeRoleId: 'all' | string;
  readonly onSelectRole: (roleId: 'all' | string) => void;

  readonly todos: readonly TeamTodoListItem[];
  readonly activeTodoId: string | null;
  readonly todoFilter: TodoFilterKey;
  readonly onTodoFilterChange: (filter: TodoFilterKey) => void;
  readonly onSelectTodo: (todoId: string) => void;

  readonly detailTodo?: TeamTodoDetailStreamTodo | null;
  readonly detailMessages?: readonly TeamTodoDetailMessage[];
  readonly msgFilter?: MsgFilterKey;
  readonly onMsgFilterChange?: (filter: MsgFilterKey) => void;

  readonly counts?: {
    readonly tasks?: number;
    readonly failTasks?: number;
    readonly govPending?: number;
  };

  readonly overviewSlot?: ReactNode;
  readonly metricsSlot?: ReactNode;
  readonly governanceSlot?: ReactNode;

  readonly className?: string;
}

/* ─── tab definitions ─── */

interface TabDef {
  readonly key: WorkbenchTab;
  readonly label: string;
  readonly countKey?: 'tasks' | 'govPending';
  readonly failKey?: 'failTasks';
}

const TAB_DEFS: readonly TabDef[] = [
  { key: 'tasks', label: '任务', countKey: 'tasks', failKey: 'failTasks' },
  { key: 'overview', label: '概览' },
  { key: 'metrics', label: '度量' },
  { key: 'governance', label: '治理', countKey: 'govPending' },
];

/* ─── styles ─── */

const shellStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 0,
  overflow: 'hidden',
  background: 'var(--bg-raised, var(--bg-overlay))',
  color: 'var(--fg-default)',
};

const tabBarStyle: CSSProperties = {
  display: 'flex',
  gap: 0,
  alignItems: 'stretch',
  minHeight: 28,
  borderBottom: '1px solid var(--border-default)',
  flexShrink: 0,
  padding: 0,
  background: 'var(--bg-base)',
};

function tabBtnStyle(isActive: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    minHeight: 28,
    padding: '0 11px',
    border: 'none',
    borderRight: '1px solid var(--border-default)',
    borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
    background: 'transparent',
    color: isActive ? 'var(--fg-strong, var(--fg-default))' : 'var(--fg-muted)',
    fontSize: 11,
    fontWeight: 650,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };
}

const badgeStyle = (tone: string): CSSProperties => ({
  fontSize: 10,
  padding: '0 5px',
  borderRadius: 0,
  background: tone === 'var(--fg-subtle)' ? 'var(--bg-elevated)' : tone,
  color: tone === 'var(--fg-subtle)' ? 'var(--fg-muted)' : '#fff',
  fontWeight: 700,
  lineHeight: '14px',
  fontVariantNumeric: 'tabular-nums',
});

const bodyStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
};

const railRowStyle: CSSProperties = {
  padding: '0',
  borderBottom: '1px solid var(--border-default)',
  flexShrink: 0,
};

const roleRowStyle: CSSProperties = {
  padding: '0',
  borderBottom: '1px solid var(--border-default)',
  flexShrink: 0,
};

const splitStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'grid',
  gridTemplateRows: 'minmax(108px, 0.30fr) minmax(0, 1.70fr)',
  gap: 0,
  overflow: 'hidden',
};

const upperPane: CSSProperties = {
  minHeight: 0,
  overflow: 'hidden',
  padding: 0,
  borderBottom: '1px solid var(--border-default)',
  display: 'flex',
  flexDirection: 'column',
};

const lowerPane: CSSProperties = {
  minHeight: 0,
  overflow: 'hidden',
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
};

const summaryLine: CSSProperties = {
  fontSize: 10.5,
  color: 'var(--fg-faint, var(--fg-subtle))',
  padding: '4px 10px',
  flexShrink: 0,
  display: 'flex',
  gap: 10,
  alignItems: 'center',
  borderBottom: '1px solid color-mix(in srgb, var(--border-default) 70%, transparent)',
  background: 'var(--bg-base)',
};

const dotSmall: CSSProperties = {
  display: 'inline-block',
  width: 5,
  height: 5,
  borderRadius: '50%',
  verticalAlign: 'middle',
};

const emptySlot: CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 13,
  color: 'var(--fg-subtle)',
};

/* ─── helpers ─── */

function layerSummary(layers: readonly TeamLayerRailLayer[]): ReactNode {
  const running = layers.filter((l) => l.state === 'running').length;
  const failed = layers.filter((l) => l.state === 'failed').length;
  const total = layers.length;

  return (
    <span style={summaryLine} aria-label="层概要">
      <span>
        共 <strong>{total}</strong> 层
      </span>
      {running > 0 && (
        <span>
          <span style={{ ...dotSmall, background: 'var(--success)' }} aria-hidden="true" /> 运行{' '}
          {running}
        </span>
      )}
      {failed > 0 && (
        <span>
          <span style={{ ...dotSmall, background: 'var(--warning)' }} aria-hidden="true" /> 失败{' '}
          {failed}
        </span>
      )}
    </span>
  );
}

/* ─── component ─── */

export function TeamLayerTodoWorkbench({
  tab,
  onTabChange,
  layers,
  activeLayerId,
  onSelectLayer,
  roles,
  activeRoleId,
  onSelectRole,
  todos,
  activeTodoId,
  todoFilter,
  onTodoFilterChange,
  onSelectTodo,
  detailTodo = null,
  detailMessages = [],
  msgFilter,
  onMsgFilterChange,
  counts,
  overviewSlot,
  metricsSlot,
  governanceSlot,
  className,
}: TeamLayerTodoWorkbenchProps) {
  const resolvedDetailTodo = detailTodo ?? resolveDetailTodo(todos, activeTodoId);

  return (
    <div
      style={shellStyle}
      className={['team-layer-todo-workbench', className].filter(Boolean).join(' ')}
      role="region"
      aria-label="工作台"
    >
      {/* ── tab bar ── */}
      <div role="tablist" aria-label="工作台选项卡" style={tabBarStyle}>
        {TAB_DEFS.map((def) => {
          const isActive = tab === def.key;
          const count = def.countKey != null ? counts?.[def.countKey] : undefined;
          const failCount = def.failKey != null ? counts?.[def.failKey] : undefined;
          const tone = failCount && failCount > 0 ? 'var(--warning)' : 'var(--fg-subtle)';

          return (
            <button
              key={def.key}
              type="button"
              role="tab"
              id={`workbench-tab-${def.key}`}
              aria-controls={`workbench-panel-${def.key}`}
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              style={tabBtnStyle(isActive)}
              onClick={() => onTabChange(def.key)}
            >
              {def.label}
              {count != null && count > 0 && <span style={badgeStyle(tone)}>{count}</span>}
            </button>
          );
        })}
      </div>

      {/* ── body ── */}
      <div style={bodyStyle}>
        {tab === 'tasks' && (
          <div
            role="tabpanel"
            id="workbench-panel-tasks"
            aria-labelledby="workbench-tab-tasks"
            style={{ ...bodyStyle, overflow: 'hidden' }}
          >
            {/* layer summary */}
            <div style={railRowStyle}>{layerSummary(layers)}</div>

            {/* layer rail */}
            <div style={railRowStyle}>
              <TeamLayerRail
                layers={layers}
                activeLayerId={activeLayerId}
                onSelect={onSelectLayer}
              />
            </div>

            {/* role strip */}
            <div style={roleRowStyle}>
              <TeamRoleStrip roles={roles} activeRoleId={activeRoleId} onSelect={onSelectRole} />
            </div>

            {/* split: todo list / detail */}
            <div style={splitStyle}>
              <div style={upperPane}>
                <TeamTodoListPanel
                  todos={todos}
                  activeTodoId={activeTodoId}
                  filter={todoFilter}
                  onFilterChange={onTodoFilterChange}
                  onSelectTodo={onSelectTodo}
                />
              </div>
              <div style={lowerPane}>
                <TeamTodoDetailStream
                  todo={resolvedDetailTodo}
                  messages={detailMessages}
                  msgFilter={msgFilter}
                  onMsgFilterChange={onMsgFilterChange}
                />
              </div>
            </div>
          </div>
        )}

        {tab === 'overview' && (
          <div
            role="tabpanel"
            id="workbench-panel-overview"
            aria-labelledby="workbench-tab-overview"
            style={emptySlot}
          >
            {overviewSlot ?? '内容接入中'}
          </div>
        )}

        {tab === 'metrics' && (
          <div
            role="tabpanel"
            id="workbench-panel-metrics"
            aria-labelledby="workbench-tab-metrics"
            style={emptySlot}
          >
            {metricsSlot ?? '内容接入中'}
          </div>
        )}

        {tab === 'governance' && (
          <div
            role="tabpanel"
            id="workbench-panel-governance"
            aria-labelledby="workbench-tab-governance"
            style={emptySlot}
          >
            {governanceSlot ?? '内容接入中'}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── local helper ─── */

function resolveDetailTodo(
  todos: readonly TeamTodoListItem[],
  activeTodoId: string | null,
): TeamTodoDetailStreamTodo | null {
  if (!activeTodoId) return null;
  const t = todos.find((item) => item.id === activeTodoId);
  if (!t) return null;
  return {
    id: t.id,
    key: t.key,
    title: t.title,
    status: t.status,
  };
}
