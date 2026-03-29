import React from 'react';
import type { Session, SessionTask } from '@openAwork/web-client';

type SubAgentStatus = SessionTask['status'];
type SubAgentDisplayStatus = SubAgentStatus | 'paused';

export interface SubAgentRunItem {
  sessionId: string;
  shortSessionId: string;
  status: SubAgentDisplayStatus;
  taskLabel: string;
  title: string;
  assignedAgent?: string;
  result?: string;
  errorMessage?: string;
}

function getStatusStyle(status: SubAgentDisplayStatus): React.CSSProperties {
  if (status === 'running') {
    return {
      background: 'color-mix(in oklch, var(--accent) 18%, var(--surface))',
      border: '1px solid color-mix(in oklch, var(--accent) 42%, var(--border))',
      color: 'var(--accent)',
    };
  }

  if (status === 'paused') {
    return {
      background: 'color-mix(in srgb, #f59e0b 10%, var(--surface))',
      border: '1px solid color-mix(in srgb, #f59e0b 30%, var(--border))',
      color: '#fcd34d',
    };
  }

  if (status === 'completed') {
    return {
      background: 'color-mix(in srgb, #34d399 12%, var(--surface))',
      border: '1px solid color-mix(in srgb, #34d399 35%, var(--border))',
      color: '#86efac',
    };
  }

  if (status === 'failed' || status === 'cancelled') {
    return {
      background: 'color-mix(in srgb, #ef4444 10%, var(--surface))',
      border: '1px solid color-mix(in srgb, #ef4444 30%, var(--border))',
      color: '#fca5a5',
    };
  }

  return {
    background: 'color-mix(in srgb, #f59e0b 10%, var(--surface))',
    border: '1px solid color-mix(in srgb, #f59e0b 30%, var(--border))',
    color: '#fcd34d',
  };
}

function getStatusLabel(status: SubAgentDisplayStatus): string {
  if (status === 'running') return '运行中';
  if (status === 'paused') return '等待处理';
  if (status === 'completed') return '已完成';
  if (status === 'failed') return '失败';
  if (status === 'cancelled') return '已取消';
  return '待执行';
}

function normalizeTitle(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : fallback;
}

function shouldShowTaskLabel(item: SubAgentRunItem): boolean {
  return item.taskLabel.trim().length > 0 && item.taskLabel.trim() !== item.title.trim();
}

