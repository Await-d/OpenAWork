import { useMemo } from 'react';

/**
 * Task/Session 列表专门预览组件
 * 提供：卡片视图、状态标识、格式化的时间戳
 */

export interface TaskLike {
  id?: string;
  subject?: string;
  description?: string;
  status?: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  owner?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface SessionLike {
  id?: string;
  name?: string;
  status?: string;
  createdAt?: string;
  lastActivity?: string;
  messageCount?: number;
}

/**
 * 识别任务列表输出
 */
export function extractTaskListFromOutput(output: unknown): TaskLike[] | null {
  if (!output || typeof output !== 'object') return null;
  const r = output as Record<string, unknown>;

  // 检查是否为任务数组
  if (Array.isArray(r.tasks)) {
    return r.tasks as TaskLike[];
  }
  if (Array.isArray(output)) {
    // 检查第一个元素是否像任务
    const first = (output as any[])[0];
    if (first && typeof first === 'object' && ('subject' in first || 'status' in first)) {
      return output as TaskLike[];
    }
  }
  return null;
}

/**
 * 识别会话列表输出
 */
export function extractSessionListFromOutput(output: unknown): SessionLike[] | null {
  if (!output || typeof output !== 'object') return null;
  const r = output as Record<string, unknown>;

  if (Array.isArray(r.sessions)) {
    return r.sessions as SessionLike[];
  }
  if (Array.isArray(output)) {
    const first = (output as any[])[0];
    if (
      first &&
      typeof first === 'object' &&
      ('messageCount' in first || 'lastActivity' in first)
    ) {
      return output as SessionLike[];
    }
  }
  return null;
}

const STATUS_LABELS: Record<string, string> = {
  pending: '待处理',
  in_progress: '进行中',
  completed: '已完成',
  cancelled: '已取消',
};

export function TaskListPreview({ tasks }: { tasks: TaskLike[] }) {
  const summary = useMemo(() => {
    const total = tasks.length;
    const completed = tasks.filter((t) => t.status === 'completed').length;
    const inProgress = tasks.filter((t) => t.status === 'in_progress').length;
    const pending = tasks.filter((t) => t.status === 'pending').length;
    return { total, completed, inProgress, pending };
  }, [tasks]);

  if (tasks.length === 0) {
    return <div className="task-list-empty">没有任务</div>;
  }

  return (
    <div className="task-list-preview">
      <div className="task-list-summary">
        <span className="task-list-total">共 {summary.total} 个任务</span>
        {summary.completed > 0 && (
          <span className="task-list-stat" data-status="completed">
            {summary.completed} 已完成
          </span>
        )}
        {summary.inProgress > 0 && (
          <span className="task-list-stat" data-status="in_progress">
            {summary.inProgress} 进行中
          </span>
        )}
        {summary.pending > 0 && (
          <span className="task-list-stat" data-status="pending">
            {summary.pending} 待处理
          </span>
        )}
      </div>
      <div className="task-list-items">
        {tasks.map((task, idx) => (
          <div
            key={task.id || idx}
            className="task-list-item"
            data-status={task.status || 'pending'}
          >
            <div className="task-list-item-header">
              <span className="task-list-item-status">
                {STATUS_LABELS[task.status || 'pending'] || task.status}
              </span>
              {task.id && <span className="task-list-item-id">#{task.id}</span>}
            </div>
            <div className="task-list-item-subject">{task.subject || '无标题'}</div>
            {task.description && (
              <div className="task-list-item-description">{task.description}</div>
            )}
            <div className="task-list-item-meta">
              {task.owner && <span>负责人: {task.owner}</span>}
              {task.updatedAt && <span>更新: {formatTimestamp(task.updatedAt)}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SessionListPreview({ sessions }: { sessions: SessionLike[] }) {
  if (sessions.length === 0) {
    return <div className="session-list-empty">没有会话</div>;
  }

  return (
    <div className="session-list-preview">
      <div className="session-list-summary">
        <span className="session-list-total">共 {sessions.length} 个会话</span>
      </div>
      <div className="session-list-items">
        {sessions.map((session, idx) => (
          <div key={session.id || idx} className="session-list-item">
            <div className="session-list-item-header">
              <span className="session-list-item-name">{session.name || `会话 ${idx + 1}`}</span>
              {session.id && <span className="session-list-item-id">{session.id}</span>}
            </div>
            <div className="session-list-item-meta">
              {session.messageCount !== undefined && <span>{session.messageCount} 条消息</span>}
              {session.lastActivity && (
                <span>最后活动: {formatTimestamp(session.lastActivity)}</span>
              )}
              {session.status && <span className="session-list-item-status">{session.status}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatTimestamp(ts: string): string {
  try {
    const date = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return '刚刚';
    if (diffMins < 60) return `${diffMins}分钟前`;

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}小时前`;

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}天前`;

    return date.toLocaleDateString('zh-CN');
  } catch {
    return ts;
  }
}
