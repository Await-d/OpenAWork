import type { CSSProperties } from 'react';
import { TeammateCard } from './TeammateCard.js';
import type { TeamMember } from './TeammateCard.js';

export type { MemberStatus, TeamMember } from './TeammateCard.js';

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface TeamTask {
  id: string;
  title: string;
  assignedTo?: string;
  status: TaskStatus;
}

export interface TeamMessage {
  id: string;
  memberId: string;
  content: string;
  timestamp: number;
  type: 'update' | 'question' | 'result' | 'error';
}

export interface TeamPanelProps {
  teamName: string;
  description?: string;
  members: TeamMember[];
  tasks: TeamTask[];
  messages?: TeamMessage[];
  style?: CSSProperties;
}

const TASK_STATUS_COLOR: Record<TaskStatus, string> = {
  pending: 'var(--color-muted, #94a3b8)',
  in_progress: '#38bdf8',
  completed: '#34d399',
  failed: '#f87171',
};

const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  pending: '待处理',
  in_progress: '进行中',
  completed: '已完成',
  failed: '失败',
};

const MSG_TYPE_COLOR: Record<TeamMessage['type'], string> = {
  update: '#38bdf8',
  question: '#facc15',
  result: '#34d399',
  error: '#f87171',
};

const MSG_TYPE_ICON: Record<TeamMessage['type'], string> = {
  update: '↻',
  question: '?',
  result: '✓',
  error: '✕',
};

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function TeamPanel({
  teamName,
  description,
  members,
  tasks,
  messages = [],
  style,
}: TeamPanelProps) {
  const working = members.filter((m) => m.status === 'working').length;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        border: '1px solid var(--color-border, #334155)',
        borderRadius: 10,
        overflow: 'hidden',
        background: 'var(--color-surface, #1e293b)',
        ...style,
      }}
    >
      <div
        style={{
          padding: '0.6rem 0.875rem',
          borderBottom: '1px solid var(--color-border, #334155)',
          background: 'var(--color-surface-raised, #0f172a)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--color-muted, #94a3b8)',
              textTransform: 'uppercase',
              letterSpacing: 0.6,
            }}
          >
            {teamName}
          </span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: working > 0 ? '#38bdf8' : 'var(--color-muted, #94a3b8)',
              background: working > 0 ? '#0c4a6e' : 'var(--color-surface, #1e293b)',
              border: `1px solid ${working > 0 ? '#38bdf840' : 'var(--color-border, #334155)'}`,
              borderRadius: 4,
              padding: '0.15rem 0.45rem',
            }}
          >
            {working}/{members.length} active
          </span>
        </div>
        {description && (
          <div
            style={{
              fontSize: 11,
              color: 'var(--color-muted, #94a3b8)',
              marginTop: 2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {description}
          </div>
        )}
      </div>

      <div
        style={{
          borderBottom: '1px solid var(--color-border, #334155)',
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: 'var(--color-muted, #94a3b8)',
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            padding: '0.35rem 0.875rem 0.2rem',
          }}
        >
          Members
        </div>
        {members.length === 0 ? (
          <div
            style={{
              padding: '0.6rem 0.875rem',
              fontSize: 12,
              color: 'var(--color-muted, #94a3b8)',
            }}
          >
            No members
          </div>
        ) : (
          members.map((m, i) => (
            <TeammateCard
              key={m.id}
              member={m}
              style={{
                borderTop: i > 0 ? '1px solid var(--color-border, #334155)' : 'none',
              }}
            />
          ))
        )}
      </div>

      <div
        style={{
          borderBottom: messages.length > 0 ? '1px solid var(--color-border, #334155)' : 'none',
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: 'var(--color-muted, #94a3b8)',
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            padding: '0.35rem 0.875rem 0.2rem',
          }}
        >
          Tasks ({tasks.length})
        </div>
        {tasks.length === 0 ? (
          <div
            style={{
              padding: '0.6rem 0.875rem',
              fontSize: 12,
              color: 'var(--color-muted, #94a3b8)',
            }}
          >
            No tasks
          </div>
        ) : (
          tasks.map((t, i) => (
            <div
              key={t.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '0.5rem 0.875rem',
                borderTop: i > 0 ? '1px solid var(--color-border, #334155)' : 'none',
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: TASK_STATUS_COLOR[t.status],
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  flex: 1,
                  fontSize: 12,
                  color:
                    t.status === 'completed'
                      ? 'var(--color-muted, #94a3b8)'
                      : 'var(--color-text, #f1f5f9)',
                  textDecoration: t.status === 'completed' ? 'line-through' : 'none',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {t.title}
              </span>
              {t.assignedTo && (
                <span style={{ fontSize: 10, color: 'var(--color-muted, #94a3b8)', flexShrink: 0 }}>
                  @{t.assignedTo}
                </span>
              )}
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: TASK_STATUS_COLOR[t.status],
                  background: 'var(--color-surface-raised, #0f172a)',
                  border: `1px solid ${TASK_STATUS_COLOR[t.status]}40`,
                  borderRadius: 4,
                  padding: '0.1rem 0.4rem',
                  flexShrink: 0,
                }}
              >
                {TASK_STATUS_LABEL[t.status]}
              </span>
            </div>
          ))
        )}
      </div>

      {messages.length > 0 && (
        <div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: 'var(--color-muted, #94a3b8)',
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              padding: '0.35rem 0.875rem 0.2rem',
            }}
          >
            Messages
          </div>
          {messages.map((msg, i) => (
            <div
              key={msg.id}
              style={{
                display: 'flex',
                gap: 8,
                padding: '0.45rem 0.875rem',
                borderTop: i > 0 ? '1px solid var(--color-border, #334155)' : 'none',
              }}
            >
              <span
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 4,
                  background: 'var(--color-surface-raised, #0f172a)',
                  border: `1px solid ${MSG_TYPE_COLOR[msg.type]}40`,
                  color: MSG_TYPE_COLOR[msg.type],
                  fontSize: 10,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  marginTop: 1,
                }}
              >
                {MSG_TYPE_ICON[msg.type]}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 1 }}>
                  <span
                    style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text, #f1f5f9)' }}
                  >
                    {msg.memberId}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--color-muted, #94a3b8)' }}>
                    {formatTime(msg.timestamp)}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--color-muted, #94a3b8)',
                    lineHeight: 1.4,
                    wordBreak: 'break-word',
                  }}
                >
                  {msg.content}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