function truncateSummary(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

function statusWeight(status: SubAgentDisplayStatus): number {
  if (status === 'running') return 0;
  if (status === 'paused') return 1;
  if (status === 'failed') return 2;
  if (status === 'pending') return 3;
  if (status === 'completed') return 4;
  return 5;
}

function mapSessionStateToSubAgentStatus(
  stateStatus: Session['state_status'],
): SubAgentDisplayStatus {
  if (stateStatus === 'running') {
    return 'running';
  }

  if (stateStatus === 'paused') {
    return 'paused';
  }

  return 'pending';
}

function resolveExistingItemStatus(
  existingStatus: SubAgentDisplayStatus | undefined,
  sessionStateStatus: Session['state_status'],
): SubAgentDisplayStatus | undefined {
  if (sessionStateStatus !== 'paused') {
    return existingStatus;
  }

  if (
    existingStatus === 'completed' ||
    existingStatus === 'failed' ||
    existingStatus === 'cancelled'
  ) {
    return existingStatus;
  }

  return 'paused';
}

export function buildSubAgentRunItems(
  childSessions: Session[],
  sessionTasks: SessionTask[],
): SubAgentRunItem[] {
  const itemsBySessionId = new Map<string, SubAgentRunItem>();
  const childSessionsById = new Map(childSessions.map((session) => [session.id, session]));

  for (const task of sessionTasks) {
    if (!task.sessionId) {
      continue;
    }

    const childSession = childSessionsById.get(task.sessionId);
    const shortSessionId = task.sessionId.slice(0, 8);
    itemsBySessionId.set(task.sessionId, {
      sessionId: task.sessionId,
      shortSessionId,
      status: resolveExistingItemStatus(task.status, childSession?.state_status) ?? task.status,
      taskLabel: normalizeTitle(task.title, `子代理 ${shortSessionId}`),
      title: normalizeTitle(
        childSession?.title,
        normalizeTitle(task.title, `子代理 ${shortSessionId}`),
      ),
      assignedAgent: task.assignedAgent,
      result: task.result,
      errorMessage: task.errorMessage,
    });
  }

  for (const session of childSessions) {
    const existing = itemsBySessionId.get(session.id);
    const shortSessionId = session.id.slice(0, 8);
    const existingStatus = resolveExistingItemStatus(existing?.status, session.state_status);
    itemsBySessionId.set(session.id, {
      sessionId: session.id,
      shortSessionId,
      status: existingStatus ?? mapSessionStateToSubAgentStatus(session.state_status),
      taskLabel: existing?.taskLabel ?? normalizeTitle(session.title, `子代理 ${shortSessionId}`),
      title: normalizeTitle(session.title, existing?.title ?? `子代理 ${shortSessionId}`),
      assignedAgent: existing?.assignedAgent,
      result: existing?.result,
      errorMessage: existing?.errorMessage,
    });
  }

  return Array.from(itemsBySessionId.values()).sort((left, right) => {
    const byStatus = statusWeight(left.status) - statusWeight(right.status);
    if (byStatus !== 0) {
      return byStatus;
    }

    return left.title.localeCompare(right.title, 'zh-CN');
  });
}

export function SubAgentRunList({
  items,
  selectedSessionId,
  onSelectSession,
}: {
  items: SubAgentRunItem[];
  onSelectSession: (sessionId: string) => void;
  selectedSessionId: string | null;
}) {
  if (items.length === 0) {
    return null;
  }

  const selectedItem = items.find((item) => item.sessionId === selectedSessionId) ?? null;

  return (
    <section
      aria-label="子代理运行列表"
      style={{
        padding: '1px 10px 4px',
        background: 'transparent',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          maxWidth: 740,
          margin: '0 auto',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 6,
            minWidth: 0,
            flexWrap: 'wrap',
          }}
        >
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, flexWrap: 'wrap' }}
          >
            <div
              style={{
                fontSize: 9,
                fontWeight: 800,
                color: 'var(--text-2)',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}
            >
              子代理运行
            </div>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '0 5px',
                borderRadius: 999,
                border: '1px solid var(--border-subtle)',
                background: 'color-mix(in oklch, var(--surface) 82%, transparent)',
                fontSize: 8.5,
                fontWeight: 700,
                color: 'var(--text-3)',
              }}
            >
              {items.length} 个子会话
            </span>
            {selectedItem && (
              <span
                style={{
                  minWidth: 0,
                  fontSize: 8.5,
                  color: 'var(--text-3)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: 280,
                }}
                title={selectedItem.title}
              >
                焦点 · {selectedItem.title}
              </span>
            )}
          </div>
          <div style={{ fontSize: 8.5, color: 'var(--text-3)' }}>Alt↑↓</div>
        </div>
        <div
          style={{
            display: 'flex',
            gap: 4,
            overflowX: 'auto',
            paddingBottom: 0,
            scrollbarWidth: 'thin',
          }}
        >
          {items.map((item) => {
            const selected = item.sessionId === selectedSessionId;
            const showTaskLabel = shouldShowTaskLabel(item);
            return (
              <button
                key={item.sessionId}
                type="button"
                onClick={() => onSelectSession(item.sessionId)}
                aria-pressed={selected}
                style={{
                  flexShrink: 0,
                  minWidth: 162,
                  maxWidth: 286,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'stretch',
                  gap: 3,
                  padding: '6px 8px',
                  borderRadius: 9,
                  border: selected
                    ? '1px solid color-mix(in oklch, var(--accent) 50%, var(--border-subtle))'
                    : '1px solid var(--border-subtle)',
                  background: selected
                    ? 'color-mix(in oklch, var(--surface) 84%, var(--accent) 16%)'
                    : 'color-mix(in oklch, var(--surface) 94%, transparent)',
                  color: 'var(--text)',
                  boxShadow: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background 140ms ease, border-color 140ms ease, color 140ms ease',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 6,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      minWidth: 0,
                      flex: 1,
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        flexShrink: 0,
                        background:
                          item.status === 'running'
                            ? 'var(--accent)'
                            : item.status === 'completed'
                              ? '#34d399'
                              : item.status === 'failed'
                                ? '#ef4444'
                                : '#f59e0b',
                        boxShadow:
                          item.status === 'running'
                            ? '0 0 0 2px color-mix(in oklch, var(--accent) 16%, transparent)'
                            : 'none',
                      }}
                    />
                    <span
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        minWidth: 0,
                        flex: 1,
                      }}
                    >
                      <span
                        style={{
                          minWidth: 0,
                          flex: 1,
                          fontSize: 10,
                          fontWeight: 700,
                          color: 'var(--text)',
                          lineHeight: 1.15,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={item.title}
                      >
                        {item.title}
                      </span>
                      {item.assignedAgent && (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 2,
                            fontSize: 7.5,
                            fontWeight: 700,
                            color: 'color-mix(in oklch, var(--accent) 80%, var(--text-3))',
                            background: 'color-mix(in oklch, var(--accent) 10%, transparent)',
                            border:
                              '1px solid color-mix(in oklch, var(--accent) 24%, var(--border))',
                            borderRadius: 999,
                            padding: '0 4px',
                            letterSpacing: '0.01em',
                            maxWidth: 84,
                            flexShrink: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={item.assignedAgent}
                        >
                          ◈ {item.assignedAgent}
                        </span>
                      )}
                    </span>
                  </div>
                  <span
                    style={{
                      flexShrink: 0,
                      display: 'inline-flex',
                      alignItems: 'center',
                      padding: '1px 5px',
                      borderRadius: 999,
                      fontSize: 8.5,
                      fontWeight: 700,
                      ...getStatusStyle(item.status),
                    }}
                  >
                    {getStatusLabel(item.status)}
                  </span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    minWidth: 0,
                  }}
                >
                  <span
                    style={{
                      fontSize: 8.5,
                      color: 'var(--text-3)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      minWidth: 0,
                      flex: showTaskLabel ? '0 1 auto' : 1,
                    }}
                    title={
                      showTaskLabel
                        ? `${item.shortSessionId} · ${item.taskLabel}`
                        : item.shortSessionId
                    }
                  >
                    会话 · {item.shortSessionId}
                    {showTaskLabel ? ` · ${item.taskLabel}` : ''}
                  </span>
                  {(item.errorMessage ?? item.result) && (
                    <span
                      style={{
                        fontSize: 7.5,
                        color: item.errorMessage
                          ? '#fca5a5'
                          : 'color-mix(in srgb, #86efac 90%, var(--text-3))',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        minWidth: 0,
                        flex: 1,
                        textAlign: 'right',
                      }}
                      title={item.errorMessage ?? item.result}
                    >
                      {truncateSummary(item.errorMessage ?? item.result ?? '', 32)}
                    </span>
                  )}
                  {selected && (
                    <span
                      style={{
                        flexShrink: 0,
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '0 4px',
                        borderRadius: 999,
                        background: 'color-mix(in oklch, var(--accent) 16%, transparent)',
                        color: 'var(--accent)',
                        fontSize: 8,
                        fontWeight: 700,
                      }}
                    >
                      当前查看
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
