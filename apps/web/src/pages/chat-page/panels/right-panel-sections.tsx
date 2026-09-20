import React from 'react';
import type { PendingPermissionRequest, Session, SessionTask } from '@openAwork/web-client';
import { PlanHistoryPanel } from '@openAwork/shared-ui';
import type { AlwaysScopeLevel, HistoricalPlan } from '@openAwork/shared-ui';
import { copyTextToClipboard } from '../../../components/layout/file-tree/file-tree-actions.js';
import {
  buildUpstreamSummaryGroupContextText,
  findUpstreamSummaryGroupByKey,
  formatCompactionCauseLabel,
  formatCompactionShortLabel,
  formatUpstreamSummaryGroupHeadline,
  formatUpstreamSummaryMetricLine,
  formatUpstreamSummaryStatusLabel,
  groupUpstreamSummariesByRequest,
  splitSessionTodosByLane,
  summarizeUpstreamSummaryGroupCounts,
  type CompactionItem,
  type SessionTodoItem,
  type UpstreamSummaryItem,
  type UpstreamSummaryRequestGroup,
} from './chat-overview-model.js';

// 概览正文已抽到独立文件（含其专属 helper）；这里保留同名再导出，经典右栏
// (`chat-right-panel.tsx`) 与测试仍可从 `right-panel-sections.js` 取到。
export { ChatOverviewTabContent } from './chat-overview-tab-content.js';
export type {
  ChatOverviewRuntimeSummary,
  ChatOverviewTabContentProps,
} from './chat-overview-tab-content.js';
export {
  buildUpstreamSummaryGroupContextText,
  findUpstreamSummaryGroupByKey,
  formatUpstreamSummaryGroupHeadline,
  formatUpstreamSummaryMetricLine,
  formatUpstreamSummaryStatusLabel,
  groupUpstreamSummariesByRequest,
  summarizeUpstreamSummaryGroupCounts,
  type UpstreamSummaryGroupCounts,
  type UpstreamSummaryItem,
  type UpstreamSummaryRequestGroup,
} from './chat-overview-model.js';

type HierarchicalSessionTask = SessionTask & {
  completedSubtaskCount?: number;
  depth?: number;
  readySubtaskCount?: number;
  subtaskCount?: number;
  unmetDependencyCount?: number;
};

const PANEL_SECTION_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '8px 10px',
  borderRadius: 10,
  border: '1px solid color-mix(in oklch, var(--border-default) 84%, transparent)',
  background: 'var(--bg-overlay)',
};

const PANEL_SECTION_LABEL_STYLE: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--fg-default)',
  lineHeight: 1.25,
};

const PANEL_SECTION_EYEBROW_STYLE: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--fg-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};

function formatSessionTodoStatus(todo: SessionTodoItem): string {
  if (todo.status === 'in_progress') {
    return '进行中';
  }
  if (todo.status === 'completed') {
    return '已完成';
  }
  if (todo.status === 'cancelled') {
    return '已取消';
  }
  return '待开始';
}

function getSessionTodoBadgeTone(todo: SessionTodoItem): {
  border: string;
  color: string;
  background: string;
} {
  if (todo.status === 'in_progress') {
    return {
      border: '1px solid color-mix(in srgb, var(--chart-7) 38%, var(--border-default))',
      color: 'var(--chart-7)',
      background: 'color-mix(in srgb, var(--chart-7) 10%, transparent)',
    };
  }
  if (todo.status === 'completed') {
    return {
      border: '1px solid color-mix(in srgb, var(--success) 40%, var(--border-default))',
      color: 'var(--success)',
      background: 'color-mix(in srgb, var(--success) 10%, transparent)',
    };
  }
  if (todo.status === 'cancelled') {
    return {
      border: '1px solid color-mix(in srgb, var(--warning) 45%, var(--border-default))',
      color: 'var(--warning)',
      background: 'color-mix(in srgb, var(--warning) 10%, transparent)',
    };
  }
  return {
    border: '1px solid var(--border-default)',
    color: 'var(--fg-muted)',
    background: 'var(--bg-overlay)',
  };
}

function getSessionTodoPriorityLabel(todo: SessionTodoItem): string {
  if (todo.priority === 'high') return '高优先级';
  if (todo.priority === 'medium') return '中优先级';
  return '低优先级';
}

