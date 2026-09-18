/**
 * TeamLayerTodoWorkbench · 经典 Team 对话右侧工作台壳组件
 *
 * Props 驱动的纯 UI 组件（classic-only：仅由 ClassicTeamLayerTodoSidePanel 挂载）：
 *   - 顶 tab：任务(count) / 概览 / 度量 / 治理(count)
 *   - tasks tab：layer 概要 + LayerRail + RoleStrip + 左右分栏(todo 列表在左 / 选中明细在右)
 *   - 其它 tab：渲染对应 slot，无 slot 时展示「内容接入中」
 */

import {
  useRef,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
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

const bodyStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
};

/**
 * 过滤区行内标签（层级 / 角色）与内容筛选行的视觉态全部下沉到
 * `team-workbench-controls.css`（classic 作用域），组件只保留布局。
 */

const splitStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'grid',
  // 左右分栏：todo 列表在左、选中明细在右，一屏同时可见列表与详情；
  // 左列带最小宽度（窄面板下不再被明细挤压），右列自适应吃掉剩余宽度。
  gridTemplateColumns: 'minmax(216px, 0.32fr) minmax(0, 1fr)',
  gap: 0,
  overflow: 'hidden',
};

const listColumnStyle: CSSProperties = {
  minWidth: 0,
  minHeight: 0,
  overflow: 'hidden',
  padding: 0,
  borderRight: '1px solid var(--border-default)',
  display: 'flex',
  flexDirection: 'column',
};

const detailColumnStyle: CSSProperties = {
  minWidth: 0,
  minHeight: 0,
  overflow: 'hidden',
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
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

/**
 * 层级统计（过滤区标题行右侧）：共 N 层 · 运行 n · 失败 n。
 * 原先独立占一条横条，现降级为过滤区头部的弱信息，与「层级」标签同行。
 */
function layerStatsNode(layers: readonly TeamLayerRailLayer[]): ReactNode {
  const running = layers.filter((l) => l.state === 'running').length;
  const failed = layers.filter((l) => l.state === 'failed').length;

  return (
    <>
      <span>
        共 <strong>{layers.length}</strong> 层
      </span>
      {running > 0 ? (
        <span>
          <span
            className="team-wb-stat-dot"
            style={{ background: 'var(--success)' }}
            aria-hidden="true"
          />
          运行 {running}
        </span>
      ) : null}
      {failed > 0 ? (
        <span>
          <span
            className="team-wb-stat-dot"
            style={{ background: 'var(--warning)' }}
            aria-hidden="true"
          />
          失败 {failed}
        </span>
      ) : null}
    </>
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
  const tabBarRef = useRef<HTMLDivElement>(null);

  /**
   * 键盘方向键在工作台 tab 间切换（配合 roving tabindex：仅激活 tab 可 Tab 聚焦，
   * 其余靠 ← → / Home / End 移动），切换后焦点跟随到新激活 tab。
   */
  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const keys = TAB_DEFS.map((def) => def.key);
    if (keys.length === 0) return;
    const currentIndex = Math.max(keys.indexOf(tab), 0);
    let nextIndex = -1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (currentIndex + 1) % keys.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (currentIndex - 1 + keys.length) % keys.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = keys.length - 1;
    }
    if (nextIndex < 0) return;
    event.preventDefault();
    const nextKey = keys[nextIndex];
    if (nextKey === undefined) return;
    if (nextKey !== tab) {
      onTabChange(nextKey);
    }
    requestAnimationFrame(() => {
      tabBarRef.current
        ?.querySelector<HTMLButtonElement>(`[data-workbench-tab="${nextKey}"]`)
        ?.focus();
    });
  };

  return (
    <div
      style={shellStyle}
      className={['team-layer-todo-workbench', className].filter(Boolean).join(' ')}
      role="region"
      aria-label="工作台"
    >
      {/* ── tab bar（L1 主导航：下划线 tab，样式见 team-workbench-controls.css）── */}
      <div
        ref={tabBarRef}
        className="team-wb-nav"
        role="tablist"
        aria-label="工作台选项卡"
        onKeyDown={handleTabKeyDown}
      >
        {TAB_DEFS.map((def) => {
          const isActive = tab === def.key;
          const count = def.countKey != null ? counts?.[def.countKey] : undefined;
          const failCount = def.failKey != null ? counts?.[def.failKey] : undefined;

          return (
            <button
              key={def.key}
              type="button"
              role="tab"
              id={`workbench-tab-${def.key}`}
              data-workbench-tab={def.key}
              aria-controls={`workbench-panel-${def.key}`}
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              className="team-wb-nav-tab"
              onClick={() => onTabChange(def.key)}
            >
              {def.label}
              {count != null && count > 0 && (
                <span
                  className="team-wb-nav-badge"
                  data-tone={failCount && failCount > 0 ? 'warning' : undefined}
                >
                  {count}
                </span>
              )}
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
            {/* L2 过滤区：层级 / 角色（与主 tab 导航分层的独立区块） */}
            <div className="team-wb-filter-zone">
              <div className="team-wb-filter-head">
                <span className="team-wb-filter-label">层级</span>
                <span className="team-wb-filter-stats" aria-label="层概要">
                  {layerStatsNode(layers)}
                </span>
              </div>
              <TeamLayerRail
                layers={layers}
                activeLayerId={activeLayerId}
                onSelect={onSelectLayer}
              />
              <div className="team-wb-filter-roles">
                <span className="team-wb-filter-label">角色</span>
                <TeamRoleStrip roles={roles} activeRoleId={activeRoleId} onSelect={onSelectRole} />
              </div>
            </div>

            {/* split: 左列 todo 列表 / 右列选中明细（左右并排，一屏同见） */}
            <div style={splitStyle} data-team-workbench-split="list-detail">
              <div style={listColumnStyle}>
                <TeamTodoListPanel
                  todos={todos}
                  activeTodoId={activeTodoId}
                  filter={todoFilter}
                  onFilterChange={onTodoFilterChange}
                  onSelectTodo={onSelectTodo}
                />
              </div>
              <div style={detailColumnStyle}>
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
