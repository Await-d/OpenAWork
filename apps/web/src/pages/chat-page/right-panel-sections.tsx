import type { PendingPermissionRequest, Session, SessionTask } from '@openAwork/web-client';
import { ContextPanel, PlanHistoryPanel } from '@openAwork/shared-ui';
import type { AttachmentItem, ContextItem, HistoricalPlan } from '@openAwork/shared-ui';
import { Link } from 'react-router';
import type { DialogueMode } from '../dialogue-mode.js';
import type { ChatContextUsageSnapshot } from './context-usage.js';
import type { ChatMessage, WorkspaceFileMentionItem } from './support.js';

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
  border: '1px solid color-mix(in oklch, var(--border) 84%, transparent)',
  background: 'color-mix(in oklch, var(--surface) 80%, transparent)',
};

const PANEL_SECTION_LABEL_STYLE: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--text-2)',
  lineHeight: 1.25,
};

const PANEL_SECTION_EYEBROW_STYLE: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--text-3)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};

const PANEL_ACTION_LINK_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 32,
  padding: '0 12px',
  borderRadius: 999,
  border: '1px solid color-mix(in oklch, var(--accent) 30%, var(--border))',
  background: 'color-mix(in oklch, var(--accent) 14%, var(--surface) 86%)',
  color: 'var(--text)',
  fontSize: 11,
  fontWeight: 700,
  lineHeight: 1,
  textDecoration: 'none',
};

const PANEL_ACTION_DISABLED_STYLE: React.CSSProperties = {
  ...PANEL_ACTION_LINK_STYLE,
  opacity: 0.56,
  cursor: 'not-allowed',
};

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
      border: '1px solid color-mix(in srgb, #38bdf8 38%, var(--border))',
      color: '#7dd3fc',
      background: 'color-mix(in srgb, #38bdf8 10%, transparent)',
    };
  }
  if (todo.status === 'completed') {
    return {
      border: '1px solid color-mix(in srgb, #34d399 40%, var(--border))',
      color: '#86efac',
      background: 'color-mix(in srgb, #34d399 10%, transparent)',
    };
  }
  if (todo.status === 'cancelled') {
    return {
      border: '1px solid color-mix(in srgb, #f59e0b 45%, var(--border))',
      color: '#fcd34d',
      background: 'color-mix(in srgb, #f59e0b 10%, transparent)',
    };
  }
  return {
    border: '1px solid var(--border)',
    color: 'var(--text-3)',
    background: 'color-mix(in srgb, var(--surface) 72%, transparent)',
  };
}