function formatTaskTimeoutSourceLabel(timeoutSource: SessionTask['timeoutSource']): string {
  return timeoutSource === 'first_response' ? '首响应未到' : '执行超时';
}

function formatSessionTaskTimeoutText(task: HierarchicalSessionTask): string {
  if (task.terminalReason !== 'timeout') {
    return task.terminalReason ?? '';
  }

  return task.timeoutSource
    ? `子任务执行超时（${formatTaskTimeoutSourceLabel(task.timeoutSource)}）`
    : '子任务执行超时';
}

function formatSessionTaskStatus(task: HierarchicalSessionTask): string {
  if ((task.subtaskCount ?? 0) > 0) {
    const completed = task.completedSubtaskCount ?? 0;
    const total = task.subtaskCount ?? 0;
    const ready = task.readySubtaskCount ?? 0;
    if (task.status === 'completed') {
      return `计划已完成 · ${completed}/${total} 已同步子项`;
    }
    if (ready > 0) {
      return `计划推进中 · ${completed}/${total} 已同步子项完成 · ${ready} 项可执行`;
    }
    return `计划推进中 · ${completed}/${total} 已同步子项完成`;
  }
  if ((task.unmetDependencyCount ?? 0) > 0 && task.status === 'pending') {
    return `等待前置依赖 · ${task.unmetDependencyCount} 项未就绪`;
  }
  if (task.status === 'running') {
    return '进行中';
  }
  if (task.status === 'completed') {
    return '已完成';
  }
  if (task.status === 'failed') {
    return task.terminalReason === 'timeout'
      ? task.timeoutSource
        ? `执行超时 · ${formatTaskTimeoutSourceLabel(task.timeoutSource)}`
        : '执行超时'
      : '执行失败';
  }
  if (task.status === 'cancelled') {
    return '已取消';
  }
  return '待开始';
}

type UpstreamSummaryFilter = 'all' | 'error' | 'stalled' | 'tool' | 'cancelled';

function matchesUpstreamSummaryFilter(
  item: UpstreamSummaryItem,
  filter: UpstreamSummaryFilter,
): boolean {
  if (filter === 'all') return true;
  if (filter === 'error') return item.summary.sawError || item.summary.stopReason === 'error';
  if (filter === 'stalled') return item.summary.stalled;
  if (filter === 'tool')
    return item.summary.stopReason === 'tool_use' || item.summary.toolCallDeltaCount > 0;
  return item.summary.stopReason === 'cancelled';
}

function matchesUpstreamSummaryQuery(item: UpstreamSummaryItem, query: string): boolean {
  const keyword = query.trim().toLowerCase();
  if (keyword.length === 0) return true;
  return [
    item.requestId,
    item.runId,
    formatUpstreamSummaryStatusLabel(item.summary),
    formatUpstreamSummaryMetricLine(item.summary),
  ].some((field) =>
    String(field ?? '')
      .toLowerCase()
      .includes(keyword),
  );
}

