import React from 'react';
import type { PendingPermissionRequest, Session, SessionTask } from '@openAwork/web-client';
import { ContextPanel, PlanHistoryPanel } from '@openAwork/shared-ui';
import type {
  AlwaysScopeLevel,
  AttachmentItem,
  ContextItem,
  HistoricalPlan,
} from '@openAwork/shared-ui';
import type { UpstreamStreamSummary } from '@openAwork/shared';
import { tryFormatJson } from '../../../utils/format-json.js';
import { Link } from 'react-router';
import { copyTextToClipboard } from '../../../components/layout/file-tree/file-tree-actions.js';
import type { DialogueMode } from '../mode/dialogue-mode.js';
import type { ChatContextUsageSnapshot } from '../../../components/conversation-runtime/messages/context-usage.js';
import type {
  ChatMessage,
  WorkspaceFileMentionItem,
} from '../../../components/conversation-runtime/messages/support.js';

type HierarchicalSessionTask = SessionTask & {
  completedSubtaskCount?: number;
  depth?: number;
  readySubtaskCount?: number;
  subtaskCount?: number;
  unmetDependencyCount?: number;
};

interface SessionTodoItem {
  content: string;
  lane?: 'main' | 'temp';
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'high' | 'medium' | 'low';
}

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

function fmtOverviewTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

function splitSessionTodosByLane(sessionTodos: SessionTodoItem[]): {
  mainTodos: SessionTodoItem[];
  tempTodos: SessionTodoItem[];
} {
  return {
    mainTodos: sessionTodos.filter((todo) => todo.lane !== 'temp'),
    tempTodos: sessionTodos.filter((todo) => todo.lane === 'temp'),
  };
}

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

interface CompactionItem {
  id: string;
  summary: string;
  trigger: 'manual' | 'automatic';
  occurredAt: number;
}

export interface UpstreamSummaryItem {
  id: string;
  occurredAt: number;
  requestId?: string;
  runId?: string;
  summary: UpstreamStreamSummary;
}

type UpstreamSummaryFilter = 'all' | 'error' | 'stalled' | 'tool' | 'cancelled';

export interface UpstreamSummaryRequestGroup {
  key: string;
  label: string;
  items: UpstreamSummaryItem[];
}

export interface UpstreamSummaryGroupCounts {
  errorCount: number;
  stalledCount: number;
  toolCount: number;
}

export function formatUpstreamSummaryStatusLabel(summary: UpstreamStreamSummary): string {
  if (summary.stopReason === 'end_turn') return '正常结束';
  if (summary.stopReason === 'tool_use') return '等待工具';
  if (summary.stopReason === 'max_tokens') return '达到上限';
  if (summary.stopReason === 'cancelled') return '已停止';
  if (summary.stopReason === 'tool_permission') return '等待权限';
  return '上游错误';
}

export function formatUpstreamSummaryMetricLine(summary: UpstreamStreamSummary): string {
  const suffix = summary.stalled
    ? ' · stalled'
    : summary.sawError
      ? ' · error'
      : summary.sawDone
        ? ' · done'
        : '';
  return `文本 ${summary.textDeltaCount} / 思考 ${summary.reasoningDeltaCount} / 工具 ${summary.toolCallDeltaCount}${suffix}`;
}

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

export function groupUpstreamSummariesByRequest(
  items: UpstreamSummaryItem[],
): UpstreamSummaryRequestGroup[] {
  const groups = new Map<string, UpstreamSummaryRequestGroup>();
  for (const item of items) {
    const requestId = item.requestId?.trim();
    const runId = item.runId?.trim();
    const key = requestId ? `request:${requestId}` : runId ? `run:${runId}` : `orphan:${item.id}`;
    const label = requestId ? `请求 ${requestId}` : runId ? `运行 ${runId}` : '未绑定请求';
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(item);
      continue;
    }
    groups.set(key, { key, label, items: [item] });
  }
  return Array.from(groups.values());
}

export function findUpstreamSummaryGroupByKey(
  items: UpstreamSummaryItem[],
  key: string,
): UpstreamSummaryRequestGroup | null {
  return groupUpstreamSummariesByRequest(items).find((group) => group.key === key) ?? null;
}

