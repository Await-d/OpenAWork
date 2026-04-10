import { useMemo, useState } from 'react';
import type {
  SharedSessionDetailRecord,
  SharedSessionSummaryRecord,
  SessionTask,
  TeamAuditLogRecord,
  TeamMemberRecord,
  TeamMessageRecord,
  TeamRuntimeSessionRecord,
  TeamSessionShareRecord,
  TeamTaskRecord,
} from '@openAwork/web-client';
import type { TeamActionFeedback } from '../use-team-collaboration.js';
import {
  TeamAuditPanel,
  TeamMembersPanel,
  TeamMessagesPanel,
  TeamSessionSharesPanel,
  TeamSharedSessionsPanel,
  TeamTasksPanel,
  TeamSectionHeader,
  getTaskStatusMeta,
} from '../team-page-sections.js';
import {
  ALL_WORKSPACES_KEY,
  formatChangeSourceKind,
  formatSnapshotScopeKind,
  formatWorkspaceLabel,
  getSharedSessionStateLabel,
  type TeamRuntimeMetric,
} from './team-runtime-model.js';
import { TeamRuntimeBuddy } from './team-runtime-buddy.js';
import { useTeamRuntimeProjection } from './use-team-runtime-projection.js';
import type { WorkspaceSessionTreeNode } from '../../../utils/session-grouping.js';

type RuntimeTabKey =
  | 'overview'
  | 'sessions'
  | 'tasks'
  | 'context'
  | 'timeline'
  | 'artifacts'
  | 'changes';

interface MemberFormState {
  avatarUrl: string;
  email: string;
  name: string;
  role: TeamMemberRecord['role'];
}

interface TaskFormState {
  assigneeId: string;
  priority: TeamTaskRecord['priority'];
  title: string;
}

interface MessageFormState {
  content: string;
  senderId: string;
  type: TeamMessageRecord['type'];
}

interface ShareFormState {
  memberId: string;
  permission: TeamSessionShareRecord['permission'];
  sessionId: string;
}

interface TeamRuntimeShellProps {
  auditLogs: TeamAuditLogRecord[];
  busy: boolean;
  error: string | null;
  feedback: TeamActionFeedback | null;
  loading: boolean;
  memberForm: MemberFormState;
  members: TeamMemberRecord[];
  messageForm: MessageFormState;
  messages: TeamMessageRecord[];
  onCreateMember: () => void;
  onCreateMessage: () => void;
  onCreateSessionShare: () => void;
  onCreateSharedComment: () => void;
  onCreateTask: () => void;
  onDeleteSessionShare: (shareId: string) => void;
  onCreateInteractionMessage: (content: string) => Promise<boolean>;
  onMemberFormChange: (patch: Partial<MemberFormState>) => void;
  onMessageFormChange: (patch: Partial<MessageFormState>) => void;
  onReplySharedPermission: (
    requestId: string,
    decision: 'once' | 'session' | 'permanent' | 'reject',
  ) => void;
  onReplySharedQuestion: (input: {
    answers?: string[][];
    requestId: string;
    status: 'answered' | 'dismissed';
  }) => void;
  onSelectSharedSession: (sessionId: string) => void;
  onSessionSharePermissionChange: (
    shareId: string,
    permission: TeamSessionShareRecord['permission'],
  ) => void;
  onShareFormChange: (patch: Partial<ShareFormState>) => void;
  onSharedCommentDraftChange: (value: string) => void;
  onTaskFormChange: (patch: Partial<TaskFormState>) => void;
  onTaskStatusChange: (taskId: string, status: 'in_progress' | 'completed' | 'failed') => void;
  selectedSharedSession: SharedSessionDetailRecord | null;
  selectedSharedSessionId: string | null;
  sessionShares: TeamSessionShareRecord[];
  sessions: TeamRuntimeSessionRecord[];
  shareForm: ShareFormState;
  sharedCommentBusy: boolean;
  sharedCommentDraft: string;
  sharedOperateBusy: boolean;
  sharedOperateError: string | null;
  sharedSessionLoading: boolean;
  sharedSessions: SharedSessionSummaryRecord[];
  taskForm: TaskFormState;
  runtimeTaskRecords: TeamTaskRecord[];
  runtimeTasks: SessionTask[];
  runtimeTasksLoading: boolean;
  tasks: TeamTaskRecord[];
}

const tabs: Array<{ key: RuntimeTabKey; label: string; summary: string }> = [
  { key: 'overview', label: '总览', summary: '工作区全局状态与任务节奏摘要' },
  { key: 'sessions', label: '会话 / Agent', summary: '共享会话、活跃主体与运行详情' },
  { key: 'tasks', label: '任务看板', summary: '任务推进、阻塞与负责关系' },
  { key: 'context', label: '文件上下文', summary: '共享范围、工作区上下文与会话授权' },
  { key: 'timeline', label: '消息时间线', summary: '团队消息、审计与协作事件流' },
  { key: 'artifacts', label: '产物', summary: '当前共享会话的输出摘要与产物预留' },
  { key: 'changes', label: 'Git / 变更', summary: '文件改动、快照与变更热区' },
];

const tabListStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
  padding: 4,
  borderRadius: 22,
  border: '1px solid color-mix(in srgb, var(--border) 78%, transparent)',
  background: 'color-mix(in srgb, var(--surface) 92%, rgba(15, 23, 42, 0.2))',
};

const activeTabStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: 999,
  border: '1px solid color-mix(in srgb, var(--accent) 40%, transparent)',
  background: 'linear-gradient(135deg, rgba(91, 140, 255, 0.24), rgba(91, 140, 255, 0.08))',
  color: 'var(--text)',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
};

const inactiveTabStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: 999,
  border: '1px solid transparent',
  background: 'transparent',
  color: 'var(--text-3)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};

function EmptyState({ description, title }: { description: string; title: string }) {
  return (
    <div
      className="content-card"
      style={{
        display: 'grid',
        gap: 8,
        padding: 18,
        color: 'var(--text-3)',
      }}
    >
      <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{title}</span>
      <span style={{ fontSize: 13, lineHeight: 1.7 }}>{description}</span>
    </div>
  );
}

function RuntimeMetricGrid({ metrics }: { metrics: TeamRuntimeMetric[] }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(144px, 1fr))',
        gap: 12,
      }}
    >
      {metrics.map((metric) => (
        <div
          key={metric.label}
          className="content-card"
          style={{ display: 'grid', gap: 4, padding: 14 }}
        >
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{metric.label}</span>
          <span style={{ fontSize: 24, fontWeight: 800 }}>{metric.value}</span>
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{metric.hint}</span>
        </div>
      ))}
    </div>
  );
}

function SessionTreeNodeCard({
  depth,
  node,
  selectedSharedSessionId,
  sharedSessionById,
}: {
  depth: number;
  node: WorkspaceSessionTreeNode<{
    id: string;
    metadata_json?: string;
    title?: string | null;
    updated_at: string;
  }>;
  selectedSharedSessionId: string | null;
  sharedSessionById: Map<string, SharedSessionSummaryRecord>;
}) {
  const sharedSession = sharedSessionById.get(node.session.id);
  const isSelected = sharedSession?.sessionId === selectedSharedSessionId;

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div
        className="content-card"
        style={{
          display: 'grid',
          gap: 6,
          padding: 12,
          marginLeft: depth * 14,
          borderColor: isSelected
            ? 'color-mix(in srgb, var(--accent) 38%, transparent)'
            : undefined,
          background: isSelected
            ? 'linear-gradient(135deg, rgba(91, 140, 255, 0.12), rgba(91, 140, 255, 0.04))'
            : undefined,
        }}
      >
        <div
          style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}
        >
          <span style={{ fontSize: 13, fontWeight: 700 }}>
            {node.session.title ?? node.session.id}
          </span>
          {sharedSession ? (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '4px 10px',
                borderRadius: 999,
                background: 'rgba(91, 140, 255, 0.12)',
                color: 'var(--text-2)',
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {getSharedSessionStateLabel(sharedSession.stateStatus)}
            </span>
          ) : null}
        </div>
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
          {node.children.length > 0 ? `${node.children.length} 个子会话` : '叶子会话'} · 最近更新{' '}
          {new Date(node.session.updated_at).toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </div>
      {node.children.map((childNode) => (
        <SessionTreeNodeCard
          key={childNode.session.id}
          depth={depth + 1}
          node={childNode}
          selectedSharedSessionId={selectedSharedSessionId}
          sharedSessionById={sharedSessionById}
        />
      ))}
    </div>
  );
}