export function ChatHistoryTabContent(props: {
  childSessions: Session[];
  compactions: CompactionItem[];
  upstreamSummaries: UpstreamSummaryItem[];
  focusedUpstreamGroupKey?: string | null;
  onSelectUpstreamGroup?: (groupKey: string | null) => void;
  pendingPermissions: PendingPermissionRequest[];
  resolveInlinePermissionActions?: (requestId: string) =>
    | {
        errorMessage?: string;
        helperMessage?: string;
        items: Array<{
          danger?: boolean;
          disabled?: boolean;
          hint?: string;
          id: string;
          label: string;
          onClick: () => void;
          primary?: boolean;
        }>;
        pendingLabel?: string;
        scopeLevels?: AlwaysScopeLevel[];
        selectedScopeCategory?: AlwaysScopeLevel['category'];
        selectedScopePattern?: string;
        onSelectScopeLevel?: (level: AlwaysScopeLevel) => void;
      }
    | undefined;
  planHistory: HistoricalPlan[];
  sessionTodos: SessionTodoItem[];
  sessionTasks: HierarchicalSessionTask[];
  onOpenSession: (sessionId: string) => void;
  sharedUiThemeVars: React.CSSProperties;
}) {
  const {
    childSessions,
    compactions,
    upstreamSummaries,
    focusedUpstreamGroupKey = null,
    onSelectUpstreamGroup,
    pendingPermissions,
    resolveInlinePermissionActions,
    planHistory,
    sessionTodos,
    sessionTasks,
    onOpenSession,
    sharedUiThemeVars,
  } = props;
  const { mainTodos, tempTodos } = splitSessionTodosByLane(sessionTodos);

  const hasChildSessions = childSessions.length > 0;
  const hasSessionTasks = sessionTasks.length > 0;
  const hasCompactions = compactions.length > 0;
  const hasUpstreamSummaries = upstreamSummaries.length > 0;
  const hasPendingPermissions = pendingPermissions.length > 0;
  const hasMainTodos = mainTodos.length > 0;
  const hasTempTodos = tempTodos.length > 0;
  const [upstreamFilter, setUpstreamFilter] = React.useState<UpstreamSummaryFilter>('all');
  const [upstreamQuery, setUpstreamQuery] = React.useState('');
  const [collapsedUpstreamGroups, setCollapsedUpstreamGroups] = React.useState<
    Record<string, boolean>
  >({});
  const filteredUpstreamSummaries = upstreamSummaries.filter(
    (item) =>
      matchesUpstreamSummaryFilter(item, upstreamFilter) &&
      matchesUpstreamSummaryQuery(item, upstreamQuery),
  );
  const groupedUpstreamSummaries = groupUpstreamSummariesByRequest(filteredUpstreamSummaries);
  const handleCopyUpstreamGroupContext = (group: UpstreamSummaryRequestGroup) => {
    const fullGroup = findUpstreamSummaryGroupByKey(upstreamSummaries, group.key) ?? group;
    void copyTextToClipboard(buildUpstreamSummaryGroupContextText(fullGroup));
  };

  return (
    <div style={{ ...sharedUiThemeVars, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {(hasChildSessions || hasSessionTasks) && (
        <div style={PANEL_SECTION_STYLE}>
          {hasChildSessions && (
            <>
              <div style={PANEL_SECTION_EYEBROW_STYLE}>子会话</div>
              {childSessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => onOpenSession(session.id)}
                  className="ui-hover-surface"
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    border: 'none',
                    borderRadius: 8,
                    background: 'var(--bg-overlay)',
                    color: 'var(--fg-strong)',
                    padding: '7px 9px',
                    cursor: 'pointer',
                    fontSize: 12,
                    textDecoration: 'none',
                    lineHeight: 1.45,
                  }}
                >
                  {session.title ?? '未命名'} · {session.id.slice(0, 8)}…
                </button>
              ))}
            </>
          )}
          {hasChildSessions && hasSessionTasks && (
            <div
              style={{
                margin: '6px 0',
                borderTop: '1px solid color-mix(in oklch, var(--border-default) 60%, transparent)',
              }}
            />
          )}
          {hasSessionTasks && (
            <>
              <div style={PANEL_SECTION_EYEBROW_STYLE}>任务状态</div>
              {sessionTasks.map((task) => (
                <div
                  key={task.id}
                  style={{
                    fontSize: 12,
                    color: 'var(--fg-strong)',
                    marginBottom: 3,
                    paddingLeft: (task.depth ?? 0) * 14,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                    <span
                      style={{
                        width: task.depth && task.depth > 0 ? 8 : 0,
                        height: 1,
                        background:
                          task.depth && task.depth > 0
                            ? 'color-mix(in srgb, var(--border-default) 88%, transparent)'
                            : 'transparent',
                        flexShrink: 0,
                      }}
                    />
                    <div style={{ fontWeight: 600 }}>{task.title}</div>
                    {task.assignedAgent && (
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 700,
                          lineHeight: 1,
                          padding: '1px 4px',
                          borderRadius: 999,
                          border:
                            '1px solid color-mix(in oklch, var(--accent) 24%, var(--border-default))',
                          color: 'color-mix(in oklch, var(--accent) 80%, var(--fg-muted))',
                          background: 'color-mix(in oklch, var(--accent) 10%, transparent)',
                        }}
                        title={task.assignedAgent}
                      >
                        ◈ {task.assignedAgent}
                      </span>
                    )}
                    {(task.subtaskCount ?? 0) > 0 && (
                      <span
                        style={{
                          fontSize: 10,
                          lineHeight: 1,
                          padding: '1px 4px',
                          borderRadius: 999,
                          border: '1px solid var(--border-default)',
                          color: 'var(--fg-muted)',
                          background: 'var(--bg-overlay)',
                        }}
                      >
                        {task.completedSubtaskCount ?? 0}/{task.subtaskCount ?? 0} 子项
                      </span>
                    )}
                    {(task.unmetDependencyCount ?? 0) > 0 && task.status === 'pending' && (
                      <span
                        style={{
                          fontSize: 10,
                          lineHeight: 1,
                          padding: '1px 4px',
                          borderRadius: 999,
                          border:
                            '1px solid color-mix(in srgb, var(--warning) 55%, var(--border-default))',
                          color: 'var(--warning)',
                          background: 'color-mix(in srgb, var(--warning) 10%, transparent)',
                        }}
                      >
                        等待前置
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      color: 'var(--fg-default)',
                      marginLeft: task.depth && task.depth > 0 ? 16 : 0,
                    }}
                  >
                    {formatSessionTaskStatus(task)}
                  </div>
                  {(task.errorMessage ?? task.result ?? task.terminalReason) && (
                    <div
                      style={{
                        marginTop: 2,
                        marginLeft: task.depth && task.depth > 0 ? 16 : 0,
                        fontSize: 10,
                        color:
                          task.errorMessage || task.terminalReason
                            ? 'var(--danger)'
                            : 'color-mix(in srgb, var(--success) 90%, var(--fg-muted))',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                      title={task.errorMessage ?? task.result ?? formatSessionTaskTimeoutText(task)}
                    >
                      {task.errorMessage
                        ? `✗ ${task.errorMessage}`
                        : task.result
                          ? `✓ ${task.result}`
                          : task.terminalReason
                            ? `✗ ${formatSessionTaskTimeoutText(task)}`
                            : ''}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      )}
      {(hasMainTodos || hasTempTodos) && (
        <div style={PANEL_SECTION_STYLE}>
          {hasMainTodos && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <div style={PANEL_SECTION_EYEBROW_STYLE}>主待办</div>
                <div
                  style={{
                    fontSize: 10,
                    lineHeight: 1,
                    padding: '2px 6px',
                    borderRadius: 999,
                    border: '1px solid var(--border-default)',
                    color: 'var(--fg-muted)',
                    background: 'var(--bg-overlay)',
                  }}
                >
                  {
                    mainTodos.filter((t) => t.status === 'pending' || t.status === 'in_progress')
                      .length
                  }
                  /{mainTodos.length}
                </div>
              </div>
              {mainTodos.map((todo, index) => {
                const tone = getSessionTodoBadgeTone(todo);
                return (
                  <div
                    key={`main-${todo.content}-${index}`}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 6,
                      padding: '4px 6px',
                      borderRadius: 7,
                      background: 'var(--bg-overlay)',
                    }}
                  >
                    <span
                      style={{
                        color: todo.status === 'completed' ? 'var(--success)' : 'var(--warning)',
                        lineHeight: '18px',
                      }}
                    >
                      {todo.status === 'completed'
                        ? '●'
                        : todo.status === 'in_progress'
                          ? '◐'
                          : '○'}
                    </span>
                    <div
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 11,
                        color: 'var(--fg-strong)',
                        fontWeight: 600,
                        lineHeight: 1.45,
                        textDecoration:
                          todo.status === 'completed' || todo.status === 'cancelled'
                            ? 'line-through'
                            : 'none',
                      }}
                    >
                      {todo.content}
                    </div>
                    <span
                      style={{
                        fontSize: 9,
                        lineHeight: 1.2,
                        padding: '1px 5px',
                        borderRadius: 999,
                        ...tone,
                      }}
                    >
                      {formatSessionTodoStatus(todo)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {hasMainTodos && hasTempTodos && (
            <div
              style={{
                margin: '6px 0',
                borderTop: '1px solid color-mix(in oklch, var(--border-default) 60%, transparent)',
              }}
            />
          )}
          {hasTempTodos && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <div style={PANEL_SECTION_EYEBROW_STYLE}>临时待办</div>
                <div
                  style={{
                    fontSize: 10,
                    lineHeight: 1,
                    padding: '2px 6px',
                    borderRadius: 999,
                    border: '1px solid var(--border-default)',
                    color: 'var(--fg-muted)',
                    background: 'var(--bg-overlay)',
                  }}
                >
                  {
                    tempTodos.filter((t) => t.status === 'pending' || t.status === 'in_progress')
                      .length
                  }
                  /{tempTodos.length}
                </div>
              </div>
              {tempTodos.map((todo, index) => {
                const tone = getSessionTodoBadgeTone(todo);
                return (
                  <div
                    key={`temp-${todo.content}-${index}`}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 6,
                      padding: '4px 6px',
                      borderRadius: 7,
                      background: 'var(--bg-overlay)',
                    }}
                  >
                    <span
                      style={{
                        color: todo.status === 'completed' ? 'var(--success)' : 'var(--warning)',
                        lineHeight: '18px',
                      }}
                    >
                      {todo.status === 'completed'
                        ? '●'
                        : todo.status === 'in_progress'
                          ? '◐'
                          : '○'}
                    </span>
                    <div
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 11,
                        color: 'var(--fg-strong)',
                        fontWeight: 600,
                        lineHeight: 1.45,
                        textDecoration:
                          todo.status === 'completed' || todo.status === 'cancelled'
                            ? 'line-through'
                            : 'none',
                      }}
                    >
                      {todo.content}
                    </div>
                    <span
                      style={{
                        fontSize: 9,
                        lineHeight: 1.2,
                        padding: '1px 5px',
                        borderRadius: 999,
                        ...tone,
                      }}
                    >
                      {formatSessionTodoStatus(todo)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      {(hasCompactions || hasUpstreamSummaries || hasPendingPermissions) && (
        <div style={PANEL_SECTION_STYLE}>
          {hasCompactions && (
            <>
              <div style={PANEL_SECTION_EYEBROW_STYLE}>会话压缩</div>
              {compactions.map((item) => (
                <div key={item.id} style={{ fontSize: 12, color: 'var(--fg-strong)' }}>
                  <div
                    style={{
                      ...PANEL_SECTION_LABEL_STYLE,
                      marginBottom: 4,
                      color: 'var(--fg-strong)',
                    }}
                  >
                    {formatCompactionShortLabel(item)}
                  </div>
                  {formatCompactionCauseLabel(item.cause, item.strategy) ? (
                    <div style={{ color: 'var(--fg-muted)', lineHeight: 1.5 }}>
                      {formatCompactionCauseLabel(item.cause, item.strategy)}
                    </div>
                  ) : null}
                </div>
              ))}
            </>
          )}
          {hasCompactions && hasUpstreamSummaries && (
            <div
              style={{
                margin: '6px 0',
                borderTop: '1px solid color-mix(in oklch, var(--border-default) 60%, transparent)',
              }}
            />
          )}
          {hasUpstreamSummaries && (
            <>
              <div style={PANEL_SECTION_EYEBROW_STYLE}>流式诊断历史</div>
              <input
                type="search"
                value={upstreamQuery}
                onChange={(event) => setUpstreamQuery(event.target.value)}
                placeholder="搜索 requestId / runId / 状态…"
                style={{
                  borderRadius: 8,
                  border: '1px solid var(--border-default)',
                  background: 'var(--bg-overlay)',
                  color: 'var(--fg-strong)',
                  fontSize: 11,
                  padding: '6px 9px',
                }}
              />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {(
                  [
                    ['all', '全部'],
                    ['error', '错误'],
                    ['stalled', '卡住'],
                    ['tool', '工具'],
                    ['cancelled', '停止'],
                  ] as Array<[UpstreamSummaryFilter, string]>
                ).map(([filter, label]) => {
                  const active = upstreamFilter === filter;
                  return (
                    <button
                      key={filter}
                      type="button"
                      onClick={() => setUpstreamFilter(filter)}
                      style={{
                        borderRadius: 999,
                        border: active
                          ? '1px solid color-mix(in oklch, var(--accent) 30%, var(--border-default))'
                          : '1px solid var(--border-default)',
                        background: active
                          ? 'color-mix(in oklch, var(--accent) 10%, transparent)'
                          : 'var(--bg-overlay)',
                        color: active ? 'var(--accent)' : 'var(--fg-muted)',
                        fontSize: 10,
                        fontWeight: 600,
                        padding: '2px 8px',
                        cursor: 'pointer',
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              {groupedUpstreamSummaries.map((group) => (
                <div
                  key={group.key}
                  style={{
                    borderRadius: 8,
                    border:
                      focusedUpstreamGroupKey === group.key
                        ? '1px solid color-mix(in oklch, var(--accent) 34%, var(--border-default))'
                        : '1px solid var(--border-default)',
                    background: 'var(--bg-overlay)',
                    padding: '7px 9px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setCollapsedUpstreamGroups((prev) => ({
                          ...prev,
                          [group.key]: !prev[group.key],
                        }))
                      }
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        border: 'none',
                        background: 'transparent',
                        color: 'var(--fg-strong)',
                        padding: 0,
                        cursor: 'pointer',
                        fontSize: 12,
                        fontWeight: 600,
                        textAlign: 'left',
                      }}
                    >
                      <span style={{ color: 'var(--fg-muted)', fontSize: 10 }}>
                        {collapsedUpstreamGroups[group.key] ? '▸' : '▾'}
                      </span>
                      <span>{group.label}</span>
                    </button>
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
                    >
                      <button
                        type="button"
                        onClick={() => handleCopyUpstreamGroupContext(group)}
                        aria-label={`复制${group.label}诊断上下文`}
                        style={{
                          fontSize: 10,
                          color: 'var(--fg-muted)',
                          borderRadius: 999,
                          border: '1px solid var(--border-default)',
                          padding: '1px 6px',
                          background: 'color-mix(in srgb, var(--bg-overlay) 88%, var(--bg-base))',
                          cursor: 'pointer',
                        }}
                      >
                        复制上下文
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onSelectUpstreamGroup?.(
                            focusedUpstreamGroupKey === group.key ? null : group.key,
                          )
                        }
                        style={{
                          fontSize: 10,
                          color:
                            focusedUpstreamGroupKey === group.key
                              ? 'var(--accent)'
                              : 'var(--fg-muted)',
                          borderRadius: 999,
                          border:
                            focusedUpstreamGroupKey === group.key
                              ? '1px solid color-mix(in oklch, var(--accent) 34%, var(--border-default))'
                              : '1px solid var(--border-default)',
                          padding: '1px 6px',
                          background:
                            focusedUpstreamGroupKey === group.key
                              ? 'color-mix(in oklch, var(--accent) 10%, transparent)'
                              : 'color-mix(in srgb, var(--bg-overlay) 88%, var(--bg-base))',
                          cursor: 'pointer',
                        }}
                      >
                        {focusedUpstreamGroupKey === group.key ? '取消聚焦' : '聚焦'}
                      </button>
                      {(() => {
                        const counts = summarizeUpstreamSummaryGroupCounts(group);
                        return (
                          <>
                            {counts.errorCount > 0 && (
                              <span
                                style={{
                                  fontSize: 10,
                                  color: 'var(--danger)',
                                  borderRadius: 999,
                                  border:
                                    '1px solid color-mix(in srgb, var(--danger) 30%, var(--border-default))',
                                  padding: '1px 6px',
                                  background: 'color-mix(in srgb, var(--danger) 10%, transparent)',
                                }}
                              >
                                错误 {counts.errorCount}
                              </span>
                            )}
                            {counts.stalledCount > 0 && (
                              <span
                                style={{
                                  fontSize: 10,
                                  color: 'var(--warning)',
                                  borderRadius: 999,
                                  border:
                                    '1px solid color-mix(in srgb, var(--warning) 34%, var(--border-default))',
                                  padding: '1px 6px',
                                  background: 'color-mix(in srgb, var(--warning) 10%, transparent)',
                                }}
                              >
                                卡住 {counts.stalledCount}
                              </span>
                            )}
                            {counts.toolCount > 0 && (
                              <span
                                style={{
                                  fontSize: 10,
                                  color: 'var(--accent)',
                                  borderRadius: 999,
                                  border:
                                    '1px solid color-mix(in oklch, var(--accent) 28%, var(--border-default))',
                                  padding: '1px 6px',
                                  background: 'color-mix(in oklch, var(--accent) 10%, transparent)',
                                }}
                              >
                                工具 {counts.toolCount}
                              </span>
                            )}
                            <span
                              style={{
                                fontSize: 10,
                                color: 'var(--fg-muted)',
                                borderRadius: 999,
                                border: '1px solid var(--border-default)',
                                padding: '1px 6px',
                                background:
                                  'color-mix(in srgb, var(--bg-overlay) 88%, var(--bg-base))',
                              }}
                            >
                              {group.items.length} 条
                            </span>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                  {!collapsedUpstreamGroups[group.key] &&
                    group.items.map((item, index) => (
                      <div
                        key={item.id}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 3,
                          paddingTop: index > 0 ? 6 : 0,
                          borderTop:
                            index > 0
                              ? '1px solid color-mix(in oklch, var(--border-default) 60%, transparent)'
                              : 'none',
                        }}
                      >
                        <div style={{ fontSize: 12, color: 'var(--fg-strong)', fontWeight: 600 }}>
                          {formatUpstreamSummaryStatusLabel(item.summary)}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--fg-default)' }}>
                          {formatUpstreamSummaryMetricLine(item.summary)}
                        </div>
                        <div
                          style={{
                            fontSize: 10,
                            color: 'var(--fg-muted)',
                            fontFamily: 'monospace',
                          }}
                        >
                          {new Date(item.occurredAt).toLocaleTimeString('zh-CN', { hour12: false })}
                          {item.runId ? ` · ${item.runId}` : ''}
                        </div>
                      </div>
                    ))}
                </div>
              ))}
              {filteredUpstreamSummaries.length === 0 && (
                <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                  当前筛选下没有匹配的流式诊断。
                </div>
              )}
            </>
          )}
          {hasUpstreamSummaries && hasPendingPermissions && (
            <div
              style={{
                margin: '6px 0',
                borderTop: '1px solid color-mix(in oklch, var(--border-default) 60%, transparent)',
              }}
            />
          )}
          {hasCompactions && !hasUpstreamSummaries && hasPendingPermissions && (
            <div
              style={{
                margin: '6px 0',
                borderTop: '1px solid color-mix(in oklch, var(--border-default) 60%, transparent)',
              }}
            />
          )}
          {hasPendingPermissions && (
            <>
              <div style={PANEL_SECTION_EYEBROW_STYLE}>待处理审批</div>
              {pendingPermissions.map((permission, idx) => (
                <div
                  key={permission.requestId}
                  style={{
                    paddingTop: idx > 0 ? 7 : 0,
                    marginTop: idx > 0 ? 7 : 0,
                    borderTop: idx > 0 ? '1px solid var(--border-subtle)' : 'none',
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: 'var(--fg-strong)',
                      lineHeight: 1.4,
                    }}
                  >
                    {permission.toolName}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: 'var(--fg-muted)',
                      marginTop: 2,
                      lineHeight: 1.45,
                    }}
                  >
                    {permission.reason}
                  </div>
                  <div
                    style={{
                      color: 'var(--fg-muted)',
                      fontSize: 10,
                      marginTop: 2,
                      maxWidth: '100%',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={
                      permission.previewAction
                        ? `${permission.scope} · ${permission.riskLevel} · ${permission.previewAction}`
                        : `${permission.scope} · ${permission.riskLevel}`
                    }
                  >
                    {permission.scope} · {permission.riskLevel}
                    {permission.previewAction ? ` · ${permission.previewAction}` : ''}
                  </div>
                  {permission.always && permission.always.length > 0
                    ? (() => {
                        const broad = permission.always.filter(
                          (pattern) => pattern !== permission.scope,
                        );
                        if (broad.length === 0) return null;
                        return (
                          <div
                            style={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              gap: 4,
                              marginTop: 4,
                            }}
                          >
                            {broad.map((pattern) => (
                              <code
                                key={pattern}
                                title="批准会话/永久后将自动覆盖该模式"
                                style={{
                                  display: 'inline-block',
                                  maxWidth: '100%',
                                  fontFamily: 'var(--font-mono, monospace)',
                                  fontSize: 9,
                                  padding: '1px 6px',
                                  borderRadius: 999,
                                  background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
                                  border:
                                    '1px solid color-mix(in srgb, var(--accent) 28%, transparent)',
                                  color: 'var(--accent)',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {pattern}
                              </code>
                            ))}
                          </div>
                        );
                      })()
                    : null}
                  {resolveInlinePermissionActions &&
                    (() => {
                      const approvalActions = resolveInlinePermissionActions(permission.requestId);
                      if (!approvalActions || approvalActions.items.length === 0) {
                        return null;
                      }

                      return (
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 6,
                            marginTop: 8,
                          }}
                        >
                          {approvalActions.scopeLevels &&
                            approvalActions.scopeLevels.length > 0 &&
                            approvalActions.onSelectScopeLevel && (
                              <div
                                style={{
                                  display: 'flex',
                                  flexWrap: 'wrap',
                                  gap: 4,
                                }}
                              >
                                {approvalActions.scopeLevels.map((level) => {
                                  const isSelected =
                                    approvalActions.selectedScopeCategory === level.category ||
                                    approvalActions.selectedScopePattern === level.pattern;
                                  return (
                                    <button
                                      key={level.category}
                                      type="button"
                                      onClick={() => approvalActions.onSelectScopeLevel?.(level)}
                                      title={`${level.description} ${level.pattern}`}
                                      aria-pressed={isSelected}
                                      style={{
                                        appearance: 'none',
                                        minHeight: 22,
                                        padding: '0 8px',
                                        borderRadius: 999,
                                        border: isSelected
                                          ? '1px solid var(--accent)'
                                          : '1px solid color-mix(in srgb, var(--accent) 24%, var(--border-default))',
                                        background: isSelected
                                          ? 'color-mix(in srgb, var(--accent) 18%, transparent)'
                                          : 'var(--bg-overlay)',
                                        color: isSelected ? 'var(--accent)' : 'var(--fg-muted)',
                                        fontSize: 10,
                                        fontWeight: 700,
                                        lineHeight: 1,
                                        cursor: 'pointer',
                                      }}
                                    >
                                      {level.label}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          <div
                            style={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              gap: 6,
                            }}
                          >
                            {approvalActions.items.map((action) => (
                              <button
                                key={action.id}
                                type="button"
                                disabled={action.disabled}
                                onClick={action.onClick}
                                title={action.hint}
                                style={{
                                  appearance: 'none',
                                  minHeight: 28,
                                  padding: action.primary ? '0 12px' : '0 10px',
                                  borderRadius: 999,
                                  border: `1px solid ${
                                    action.primary
                                      ? 'color-mix(in srgb, var(--accent) 50%, var(--border-default))'
                                      : action.danger
                                        ? 'color-mix(in srgb, var(--danger) 42%, var(--border-default))'
                                        : 'color-mix(in srgb, var(--accent) 34%, var(--border-default))'
                                  }`,
                                  background: action.disabled
                                    ? 'var(--bg-overlay)'
                                    : action.primary
                                      ? 'linear-gradient(180deg, color-mix(in srgb, var(--accent) 24%, transparent), color-mix(in srgb, var(--accent) 12%, transparent))'
                                      : action.danger
                                        ? 'color-mix(in srgb, var(--danger) 12%, transparent)'
                                        : 'color-mix(in srgb, var(--accent) 12%, transparent)',
                                  color: action.danger ? 'var(--danger)' : 'var(--fg-strong)',
                                  fontSize: 10,
                                  fontWeight: 700,
                                  lineHeight: 1,
                                  cursor: action.disabled ? 'not-allowed' : 'pointer',
                                  opacity: action.disabled ? 0.62 : 1,
                                }}
                              >
                                {action.label}
                              </button>
                            ))}
                          </div>
                          {(approvalActions.pendingLabel ||
                            approvalActions.helperMessage ||
                            approvalActions.errorMessage) && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              {approvalActions.pendingLabel && (
                                <div style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
                                  {approvalActions.pendingLabel}
                                </div>
                              )}
                              {approvalActions.helperMessage && (
                                <div
                                  style={{
                                    fontSize: 10,
                                    color: 'var(--fg-muted)',
                                    opacity: 0.92,
                                    lineHeight: 1.45,
                                  }}
                                >
                                  {approvalActions.helperMessage}
                                </div>
                              )}
                              {approvalActions.errorMessage && (
                                <div style={{ fontSize: 10, color: 'var(--danger)' }}>
                                  {approvalActions.errorMessage}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                </div>
              ))}
            </>
          )}
        </div>
      )}
      <PlanHistoryPanel plans={planHistory} />
    </div>
  );
}
