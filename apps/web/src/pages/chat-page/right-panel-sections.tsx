import type { PendingPermissionRequest, Session, SessionTask } from '@openAwork/web-client';
import { PlanHistoryPanel } from '@openAwork/shared-ui';
import type { AttachmentItem, HistoricalPlan } from '@openAwork/shared-ui';
import type { DialogueMode } from '../dialogue-mode.js';
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
    return '执行失败';
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

function SessionTodoPanel(props: { sessionTodos: SessionTodoItem[]; title: string }) {
  const activeCount = props.sessionTodos.filter((todo) => todo.status !== 'completed').length;

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 7,
          marginBottom: 2,
        }}
      >
        <div
          style={{
            fontSize: 10,
            color: 'var(--text-3)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          {props.title}
        </div>
        <div
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
          {activeCount}/{props.sessionTodos.length}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {props.sessionTodos.map((todo, index) => {
          const tone = getSessionTodoBadgeTone(todo);
          return (
            <div
              key={`${todo.content}-${index}`}
              style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '1px 0' }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                <span style={{ color: todo.status === 'completed' ? '#34d399' : '#fbbf24' }}>
                  {todo.status === 'completed' ? '●' : todo.status === 'in_progress' ? '◐' : '○'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--text)',
                      fontWeight: 600,
                      textDecoration:
                        todo.status === 'completed' || todo.status === 'cancelled'
                          ? 'line-through'
                          : 'none',
                    }}
                  >
                    {todo.content}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', paddingLeft: 18 }}>
                <span
                  style={{
                    fontSize: 10,
                    lineHeight: 1,
                    padding: '1px 4px',
                    borderRadius: 999,
                    ...tone,
                  }}
                >
                  {formatSessionTodoStatus(todo)}
                </span>
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
                  {getSessionTodoPriorityLabel(todo)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
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

  return (
    <div style={{ ...sharedUiThemeVars, display: 'flex', flexDirection: 'column', gap: 7 }}>
      {compactions.length > 0 && (
        <div
          style={{
            borderBottom: '1px solid var(--border-subtle)',
            paddingBottom: 6,
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: 'var(--text-3)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              marginBottom: 3,
            }}
          >
            会话压缩
          </div>
          {compactions.map((item) => (
            <div key={item.id} style={{ fontSize: 12, color: 'var(--text)', marginBottom: 5 }}>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>
                {item.trigger === 'manual' ? '手动压缩' : '自动压缩'}
              </div>
              <div style={{ color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>{item.summary}</div>
            </div>
          ))}
        </div>
      )}
      {childSessions.length > 0 && (
        <div
          style={{
            borderTop: '1px solid var(--border-subtle)',
            paddingTop: 6,
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: 'var(--text-3)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              marginBottom: 2,
            }}
          >
            子会话
          </div>
          {childSessions.map((session) => (
            <button
              key={session.id}
              type="button"
              onClick={() => onOpenSession(session.id)}
              style={{
                width: '100%',
                textAlign: 'left',
                border: 'none',
                background: 'transparent',
                color: 'var(--text)',
                padding: '2px 0',
                cursor: 'pointer',
                fontSize: 12,
                textDecoration: 'none',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.textDecoration = 'underline';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.textDecoration = 'none';
              }}
            >
              {session.title ?? '未命名'} · {session.id.slice(0, 8)}…
            </button>
          ))}
        </div>
      )}
      {sessionTasks.length > 0 && (
        <div
          style={{
            borderTop: '1px solid var(--border-subtle)',
            paddingTop: 6,
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: 'var(--text-3)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              marginBottom: 2,
            }}
          >
            任务状态
          </div>
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
              {(task.errorMessage ?? task.result) && (
                <div
                  style={{
                    marginTop: 2,
                    marginLeft: task.depth && task.depth > 0 ? 16 : 0,
                    fontSize: 10,
                    color: task.errorMessage
                      ? '#fca5a5'
                      : 'color-mix(in srgb, #86efac 90%, var(--text-3))',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                  title={task.errorMessage ?? task.result}
                >
                  {task.errorMessage ? `✗ ${task.errorMessage}` : `✓ ${task.result ?? ''}`}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {mainTodos.length > 0 && <SessionTodoPanel sessionTodos={mainTodos} title="主待办" />}
      {tempTodos.length > 0 && <SessionTodoPanel sessionTodos={tempTodos} title="临时待办" />}
      {pendingPermissions.length > 0 && (
        <div
          style={{
            borderTop: '1px solid var(--border-subtle)',
            paddingTop: 6,
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: 'var(--text-3)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              marginBottom: 2,
            }}
          >
            待处理审批
          </div>
          {pendingPermissions.map((permission, idx) => (
            <div
              key={permission.requestId}
              style={{
                paddingTop: idx > 0 ? 5 : 0,
                marginTop: idx > 0 ? 5 : 0,
                borderTop: idx > 0 ? '1px solid var(--border-subtle)' : 'none',
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>
                {permission.toolName}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 1 }}>
                {permission.reason}
              </div>
              <div style={{ color: 'var(--text-3)', fontSize: 10, marginTop: 1 }}>
                {permission.scope} · {permission.riskLevel}
                {permission.previewAction ? ` · ${permission.previewAction}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}
      <PlanHistoryPanel plans={planHistory} />
    </div>
  );
}

export function ChatOverviewTabContent(props: {
  attachmentItems: AttachmentItem[];
  childSessions: Session[];
  compactions: CompactionItem[];
  currentSessionId: string | null;
  dialogueMode: DialogueMode;
  effectiveWorkingDirectory: string | null;
  messages: ChatMessage[];
  pendingPermissions: PendingPermissionRequest[];
  sessionTodos: SessionTodoItem[];
  sessionTasks: HierarchicalSessionTask[];
  workspaceFileItems: WorkspaceFileMentionItem[];
  yoloMode: boolean;
}) {
  const {
    attachmentItems,
    childSessions,
    compactions,
    currentSessionId,
    dialogueMode,
    effectiveWorkingDirectory,
    messages,
    pendingPermissions,
    sessionTodos,
    sessionTasks,
    workspaceFileItems,
    yoloMode,
  } = props;
  const { mainTodos, tempTodos } = splitSessionTodosByLane(sessionTodos);
  const mainActiveCount = mainTodos.filter((todo) => todo.status !== 'completed').length;
  const tempActiveCount = tempTodos.filter((todo) => todo.status !== 'completed').length;

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
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
                padding: '2px 5px',
                background:
                  idx % 2 === 0
                    ? 'color-mix(in oklch, var(--surface) 60%, transparent)'
                    : 'transparent',
              }}
            >
              {label}
            </div>
            <div
              style={{
                fontSize: 11,
                color: 'var(--text)',
                padding: '2px 5px',
                wordBreak: 'break-all',
                textAlign: 'right',
                background:
                  idx % 2 === 0
                    ? 'color-mix(in oklch, var(--surface) 60%, transparent)'
                    : 'transparent',
              }}
            >
              {value}
            </div>
          </div>
        ))}
      </div>
      <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 6 }}>
        <div
          style={{
            fontSize: 10,
            color: 'var(--text-3)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            marginBottom: 2,
          }}
        >
          上下文注入
        </div>
        {yoloMode && (
          <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 2 }}>
            ⚡ YOLO 模式已开启
          </div>
        )}
        {attachmentItems.length > 0 && (
          <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 2 }}>
            📎 引用文件 {attachmentItems.length} 个
          </div>
        )}
        {workspaceFileItems.length > 0 && (
          <div style={{ fontSize: 11, color: 'var(--text-2)' }}>
            📂 已索引 {workspaceFileItems.length} 个工作区文件
          </div>
        )}
        {!yoloMode && attachmentItems.length === 0 && workspaceFileItems.length === 0 && (
          <div style={{ fontSize: 11, color: 'var(--text-3)' }}>无额外上下文</div>
        )}
      </div>
    </div>
  );
}