export function TeamRuntimeShell({
  auditLogs,
  busy,
  error,
  feedback,
  loading,
  memberForm,
  members,
  messageForm,
  messages,
  onCreateMember,
  onCreateInteractionMessage,
  onCreateMessage,
  onCreateSessionShare,
  onCreateSharedComment,
  onCreateTask,
  onDeleteSessionShare,
  onMemberFormChange,
  onMessageFormChange,
  onReplySharedPermission,
  onReplySharedQuestion,
  onSelectSharedSession,
  onSessionSharePermissionChange,
  onShareFormChange,
  onSharedCommentDraftChange,
  onTaskFormChange,
  onTaskStatusChange,
  selectedSharedSession,
  selectedSharedSessionId,
  sessionShares,
  sessions,
  shareForm,
  sharedCommentBusy,
  sharedCommentDraft,
  sharedOperateBusy,
  sharedOperateError,
  sharedSessionLoading,
  sharedSessions,
  taskForm,
  runtimeTaskRecords,
  runtimeTasks,
  runtimeTasksLoading,
  tasks,
}: TeamRuntimeShellProps) {
  const [activeTab, setActiveTab] = useState<RuntimeTabKey>('overview');
  const [interactionDraft, setInteractionDraft] = useState('');
  const runtimeTaskById = useMemo(
    () => new Map(runtimeTasks.map((task) => [task.id, task])),
    [runtimeTasks],
  );
  const {
    buddyProjection,
    changeMetrics,
    contextMetrics,
    effectiveSelectedSharedSession,
    fileChangesSummary,
    filteredSessions,
    filteredSessionShares,
    filteredSharedSessions,
    memberNameMap,
    metrics,
    selectedRunSummary,
    selectedWorkspace,
    selectedWorkspaceKey,
    setSelectedWorkspaceKey,
    sessionTreeGroups,
    workspaceOutputCards,
    workspaceOverviewLines,
    workspaceSummaries,
  } = useTeamRuntimeProjection({
    auditLogs,
    members,
    messages,
    onSelectSharedSession,
    selectedSharedSession,
    selectedSharedSessionId,
    sessionShares,
    sessions,
    sharedSessions,
    tasks,
  });
  const sharedSessionById = new Map(
    filteredSharedSessions.map((session) => [session.sessionId, session]),
  );

  const renderTabContent = () => {
    switch (activeTab) {
      case 'overview':
        return (
          <div style={{ display: 'grid', gap: 16 }}>
            <RuntimeMetricGrid metrics={metrics} />
            <section
              className="content-card"
              style={{
                display: 'grid',
                gap: 14,
                padding: 18,
                borderRadius: 24,
                background:
                  'radial-gradient(circle at top left, rgba(91, 140, 255, 0.18), transparent 34%), linear-gradient(180deg, color-mix(in srgb, var(--surface) 96%, rgba(15, 23, 42, 0.22)) 0%, var(--surface) 100%)',
              }}
            >
              <TeamSectionHeader
                eyebrow="Mission overview"
                title={selectedWorkspace ? `${selectedWorkspace.label} 的运行态总览` : '运行态总览'}
                description="先把工作区视角拉起来，再逐步把共享会话、任务推进和人工介入纳入同一块屏幕。"
              />
              <div style={{ display: 'grid', gap: 10 }}>
                {workspaceOverviewLines.map((line) => (
                  <div
                    key={line}
                    className="content-card"
                    style={{ padding: 14, color: 'var(--text-2)' }}
                  >
                    {line}
                  </div>
                ))}
                {selectedWorkspaceKey !== ALL_WORKSPACES_KEY ? (
                  <div
                    className="content-card"
                    style={{
                      padding: 14,
                      color: 'var(--text-3)',
                      borderColor: 'color-mix(in srgb, var(--warning) 30%, transparent)',
                    }}
                  >
                    当前工作区外壳已按工作区过滤共享运行，但团队任务、消息与审计仍是团队级投影；后续
                    read model 会进一步收紧到工作区范围。
                  </div>
                ) : null}
              </div>
            </section>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: 16,
              }}
            >
              <section className="content-card" style={{ display: 'grid', gap: 12, padding: 18 }}>
                <TeamSectionHeader
                  eyebrow="Recent tasks"
                  title="最近任务节奏"
                  description="先看最靠前的任务和它们的当前状态，帮助团队快速找到推进点。"
                />
                {tasks.length === 0 ? (
                  <EmptyState
                    title="暂无任务"
                    description="任务看板为空时，团队运行会失去推进抓手。先在任务 Tab 新建第一条任务。"
                  />
                ) : (
                  tasks.slice(0, 4).map((task) => {
                    const statusMeta = getTaskStatusMeta(task.status);
                    return (
                      <div
                        key={task.id}
                        className="content-card"
                        style={{ display: 'grid', gap: 8, padding: 14 }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: 12,
                            alignItems: 'center',
                          }}
                        >
                          <span style={{ fontSize: 14, fontWeight: 700 }}>{task.title}</span>
                          <span style={statusMeta.style}>{statusMeta.label}</span>
                        </div>
                        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                          负责人：
                          {task.assigneeId
                            ? (memberNameMap.get(task.assigneeId) ?? '未知成员')
                            : '暂未指派'}{' '}
                          · 优先级：{task.priority}
                        </span>
                      </div>
                    );
                  })
                )}
              </section>
              <section className="content-card" style={{ display: 'grid', gap: 12, padding: 18 }}>
                <TeamSectionHeader
                  eyebrow="Recent audit"
                  title="最近协作轨迹"
                  description="共享权限、评论和问题处理都会沉淀到这里，帮助团队快速判断当前阻塞。"
                />
                {auditLogs.length === 0 ? (
                  <EmptyState
                    title="暂无审计轨迹"
                    description="当前还没有共享权限或协作动作发生。"
                  />
                ) : (
                  auditLogs.slice(0, 4).map((log) => (
                    <div
                      key={log.id}
                      className="content-card"
                      style={{ display: 'grid', gap: 6, padding: 14 }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 700 }}>{log.summary}</span>
                      {log.detail ? (
                        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{log.detail}</span>
                      ) : null}
                      <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                        {new Date(log.createdAt).toLocaleString('zh-CN')}
                      </span>
                    </div>
                  ))
                )}
              </section>
            </div>
          </div>
        );
      case 'sessions':
        return (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(320px, 420px) minmax(420px, 1fr)',
              gap: 16,
              alignItems: 'start',
            }}
          >
            <div style={{ display: 'grid', gap: 16 }}>
              <section className="content-card" style={{ display: 'grid', gap: 12, padding: 18 }}>
                <TeamSectionHeader
                  eyebrow="Session tree"
                  title="父子会话结构"
                  description="先在 TeamPage 中把当前工作区里的父子 session 和共享运行结构拉起来，再逐步叠加更细的 agent/task 轨迹。"
                />
                {sessionTreeGroups.length === 0 ||
                sessionTreeGroups.every((group) => group.roots.length === 0) ? (
                  <EmptyState
                    title="暂无会话树"
                    description="当前工作区没有可用于组装父子关系的会话记录，后续接入更多运行来源后会在这里扩展。"
                  />
                ) : (
                  <div style={{ display: 'grid', gap: 12 }}>
                    {sessionTreeGroups.map((group) => (
                      <div
                        key={group.workspaceLabel}
                        className="content-card"
                        style={{ display: 'grid', gap: 10, padding: 14 }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: 8,
                            alignItems: 'center',
                          }}
                        >
                          <span style={{ fontSize: 13, fontWeight: 700 }}>
                            {group.workspaceLabel}
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                            {group.sessions.length} 个会话
                          </span>
                        </div>
                        <div style={{ display: 'grid', gap: 10 }}>
                          {group.roots.map((node) => (
                            <SessionTreeNodeCard
                              key={node.session.id}
                              depth={0}
                              node={node}
                              selectedSharedSessionId={selectedSharedSessionId}
                              sharedSessionById={sharedSessionById}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <TeamMembersPanel
                busy={busy}
                form={memberForm}
                members={members}
                onAvatarUrlChange={(value) => onMemberFormChange({ avatarUrl: value })}
                onEmailChange={(value) => onMemberFormChange({ email: value })}
                onNameChange={(value) => onMemberFormChange({ name: value })}
                onRoleChange={(value) => onMemberFormChange({ role: value })}
                onSubmit={onCreateMember}
              />
            </div>
            <TeamSharedSessionsPanel
              commentDraft={sharedCommentDraft}
              onCommentDraftChange={onSharedCommentDraftChange}
              onReplyPermission={onReplySharedPermission}
              onReplyQuestion={onReplySharedQuestion}
              onSubmitComment={onCreateSharedComment}
              onSelectSession={onSelectSharedSession}
              selectedSessionDetail={effectiveSelectedSharedSession}
              selectedSessionId={selectedSharedSessionId}
              sharedCommentBusy={sharedCommentBusy}
              sharedOperateBusy={sharedOperateBusy}
              sharedOperateError={sharedOperateError}
              sharedSessionLoading={sharedSessionLoading}
              sharedSessions={filteredSharedSessions}
            />
          </div>
        );
      case 'tasks':
        return (
          <div style={{ display: 'grid', gap: 16 }}>
            <section className="content-card" style={{ display: 'grid', gap: 12, padding: 18 }}>
              <TeamSectionHeader
                eyebrow="Runtime tasks"
                title="当前共享运行任务轨迹"
                description="优先展示当前共享运行的 task projection；团队级任务区保留在下方，作为协作兜底。"
              />
              {runtimeTasksLoading ? (
                <div className="content-card" style={{ padding: 14, color: 'var(--text-3)' }}>
                  正在加载当前共享运行的任务投影…
                </div>
              ) : selectedSharedSessionId && runtimeTaskRecords.length > 0 ? (
                <div style={{ display: 'grid', gap: 10 }}>
                  {runtimeTaskRecords.map((task) => {
                    const runtimeTask = runtimeTaskById.get(task.id);
                    const statusMeta = getTaskStatusMeta(task.status);

                    return (
                      <div
                        key={task.id}
                        className="content-card"
                        style={{
                          display: 'grid',
                          gap: 8,
                          padding: 14,
                          marginLeft: runtimeTask ? runtimeTask.depth * 12 : 0,
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: 12,
                            alignItems: 'center',
                          }}
                        >
                          <span style={{ fontSize: 14, fontWeight: 700 }}>{task.title}</span>
                          <span style={statusMeta.style}>{statusMeta.label}</span>
                        </div>
                        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                          {runtimeTask?.assignedAgent
                            ? `Agent：${runtimeTask.assignedAgent} · `
                            : ''}
                          子任务：{runtimeTask?.subtaskCount ?? 0} · 已完成：
                          {runtimeTask?.completedSubtaskCount ?? 0} · 未满足依赖：
                          {runtimeTask?.unmetDependencyCount ?? 0}
                        </span>
                        {task.result ? (
                          <span style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.7 }}>
                            {task.result}
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState
                  title="暂无运行任务"
                  description="当前还没有选中的共享运行任务投影；选中共享会话后，这里会优先显示 runtime tasks。"
                />
              )}
            </section>

            <TeamTasksPanel
              busy={busy}
              form={taskForm}
              members={members}
              onAssigneeIdChange={(value) => onTaskFormChange({ assigneeId: value })}
              onPriorityChange={(value) => onTaskFormChange({ priority: value })}
              onStatusChange={onTaskStatusChange}
              onSubmit={onCreateTask}
              onTitleChange={(value) => onTaskFormChange({ title: value })}
              tasks={tasks}
            />
          </div>
        );
      case 'context':
        return (
          <div style={{ display: 'grid', gap: 16 }}>
            <section className="content-card" style={{ display: 'grid', gap: 12, padding: 18 }}>
              <TeamSectionHeader
                eyebrow="Context projection"
                title="工作区上下文摘要"
                description="先给当前工作区一个稳定的上下文投影，明确哪些是工作区级状态，哪些仍属于团队级共享操作。"
              />
              <RuntimeMetricGrid metrics={contextMetrics} />
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                  gap: 12,
                }}
              >
                <div className="content-card" style={{ display: 'grid', gap: 10, padding: 14 }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>工作区会话清单</span>
                  {filteredSessions.length === 0 ? (
                    <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                      当前工作区没有基础会话记录。
                    </span>
                  ) : (
                    filteredSessions.slice(0, 4).map((session) => (
                      <div key={session.id} style={{ display: 'grid', gap: 2 }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>
                          {session.title ?? session.id}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                          {formatWorkspaceLabel(session.workspacePath)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
                <div className="content-card" style={{ display: 'grid', gap: 10, padding: 14 }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>共享记录摘要</span>
                  {filteredSessionShares.length === 0 ? (
                    <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                      当前工作区还没有团队级共享记录。
                    </span>
                  ) : (
                    filteredSessionShares.slice(0, 4).map((share) => (
                      <div key={share.id} style={{ display: 'grid', gap: 2 }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{share.sessionLabel}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                          共享给 {share.memberName} · {share.permission}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </section>
            <div className="content-card" style={{ padding: 14, color: 'var(--text-3)' }}>
              下方仍保留旧的“共享会话”操作面板，作为团队级操作入口；它不是完整的工作区 read
              model，只承担当前切片的共享管理动作。
            </div>
            <TeamSessionSharesPanel
              busy={busy}
              form={shareForm}
              members={members}
              onDelete={onDeleteSessionShare}
              onMemberIdChange={(value) => onShareFormChange({ memberId: value })}
              onPermissionChange={(value) => onShareFormChange({ permission: value })}
              onSessionIdChange={(value) => onShareFormChange({ sessionId: value })}
              onSharePermissionUpdate={onSessionSharePermissionChange}
              onSubmit={onCreateSessionShare}
              sessionShares={filteredSessionShares}
              sessions={filteredSessions}
            />
          </div>
        );
      case 'timeline':
        return (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(340px, 1fr) minmax(320px, 0.9fr)',
              gap: 16,
              alignItems: 'start',
            }}
          >
            <TeamMessagesPanel
              busy={busy}
              form={messageForm}
              memberNameMap={memberNameMap}
              members={members}
              messages={messages}
              onContentChange={(value) => onMessageFormChange({ content: value })}
              onSenderIdChange={(value) => onMessageFormChange({ senderId: value })}
              onSubmit={onCreateMessage}
              onTypeChange={(value) => onMessageFormChange({ type: value })}
            />
            <TeamAuditPanel auditLogs={auditLogs} />
          </div>
        );
      case 'artifacts':
        return (
          <div style={{ display: 'grid', gap: 16 }}>
            <section className="content-card" style={{ display: 'grid', gap: 12, padding: 18 }}>
              <TeamSectionHeader
                eyebrow="Output surface"
                title="工作区产物摘要"
                description="首个切片先用共享会话构建工作区级输出投影：哪些运行有输出、哪些还在等待人工处理、哪些需要继续深入。"
              />
              {workspaceOutputCards.length === 0 ? (
                <EmptyState
                  title="暂无可展示产物"
                  description="当前工作区没有共享运行输入，后续接入 read model 后会在这里呈现更完整的产物面板。"
                />
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                    gap: 12,
                  }}
                >
                  {workspaceOutputCards.map((card) => (
                    <div
                      key={card.id}
                      className="content-card"
                      style={{ display: 'grid', gap: 10, padding: 14 }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: 8,
                          alignItems: 'flex-start',
                        }}
                      >
                        <div style={{ display: 'grid', gap: 4 }}>
                          <span style={{ fontSize: 15, fontWeight: 700 }}>{card.title}</span>
                          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                            {card.workspaceLabel}
                          </span>
                        </div>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            padding: '4px 10px',
                            borderRadius: 999,
                            background: 'rgba(91, 140, 255, 0.12)',
                            color: 'var(--text-2)',
                            fontSize: 11,
                            fontWeight: 700,
                          }}
                        >
                          {card.stateLabel}
                        </span>
                      </div>
                      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                        共享来源：{card.sharedByEmail}
                      </span>
                      <span style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text)' }}>
                        {card.latestOutput ??
                          '当前卡片尚未载入详细输出；选中对应共享会话后可查看最新助手结果。'}
                      </span>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {[
                          `${card.pendingApprovalCount} 待审批`,
                          `${card.pendingQuestionCount} 待回答`,
                        ].map((tag) => (
                          <span
                            key={tag}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              padding: '4px 10px',
                              borderRadius: 999,
                              border:
                                '1px solid color-mix(in srgb, var(--border) 80%, transparent)',
                              fontSize: 11,
                              color: 'var(--text-3)',
                            }}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                        {card.helperText}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        );
      case 'changes':
        return (
          <div style={{ display: 'grid', gap: 16 }}>
            <section className="content-card" style={{ display: 'grid', gap: 12, padding: 18 }}>
              <TeamSectionHeader
                eyebrow="Workspace changes"
                title="工作区变更投影"
                description="先把当前工作区的共享运行变更压成可读摘要，再把当前选中运行的快照和来源类型单独展开。"
              />
              <RuntimeMetricGrid metrics={changeMetrics} />
              {fileChangesSummary ? (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(300px, 1fr) minmax(240px, 0.9fr)',
                    gap: 16,
                  }}
                >
                  <div className="content-card" style={{ display: 'grid', gap: 12, padding: 14 }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>当前共享运行变更摘要</span>
                    <div style={{ display: 'grid', gap: 6 }}>
                      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                        变更文件：{fileChangesSummary.totalFileDiffs} · 快照：
                        {fileChangesSummary.snapshotCount}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                        新增：{fileChangesSummary.totalAdditions} · 删除：
                        {fileChangesSummary.totalDeletions}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                        最近快照：
                        {fileChangesSummary.latestSnapshotAt
                          ? new Date(fileChangesSummary.latestSnapshotAt).toLocaleString('zh-CN')
                          : '未生成'}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                        快照类型：
                        {formatSnapshotScopeKind(fileChangesSummary.latestSnapshotScopeKind)}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                        保障等级：{fileChangesSummary.weakestGuaranteeLevel ?? '未标记'}
                      </span>
                    </div>
                  </div>
                  <div className="content-card" style={{ display: 'grid', gap: 12, padding: 14 }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>来源类型</span>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {fileChangesSummary.sourceKinds.length > 0 ? (
                        fileChangesSummary.sourceKinds.map((sourceKind) => (
                          <span
                            key={sourceKind}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              padding: '4px 10px',
                              borderRadius: 999,
                              border:
                                '1px solid color-mix(in srgb, var(--border) 80%, transparent)',
                              fontSize: 11,
                              color: 'var(--text-2)',
                            }}
                          >
                            {formatChangeSourceKind(sourceKind)}
                          </span>
                        ))
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                          当前共享运行还没有来源类型摘要。
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <EmptyState
                  title="暂无变更摘要"
                  description="当前工作区没有已加载的共享运行变更摘要；先在会话 / Agent 中选一条共享运行，或者继续接入更深的变更聚合。"
                />
              )}
              <section className="content-card" style={{ display: 'grid', gap: 10, padding: 14 }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>工作区共享运行清单</span>
                {filteredSharedSessions.length === 0 ? (
                  <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                    当前工作区没有共享运行可用于变更投影。
                  </span>
                ) : (
                  filteredSharedSessions.map((sharedSession) => {
                    const isSelected =
                      sharedSession.sessionId === effectiveSelectedSharedSession?.share.sessionId;
                    return (
                      <div
                        key={sharedSession.sessionId}
                        className="content-card"
                        style={{
                          display: 'grid',
                          gap: 6,
                          padding: 12,
                          borderColor: isSelected
                            ? 'color-mix(in srgb, var(--accent) 38%, transparent)'
                            : undefined,
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: 8,
                            alignItems: 'center',
                          }}
                        >
                          <span style={{ fontSize: 13, fontWeight: 700 }}>
                            {sharedSession.title ?? sharedSession.sessionId}
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                            {getSharedSessionStateLabel(sharedSession.stateStatus)}
                          </span>
                        </div>
                        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                          {isSelected
                            ? '当前已接入详细变更摘要，可结合上方快照与来源类型继续排查。'
                            : '当前只显示运行级概览；切到该共享会话后可查看详细变更摘要。'}
                        </span>
                      </div>
                    );
                  })
                )}
              </section>
            </section>
          </div>
        );
      default:
        return null;
    }
  };

  const handleSubmitInteractionDraft = async () => {
    const trimmed = interactionDraft.trim();
    if (!trimmed) {
      return;
    }

    const succeeded = await onCreateInteractionMessage(trimmed);
    if (!succeeded) {
      return;
    }

    setInteractionDraft('');
    setActiveTab('timeline');
  };

  return (
    <div className="page-root">
      <div className="page-header">
        <span className="page-title">Team Runtime</span>
        <span className="page-subtitle">
          以工作区为入口，把共享会话、运行状态、任务推进与人工介入收进同一块控制台
        </span>
      </div>
      <div className="page-content">
        <div
          style={{
            maxWidth: 'min(1600px, 100%)',
            margin: '0 auto',
            padding: '24px',
            display: 'grid',
            gap: 18,
          }}
        >
          <section
            className="content-card"
            style={{
              display: 'grid',
              gap: 18,
              padding: 22,
              borderRadius: 28,
              background:
                'radial-gradient(circle at top left, rgba(91, 140, 255, 0.2), transparent 30%), linear-gradient(135deg, color-mix(in srgb, var(--surface) 96%, rgba(15, 23, 42, 0.34)) 0%, var(--surface) 100%)',
            }}
          >
            <div style={{ display: 'grid', gap: 6 }}>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  color: 'var(--accent)',
                }}
              >
                Team runtime console
              </span>
              <span
                style={{
                  fontSize: 'clamp(28px, 4vw, 46px)',
                  fontWeight: 800,
                  letterSpacing: '-0.04em',
                  lineHeight: 1.02,
                }}
              >
                把协作看板改造成工作区一级的运行总控页。
              </span>
              <span
                style={{ maxWidth: 880, fontSize: 14, lineHeight: 1.8, color: 'var(--text-2)' }}
              >
                当前切片先复用既有 team / shared-session / task projection 数据链，把工作区入口、7
                个主 Tab、统一交互代理和 Buddy/Hubby 动画挂点搭起来，为后续 Team Runtime read model
                深化留出稳定骨架。
              </span>
            </div>

            {feedback ? (
              <div
                className="content-card"
                style={{
                  padding: 12,
                  borderColor:
                    feedback.tone === 'success'
                      ? 'rgba(34, 197, 94, 0.35)'
                      : 'rgba(244, 63, 94, 0.35)',
                  color: feedback.tone === 'success' ? '#86efac' : '#fecdd3',
                }}
              >
                {feedback.message}
              </div>
            ) : null}

            {error ? (
              <div
                className="content-card"
                style={{ padding: 12, borderColor: 'rgba(244, 63, 94, 0.35)', color: '#fecdd3' }}
              >
                {error}
              </div>
            ) : null}

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 12,
              }}
            >
              {workspaceSummaries.map((workspace) => {
                const isActive = workspace.key === selectedWorkspaceKey;
                return (
                  <button
                    key={workspace.key}
                    type="button"
                    onClick={() => setSelectedWorkspaceKey(workspace.key)}
                    className="content-card"
                    style={{
                      display: 'grid',
                      gap: 8,
                      padding: 16,
                      textAlign: 'left',
                      borderRadius: 20,
                      cursor: 'pointer',
                      borderColor: isActive
                        ? 'color-mix(in srgb, var(--accent) 45%, transparent)'
                        : undefined,
                      background: isActive
                        ? 'linear-gradient(135deg, rgba(91, 140, 255, 0.18), rgba(91, 140, 255, 0.06))'
                        : undefined,
                    }}
                  >
                    <span style={{ fontSize: 15, fontWeight: 800 }}>{workspace.label}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6 }}>
                      {workspace.description}
                    </span>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {[
                        `${workspace.runningCount} 运行中`,
                        `${workspace.pausedCount} 待处理`,
                        `${workspace.sharedSessionCount} 共享`,
                      ].map((tag) => (
                        <span
                          key={tag}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            padding: '4px 10px',
                            borderRadius: 999,
                            background: 'rgba(91, 140, 255, 0.12)',
                            color: 'var(--text-2)',
                            fontSize: 11,
                          }}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {loading ? (
            <div
              className="content-card"
              style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)' }}
            >
              Team Runtime 面板加载中…
            </div>
          ) : (
            <section
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, 360px)',
                gap: 16,
                alignItems: 'start',
              }}
            >
              <div style={{ display: 'grid', gap: 14, minWidth: 0 }}>
                <div style={tabListStyle} role="tablist" aria-label="Team Runtime 视图切换">
                  {tabs.map((tab) => {
                    const isActive = tab.key === activeTab;
                    return (
                      <button
                        key={tab.key}
                        id={`team-runtime-tab-${tab.key}`}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        aria-controls={`team-runtime-panel-${tab.key}`}
                        onClick={() => setActiveTab(tab.key)}
                        style={isActive ? activeTabStyle : inactiveTabStyle}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
                <div className="content-card" style={{ display: 'grid', gap: 8, padding: 14 }}>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>
                    {tabs.find((tab) => tab.key === activeTab)?.label}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6 }}>
                    {tabs.find((tab) => tab.key === activeTab)?.summary}
                  </span>
                </div>
                <div
                  id={`team-runtime-panel-${activeTab}`}
                  role="tabpanel"
                  aria-labelledby={`team-runtime-tab-${activeTab}`}
                >
                  {renderTabContent()}
                </div>
              </div>

              <aside style={{ display: 'grid', gap: 16, minWidth: 0 }}>
                <TeamRuntimeBuddy
                  activeAgentCount={buddyProjection.activeAgentCount}
                  blockedCount={buddyProjection.blockedCount}
                  pendingApprovalCount={buddyProjection.pendingApprovalCount}
                  pendingQuestionCount={buddyProjection.pendingQuestionCount}
                  runningCount={buddyProjection.runningCount}
                  sessionTitle={buddyProjection.sessionTitle}
                  workspaceLabel={buddyProjection.workspaceLabel}
                />

                <section className="content-card" style={{ display: 'grid', gap: 12, padding: 16 }}>
                  <TeamSectionHeader
                    eyebrow="Interaction agent"
                    title="统一交互代理"
                    description="这一层现在先做输入入口占位，不抢运行主视图，后续再接真实运行链。"
                  />
                  <textarea
                    aria-label="interaction-agent 输入区"
                    rows={4}
                    value={interactionDraft}
                    onChange={(event) => setInteractionDraft(event.target.value)}
                    placeholder="先把人类意图写在这里，后续会由 interaction-agent 做需求改写。"
                  />
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => void handleSubmitInteractionDraft()}
                    disabled={busy || !interactionDraft.trim()}
                  >
                    {busy ? '提交中…' : '交由 interaction-agent'}
                  </button>
                </section>

                <section className="content-card" style={{ display: 'grid', gap: 12, padding: 16 }}>
                  <TeamSectionHeader
                    eyebrow="Selected run"
                    title="当前共享运行"
                    description="这里聚焦当前选中的共享会话，帮助你在总控页中快速判断下一步。"
                  />
                  {selectedRunSummary ? (
                    <div style={{ display: 'grid', gap: 10 }}>
                      <div
                        className="content-card"
                        style={{ display: 'grid', gap: 4, padding: 14 }}
                      >
                        <span style={{ fontSize: 16, fontWeight: 800 }}>
                          {selectedRunSummary.title}
                        </span>
                        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                          工作区：{selectedRunSummary.workspaceLabel}
                        </span>
                        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                          状态：{selectedRunSummary.stateLabel}
                        </span>
                        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                          共享者：{selectedRunSummary.sharedByEmail}
                        </span>
                      </div>
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                          gap: 10,
                        }}
                      >
                        {[
                          { label: '评论', value: selectedRunSummary.commentCount },
                          { label: '在线查看者', value: selectedRunSummary.activeViewerCount },
                          { label: '待审批', value: selectedRunSummary.pendingApprovalCount },
                          { label: '待回答', value: selectedRunSummary.pendingQuestionCount },
                        ].map((item) => (
                          <div
                            key={item.label}
                            className="content-card"
                            style={{ display: 'grid', gap: 4, padding: 12 }}
                          >
                            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                              {item.label}
                            </span>
                            <span style={{ fontSize: 18, fontWeight: 800 }}>{item.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <EmptyState
                      title="尚未选中共享运行"
                      description="在“会话 / Agent”里选一个共享会话，右侧会同步显示它的运行摘要。"
                    />
                  )}
                </section>
              </aside>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