export function summarizeUpstreamSummaryGroupCounts(
  group: UpstreamSummaryRequestGroup,
): UpstreamSummaryGroupCounts {
  return group.items.reduce<UpstreamSummaryGroupCounts>(
    (acc, item) => ({
      errorCount:
        acc.errorCount + (item.summary.sawError || item.summary.stopReason === 'error' ? 1 : 0),
      stalledCount: acc.stalledCount + (item.summary.stalled ? 1 : 0),
      toolCount:
        acc.toolCount +
        (item.summary.stopReason === 'tool_use' || item.summary.toolCallDeltaCount > 0 ? 1 : 0),
    }),
    { errorCount: 0, stalledCount: 0, toolCount: 0 },
  );
}

export function formatUpstreamSummaryGroupHeadline(group: UpstreamSummaryRequestGroup): string {
  const counts = summarizeUpstreamSummaryGroupCounts(group);
  return `${group.items.length} 条 · 错误 ${counts.errorCount} / 卡住 ${counts.stalledCount} / 工具 ${counts.toolCount}`;
}

export function buildUpstreamSummaryGroupContextText(
  group: UpstreamSummaryRequestGroup,
  limit = 3,
): string {
  const recentItems = group.items.slice(0, Math.max(0, limit));
  const lines = [group.label, formatUpstreamSummaryGroupHeadline(group)];

  if (recentItems.length > 0) {
    lines.push('最近诊断');
    lines.push(
      ...recentItems.map((item, index) => {
        const timeLabel = new Date(item.occurredAt).toLocaleTimeString('zh-CN', {
          hour12: false,
        });
        return `${index + 1}. ${formatUpstreamSummaryStatusLabel(item.summary)} · ${formatUpstreamSummaryMetricLine(item.summary)} · ${timeLabel}${item.runId ? ` · ${item.runId}` : ''}`;
      }),
    );
  }

  return lines.join('\n');
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
                    {item.trigger === 'manual' ? '手动压缩' : '自动压缩'}
                  </div>
                  <div
                    style={{ color: 'var(--fg-default)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}
                  >
                    {tryFormatJson(item.summary)}
                  </div>
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
                  <div style={{ color: 'var(--fg-muted)', fontSize: 10, marginTop: 2 }}>
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
                                  fontFamily: 'var(--font-mono, monospace)',
                                  fontSize: 9,
                                  padding: '1px 6px',
                                  borderRadius: 999,
                                  background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
                                  border:
                                    '1px solid color-mix(in srgb, var(--accent) 28%, transparent)',
                                  color: 'var(--accent)',
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

export function ChatOverviewTabContent(props: {
  attachmentItems: AttachmentItem[];
  artifactsWorkspaceHref: string | null;
  childSessions: Session[];
  compactions: CompactionItem[];
  upstreamSummaries: UpstreamSummaryItem[];
  focusedUpstreamGroupKey?: string | null;
  contextUsageSnapshot: ChatContextUsageSnapshot | null;
  contentArtifactCount: number;
  contentArtifactCountStatus: 'idle' | 'loading' | 'ready' | 'error';
  currentSessionId: string | null;
  dialogueMode: DialogueMode;
  effectiveWorkingDirectory: string | null;
  messages: ChatMessage[];
  pendingPermissions: PendingPermissionRequest[];
  pendingQuestionsCount: number;
  sessionStateStatus: 'idle' | 'running' | 'paused' | 'completed' | 'error' | null;
  sessionTodos: SessionTodoItem[];
  sessionTasks: HierarchicalSessionTask[];
  workspaceFileItems: WorkspaceFileMentionItem[];
  yoloMode: boolean;
  onCompactSession: () => void;
  onOpenRecoveryStrategy: () => void;
}) {
  const {
    attachmentItems,
    artifactsWorkspaceHref,
    childSessions,
    compactions,
    upstreamSummaries,
    focusedUpstreamGroupKey = null,
    contextUsageSnapshot,
    contentArtifactCount,
    contentArtifactCountStatus,
    currentSessionId,
    dialogueMode,
    effectiveWorkingDirectory,
    messages,
    pendingPermissions,
    pendingQuestionsCount,
    sessionStateStatus,
    sessionTodos,
    sessionTasks,
    workspaceFileItems,
    yoloMode,
    onCompactSession,
    onOpenRecoveryStrategy,
  } = props;
  const { mainTodos, tempTodos } = splitSessionTodosByLane(sessionTodos);
  const mainActiveCount = mainTodos.filter(
    (todo) => todo.status === 'pending' || todo.status === 'in_progress',
  ).length;
  const tempActiveCount = tempTodos.filter(
    (todo) => todo.status === 'pending' || todo.status === 'in_progress',
  ).length;
  const focusedUpstreamGroup = focusedUpstreamGroupKey
    ? (groupUpstreamSummariesByRequest(upstreamSummaries).find(
        (group) => group.key === focusedUpstreamGroupKey,
      ) ?? null)
    : null;
  const focusedUpstreamSummaries = focusedUpstreamGroup?.items ?? upstreamSummaries;
  const artifactCountLabel =
    contentArtifactCountStatus === 'loading'
      ? '同步中…'
      : contentArtifactCountStatus === 'error'
        ? '暂不可用'
        : `${contentArtifactCount} 个`;
  const contextItems: ContextItem[] = [
    ...attachmentItems.map((item) => ({
      id: item.id,
      kind: 'file' as const,
      label: item.name,
      description: `附件 · ${item.type}`,
    })),
    ...workspaceFileItems.slice(0, 8).map((item) => ({
      id: item.path,
      kind: 'file' as const,
      label: item.label,
      description: item.relativePath,
    })),
    ...(yoloMode
      ? [
          {
            id: 'context-yolo-mode',
            kind: 'custom' as const,
            label: 'YOLO 模式',
            description: '当前会话允许更激进的执行策略。',
          },
        ]
      : []),
  ];
  const recoverySummary =
    sessionStateStatus === 'paused'
      ? pendingPermissions.length > 0
        ? '当前会话已暂停，等待审批后会自动继续。'
        : pendingQuestionsCount > 0
          ? '当前会话已暂停，等待你回答问题后继续。'
          : '当前会话已暂停，可从恢复策略里查看下一步动作。'
      : compactions.length > 0
        ? '当前会话已有最近检查点，可刷新页面后继续同步恢复。'
        : '当前会话没有最近检查点，主要依赖实时 attach / replay 恢复。';

  const sectionDivider = (
    <div
      style={{
        borderTop: '1px solid color-mix(in oklch, var(--border-default) 50%, transparent)',
        margin: '0',
      }}
    />
  );

  const metaGrid: Array<{ label: string; value: string; highlight?: boolean }> = [
    {
      label: '会话 ID',
      value: currentSessionId ? `${currentSessionId.slice(0, 8)}…` : '—',
    },
    { label: '消息数量', value: `${messages.length} 条` },
    {
      label: '工作区',
      value: effectiveWorkingDirectory ?? '未绑定',
    },
    {
      label: '对话模式',
      value: dialogueMode === 'clarify' ? '澄清' : dialogueMode === 'coding' ? '编程' : '程序员',
    },
    { label: 'YOLO', value: yoloMode ? '开启' : '关闭', highlight: yoloMode },
    { label: '最近压缩', value: compactions[0]?.summary ?? '无' },
    {
      label: '当前聚焦请求',
      value: focusedUpstreamGroup?.label ?? '全部请求',
      highlight: Boolean(focusedUpstreamGroup),
    },
    {
      label: '最近流诊断',
      value: focusedUpstreamSummaries[0]
        ? formatUpstreamSummaryStatusLabel(focusedUpstreamSummaries[0].summary)
        : '无',
    },
  ];

  const statsGrid: Array<{ label: string; value: string; accent?: boolean }> = [
    { label: '子会话', value: `${childSessions.length} 个` },
    { label: '任务', value: `${sessionTasks.length} 项` },
    {
      label: '主待办',
      value: `${mainActiveCount}/${mainTodos.length} 项`,
      accent: mainActiveCount > 0,
    },
    {
      label: '临时待办',
      value: `${tempActiveCount}/${tempTodos.length} 项`,
      accent: tempActiveCount > 0,
    },
    {
      label: '待处理审批',
      value: `${pendingPermissions.length} 项`,
      accent: pendingPermissions.length > 0,
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* 上下文用量条:与 composer 底部进度条同款,带 95% 压缩刻度 */}
      {contextUsageSnapshot ? (
        <div
          style={{
            padding: '8px 4px 6px',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          {(() => {
            const used = Math.max(0, contextUsageSnapshot.usedTokens);
            const max = Math.max(1, contextUsageSnapshot.maxTokens);
            const pctRaw = Math.round((used / max) * 100);
            const pct = Math.min(100, pctRaw);
            const color =
              pctRaw >= 90 ? 'var(--danger)' : pctRaw >= 70 ? 'var(--warning)' : 'var(--success)';
            const compactionPct = 95; // 默认压缩阈值,后续可从 active model 注入
            const title = `${contextUsageSnapshot.estimated ? '上下文估算已用' : '上下文已用'} ${used.toLocaleString()} / ${max.toLocaleString()} (${pctRaw}%)`;
            return (
              <>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    fontSize: 10.5,
                    color: 'var(--fg-muted)',
                    fontWeight: 600,
                  }}
                >
                  <span>上下文用量</span>
                  <span style={{ color, fontVariantNumeric: 'tabular-nums' }}>
                    {contextUsageSnapshot.estimated ? '≈' : ''}
                    {pctRaw}%
                    <span
                      style={{
                        color: 'var(--fg-muted)',
                        fontWeight: 500,
                        marginLeft: 6,
                      }}
                    >
                      {fmtOverviewTokens(used)} / {fmtOverviewTokens(max)}
                    </span>
                  </span>
                </div>
                <div
                  role="meter"
                  aria-valuenow={Math.min(used, max)}
                  aria-valuemin={0}
                  aria-valuemax={max}
                  aria-label="上下文用量"
                  title={title}
                  style={{
                    position: 'relative',
                    height: 4,
                    width: '100%',
                  }}
                >
                  {/* track + 压缩刻度 */}
                  <div
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      bottom: 0,
                      height: 4,
                      background: `linear-gradient(
                        to right,
                        transparent calc(${compactionPct}% - 1.5px),
                        var(--warning) calc(${compactionPct}% - 1.5px),
                        var(--warning) calc(${compactionPct}% + 1.5px),
                        transparent calc(${compactionPct}% + 1.5px)
                      ), linear-gradient(to bottom, transparent 0, transparent 2px, color-mix(in oklch, var(--border-default) 100%, transparent) 2px, color-mix(in oklch, var(--border-default) 100%, transparent) 4px)`,
                    }}
                  />
                  {/* fill */}
                  <div
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      left: 0,
                      bottom: 0,
                      width: `${pct}%`,
                      height: 2,
                      background: color,
                      borderRadius: 999,
                      transition: 'width 400ms cubic-bezier(.4, 0, .2, 1), background 300ms ease',
                    }}
                  />
                </div>
              </>
            );
          })()}
        </div>
      ) : null}

      {/* 会话元信息 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          columnGap: 10,
          rowGap: 3,
          padding: '8px 4px',
          fontSize: 11,
        }}
      >
        {metaGrid.map(({ label, value, highlight }) => (
          <React.Fragment key={label}>
            <span style={{ color: 'var(--fg-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>
              {label}
            </span>
            <span
              style={{
                color: highlight ? 'var(--accent)' : 'var(--fg-default)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={value}
            >
              {value}
            </span>
          </React.Fragment>
        ))}
      </div>

      {sectionDivider}

      {focusedUpstreamGroup && (
        <>
          <div
            style={{
              padding: '10px 4px 0',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={PANEL_SECTION_EYEBROW_STYLE}>当前聚焦请求</div>
            <div
              style={{
                borderRadius: 8,
                border: '1px solid color-mix(in oklch, var(--accent) 24%, var(--border-default))',
                background: 'color-mix(in oklch, var(--accent) 8%, var(--bg-overlay))',
                padding: '8px 10px',
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>
                  {focusedUpstreamGroup.label}
                </div>
                <div style={{ fontSize: 11, color: 'var(--fg-default)' }}>
                  {formatUpstreamSummaryGroupHeadline(focusedUpstreamGroup)}
                </div>
                {focusedUpstreamSummaries[0] ? (
                  <div style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
                    最近状态 ·{' '}
                    {formatUpstreamSummaryStatusLabel(focusedUpstreamSummaries[0].summary)}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() =>
                  void copyTextToClipboard(
                    buildUpstreamSummaryGroupContextText(focusedUpstreamGroup),
                  )
                }
                aria-label="复制当前聚焦请求诊断上下文"
                style={{
                  border: '1px solid color-mix(in oklch, var(--accent) 26%, var(--border-default))',
                  background: 'color-mix(in oklch, var(--accent) 10%, transparent)',
                  color: 'var(--accent)',
                  cursor: 'pointer',
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '3px 8px',
                  borderRadius: 999,
                  flexShrink: 0,
                  whiteSpace: 'nowrap',
                }}
              >
                复制诊断上下文
              </button>
            </div>
          </div>
          {sectionDivider}
        </>
      )}

      {focusedUpstreamSummaries.length > 0 && (
        <>
          <div style={{ padding: '10px 4px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={PANEL_SECTION_EYEBROW_STYLE}>最近流式诊断</div>
            {focusedUpstreamSummaries.slice(0, 3).map((item) => (
              <div
                key={item.id}
                style={{
                  borderRadius: 8,
                  border: '1px solid var(--border-default)',
                  background: 'var(--bg-overlay)',
                  padding: '8px 10px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-strong)' }}>
                  {formatUpstreamSummaryStatusLabel(item.summary)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--fg-default)' }}>
                  {formatUpstreamSummaryMetricLine(item.summary)}
                </div>
              </div>
            ))}
          </div>
          {sectionDivider}
        </>
      )}

      {/* 活跃状态统计 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 4,
          padding: '8px 4px',
        }}
      >
        {statsGrid.map(({ label, value, accent }) => (
          <div
            key={label}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
              padding: '5px 7px',
              borderRadius: 7,
              background: 'var(--bg-overlay)',
              border: accent
                ? '1px solid color-mix(in oklch, var(--accent) 30%, var(--border-default))'
                : '1px solid transparent',
            }}
          >
            <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--fg-muted)', lineHeight: 1 }}>
              {label}
            </span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: accent ? 'var(--accent)' : 'var(--fg-strong)',
                lineHeight: 1.2,
              }}
            >
              {value}
            </span>
          </div>
        ))}
      </div>

      {sectionDivider}

      {/* 恢复策略 */}
      <div style={{ padding: '8px 4px', display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 6,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: sessionStateStatus === 'paused' ? 'var(--warning)' : 'var(--fg-strong)',
                marginBottom: 2,
              }}
            >
              {sessionStateStatus === 'paused' ? '等待处理' : '恢复就绪'}
            </div>
            <div style={{ fontSize: 10, color: 'var(--fg-muted)', lineHeight: 1.4 }}>
              {recoverySummary}
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenRecoveryStrategy}
            style={{
              border: '1px solid var(--border-default)',
              background: 'var(--bg-overlay)',
              color: 'var(--fg-default)',
              cursor: 'pointer',
              fontSize: 10,
              fontWeight: 600,
              padding: '3px 8px',
              borderRadius: 6,
              flexShrink: 0,
              whiteSpace: 'nowrap',
            }}
          >
            恢复详情
          </button>
        </div>
        <div
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}
        >
          <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
            产物工作区
            <span style={{ color: 'var(--fg-default)', fontWeight: 600, marginLeft: 6 }}>
              {artifactCountLabel}
            </span>
          </span>
          {artifactsWorkspaceHref ? (
            <Link
              to={artifactsWorkspaceHref}
              style={{
                border: '1px solid var(--border-default)',
                background: 'var(--bg-overlay)',
                color: 'var(--fg-default)',
                fontSize: 10,
                fontWeight: 600,
                padding: '3px 8px',
                borderRadius: 6,
                flexShrink: 0,
                textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              进入工作区
            </Link>
          ) : (
            <span
              style={{
                fontSize: 10,
                color: 'var(--fg-muted)',
                opacity: 0.5,
                padding: '3px 8px',
                flexShrink: 0,
              }}
            >
              进入工作区
            </span>
          )}
        </div>
      </div>

      {sectionDivider}

      {/* 上下文 */}
      <div style={{ padding: '8px 4px', display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 6,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg-strong)', marginBottom: 2 }}
            >
              上下文
            </div>
            <div style={{ fontSize: 10, color: 'var(--fg-muted)', lineHeight: 1.4 }}>
              {[
                yoloMode ? '⚡ YOLO' : '',
                attachmentItems.length > 0 ? `📎 ${attachmentItems.length} 附件` : '',
                workspaceFileItems.length > 0 ? `📂 ${workspaceFileItems.length} 索引文件` : '',
              ]
                .filter(Boolean)
                .join(' · ') || '无额外上下文注入'}
            </div>
          </div>
          <button
            type="button"
            onClick={onCompactSession}
            style={{
              border: '1px solid var(--border-default)',
              background: 'var(--bg-overlay)',
              color: 'var(--fg-default)',
              cursor: 'pointer',
              fontSize: 10,
              fontWeight: 600,
              padding: '3px 8px',
              borderRadius: 6,
              flexShrink: 0,
              whiteSpace: 'nowrap',
            }}
          >
            压缩会话
          </button>
        </div>
        <ContextPanel
          items={contextItems}
          totalTokens={contextUsageSnapshot?.usedTokens}
          tokenLimit={contextUsageSnapshot?.maxTokens}
        />
      </div>
    </div>
  );
}