function getSessionTodoPriorityLabel(todo: SessionTodoItem): string {
  if (todo.priority === 'high') return '高优先级';
  if (todo.priority === 'medium') return '中优先级';
  return '低优先级';
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
    return task.terminalReason === 'timeout' ? '执行超时' : '执行失败';
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

export function ChatHistoryTabContent(props: {
  childSessions: Session[];
  compactions: CompactionItem[];
  pendingPermissions: PendingPermissionRequest[];
  planHistory: HistoricalPlan[];
  sessionTodos: SessionTodoItem[];
  sessionTasks: HierarchicalSessionTask[];
  onOpenSession: (sessionId: string) => void;
  sharedUiThemeVars: React.CSSProperties;
}) {
  const {
    childSessions,
    compactions,
    pendingPermissions,
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
  const hasPendingPermissions = pendingPermissions.length > 0;
  const hasMainTodos = mainTodos.length > 0;
  const hasTempTodos = tempTodos.length > 0;

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
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    border: 'none',
                    borderRadius: 8,
                    background: 'color-mix(in oklch, var(--surface) 70%, transparent)',
                    color: 'var(--text)',
                    padding: '7px 9px',
                    cursor: 'pointer',
                    fontSize: 12,
                    textDecoration: 'none',
                    lineHeight: 1.45,
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background =
                      'color-mix(in oklch, var(--surface) 88%, var(--bg) 12%)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background =
                      'color-mix(in oklch, var(--surface) 70%, transparent)';
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
                borderTop: '1px solid color-mix(in oklch, var(--border) 60%, transparent)',
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
                    color: 'var(--text)',
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
                            ? 'color-mix(in srgb, var(--border) 88%, transparent)'
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
                          border: '1px solid color-mix(in oklch, var(--accent) 24%, var(--border))',
                          color: 'color-mix(in oklch, var(--accent) 80%, var(--text-3))',
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
                          border: '1px solid var(--border)',
                          color: 'var(--text-3)',
                          background: 'color-mix(in srgb, var(--surface) 70%, transparent)',
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
                          border: '1px solid color-mix(in srgb, #f59e0b 55%, var(--border))',
                          color: '#fbbf24',
                          background: 'color-mix(in srgb, #f59e0b 10%, transparent)',
                        }}
                      >
                        等待前置
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      color: 'var(--text-2)',
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
                            ? '#fca5a5'
                            : 'color-mix(in srgb, #86efac 90%, var(--text-3))',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                      title={
                        task.errorMessage ??
                        task.result ??
                        (task.terminalReason === 'timeout'
                          ? '子任务执行超时。'
                          : task.terminalReason)
                      }
                    >
                      {task.errorMessage
                        ? `✗ ${task.errorMessage}`
                        : task.result
                          ? `✓ ${task.result}`
                          : task.terminalReason === 'timeout'
                            ? '✗ 子任务执行超时。'
                            : `✗ ${task.terminalReason ?? ''}`}
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
                    border: '1px solid var(--border)',
                    color: 'var(--text-3)',
                    background: 'color-mix(in srgb, var(--surface) 70%, transparent)',
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
                      background: 'color-mix(in oklch, var(--surface) 68%, transparent)',
                    }}
                  >
                    <span
                      style={{
                        color: todo.status === 'completed' ? '#34d399' : '#fbbf24',
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
                        color: 'var(--text)',
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
                borderTop: '1px solid color-mix(in oklch, var(--border) 60%, transparent)',
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
                    border: '1px solid var(--border)',
                    color: 'var(--text-3)',
                    background: 'color-mix(in srgb, var(--surface) 70%, transparent)',
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
                      background: 'color-mix(in oklch, var(--surface) 68%, transparent)',
                    }}
                  >
                    <span
                      style={{
                        color: todo.status === 'completed' ? '#34d399' : '#fbbf24',
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
                        color: 'var(--text)',
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
      {(hasCompactions || hasPendingPermissions) && (
        <div style={PANEL_SECTION_STYLE}>
          {hasCompactions && (
            <>
              <div style={PANEL_SECTION_EYEBROW_STYLE}>会话压缩</div>
              {compactions.map((item) => (
                <div key={item.id} style={{ fontSize: 12, color: 'var(--text)' }}>
                  <div
                    style={{ ...PANEL_SECTION_LABEL_STYLE, marginBottom: 4, color: 'var(--text)' }}
                  >
                    {item.trigger === 'manual' ? '手动压缩' : '自动压缩'}
                  </div>
                  <div style={{ color: 'var(--text-2)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                    {item.summary}
                  </div>
                </div>
              ))}
            </>
          )}
          {hasCompactions && hasPendingPermissions && (
            <div
              style={{
                margin: '6px 0',
                borderTop: '1px solid color-mix(in oklch, var(--border) 60%, transparent)',
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
                    style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', lineHeight: 1.4 }}
                  >
                    {permission.toolName}
                  </div>
                  <div
                    style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2, lineHeight: 1.45 }}
                  >
                    {permission.reason}
                  </div>
                  <div style={{ color: 'var(--text-3)', fontSize: 10, marginTop: 2 }}>
                    {permission.scope} · {permission.riskLevel}
                    {permission.previewAction ? ` · ${permission.previewAction}` : ''}
                  </div>
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
  const artifactCountLabel =
    contentArtifactCountStatus === 'loading'
      ? '同步中…'
      : contentArtifactCountStatus === 'error'
        ? '暂不可用'
        : `${contentArtifactCount} 个`;
  const artifactDescription = !currentSessionId
    ? '创建或切换到一个会话后，就可以直接进入对应的产物工作区。'
    : contentArtifactCountStatus === 'loading'
      ? '正在同步当前会话的内容型产物统计。'
      : contentArtifactCountStatus === 'error'
        ? '当前会话的产物统计暂时不可用，但仍可尝试进入工作区。'
        : contentArtifactCount > 0
          ? `当前会话已沉淀 ${contentArtifactCount} 个内容型产物，可直接切到工作区继续编辑。`
          : '当前会话还没有内容型产物，但你仍然可以进入工作区查看和创建。';

  const overviewRows = [
    { label: '会话 ID', value: currentSessionId ? `${currentSessionId.slice(0, 8)}…` : '—' },
    { label: '消息数量', value: `${messages.length} 条` },
    { label: '工作区', value: effectiveWorkingDirectory ?? '未绑定' },
    {
      label: '对话模式',
      value: dialogueMode === 'clarify' ? '澄清' : dialogueMode === 'coding' ? '编程' : '程序员',
    },
    { label: 'YOLO 模式', value: yoloMode ? '开启' : '关闭' },
    {
      label: 'Token 估算',
      value: `~${Math.round(messages.reduce((acc, m) => acc + (m.content?.length ?? 0), 0) / 4).toLocaleString()} tokens`,
    },
    { label: '最近压缩', value: compactions[0]?.summary ?? '无' },
    { label: '子会话', value: `${childSessions.length} 个` },
    { label: '任务', value: `${sessionTasks.length} 项` },
    { label: '主待办', value: `${mainActiveCount}/${mainTodos.length} 项` },
    { label: '临时待办', value: `${tempActiveCount}/${tempTodos.length} 项` },
    { label: '待处理审批', value: `${pendingPermissions.length} 项` },
  ];
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
  const contextSummaryText = contextUsageSnapshot
    ? `${contextUsageSnapshot.estimated ? '估算' : '精确'}用量 ${Math.round((contextUsageSnapshot.usedTokens / Math.max(1, contextUsageSnapshot.maxTokens)) * 100)}%`
    : '当前模型未暴露上下文窗口';
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div
        style={{
          ...PANEL_SECTION_STYLE,
          display: 'grid',
          gridTemplateColumns: 'minmax(68px, 88px) 1fr',
          gap: 1,
          padding: 1,
          overflow: 'hidden',
        }}
      >
        {overviewRows.map(({ label, value }, idx) => (
          <div
            key={label}
            style={{
              display: 'contents',
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: 'var(--text-3)',
                padding: '5px 8px',
                lineHeight: 1.35,
                background:
                  idx % 2 === 0
                    ? 'color-mix(in oklch, var(--surface) 68%, transparent)'
                    : 'color-mix(in oklch, var(--surface) 54%, transparent)',
              }}
            >
              {label}
            </div>
            <div
              style={{
                fontSize: 11,
                color: 'var(--text)',
                padding: '5px 8px',
                overflowWrap: 'anywhere',
                textAlign: 'right',
                lineHeight: 1.4,
                background:
                  idx % 2 === 0
                    ? 'color-mix(in oklch, var(--surface) 68%, transparent)'
                    : 'color-mix(in oklch, var(--surface) 54%, transparent)',
              }}
              title={value}
            >
              {value}
            </div>
          </div>
        ))}
      </div>
      <div style={PANEL_SECTION_STYLE}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={PANEL_SECTION_EYEBROW_STYLE}>会话状态</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', lineHeight: 1.4 }}>
              {sessionStateStatus === 'paused' ? '等待处理中的会话' : '运行恢复已就绪'}
            </div>
          </div>
          <button type="button" style={PANEL_ACTION_LINK_STYLE} onClick={onOpenRecoveryStrategy}>
            打开恢复详情
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.5 }}>
          {recoverySummary}
        </div>
        <div
          style={{
            marginTop: 8,
            paddingTop: 8,
            borderTop: '1px solid color-mix(in oklch, var(--border) 60%, transparent)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={PANEL_SECTION_EYEBROW_STYLE}>内容产物</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', lineHeight: 1.4 }}>
                {artifactCountLabel}
              </div>
            </div>
            {artifactsWorkspaceHref ? (
              <Link style={PANEL_ACTION_LINK_STYLE} to={artifactsWorkspaceHref}>
                打开产物工作区
              </Link>
            ) : (
              <span aria-disabled="true" style={PANEL_ACTION_DISABLED_STYLE}>
                打开产物工作区
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.5, marginTop: 4 }}>
            {artifactDescription}
          </div>
        </div>
      </div>
      <div style={PANEL_SECTION_STYLE}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={PANEL_SECTION_EYEBROW_STYLE}>上下文</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', lineHeight: 1.4 }}>
              {contextSummaryText}
            </div>
          </div>
          <button type="button" style={PANEL_ACTION_LINK_STYLE} onClick={onCompactSession}>
            立即压缩会话
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.45 }}>
          {[
            yoloMode ? '⚡ YOLO 模式' : '',
            attachmentItems.length > 0 ? `📎 ${attachmentItems.length} 附件` : '',
            workspaceFileItems.length > 0 ? `📂 ${workspaceFileItems.length} 索引文件` : '',
          ]
            .filter(Boolean)
            .join('  ·  ') || <span style={{ color: 'var(--text-3)' }}>无额外上下文注入</span>}
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
