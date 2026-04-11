import { useEffect, useState } from 'react';
import { PermissionPrompt } from '@openAwork/shared-ui';
import type {
  SharedSessionDetailRecord,
  SharedSessionSummaryRecord,
  TeamAuditLogRecord,
  TeamMemberRecord,
  TeamMessageRecord,
  TeamSessionShareRecord,
  TeamTaskRecord,
} from '@openAwork/web-client';
import QuestionPromptCard from '../../components/QuestionPromptCard.js';

const panelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  minHeight: 0,
  padding: 18,
  borderRadius: 18,
  border: '1px solid color-mix(in srgb, var(--border) 82%, transparent)',
  background:
    'linear-gradient(180deg, color-mix(in srgb, var(--surface) 94%, rgba(91, 140, 255, 0.08)) 0%, var(--surface) 100%)',
  boxShadow: '0 18px 46px rgba(2, 6, 23, 0.16)',
};

function pillStyle(color: string, background: string): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 64,
    padding: '4px 10px',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    color,
    background,
    letterSpacing: '0.02em',
  };
}

function formatWorkspacePath(workspacePath: string | null): string {
  return workspacePath ?? '未绑定工作区';
}

function formatSessionOptionLabel(session: {
  id: string;
  title: string | null;
  workspacePath: string | null;
}): string {
  const title = session.title ?? session.id;
  return `${title} · ${formatWorkspacePath(session.workspacePath)}`;
}

function describeMessageContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  try {
    return JSON.stringify(content);
  } catch {
    return '无法预览的消息内容';
  }
}

function parseInteractionAgentMessage(content: string): {
  actorLabel: string;
  body: string;
  statusLabel: string | null;
} | null {
  const match = content.match(/^【interaction-agent(?:\/([^】]+))?】\s*(.+)$/u);
  if (!match) {
    return null;
  }

  return {
    actorLabel: 'interaction-agent',
    body: match[2] ?? content,
    statusLabel: match[1] ?? null,
  };
}

export function getTaskStatusMeta(status: TeamTaskRecord['status']) {
  switch (status) {
    case 'in_progress':
      return { label: '进行中', style: pillStyle('#7dd3fc', 'rgba(14, 165, 233, 0.18)') };
    case 'completed':
      return { label: '已完成', style: pillStyle('#86efac', 'rgba(34, 197, 94, 0.18)') };
    case 'failed':
      return { label: '受阻', style: pillStyle('#fda4af', 'rgba(244, 63, 94, 0.16)') };
    default:
      return { label: '待开始', style: pillStyle('#cbd5f5', 'rgba(148, 163, 184, 0.18)') };
  }
}

export function getMessageTypeMeta(type: TeamMessageRecord['type']) {
  switch (type) {
    case 'question':
      return { label: '问题', style: pillStyle('#fde68a', 'rgba(245, 158, 11, 0.18)') };
    case 'result':
      return { label: '结果', style: pillStyle('#93c5fd', 'rgba(59, 130, 246, 0.16)') };
    case 'error':
      return { label: '阻塞', style: pillStyle('#fda4af', 'rgba(244, 63, 94, 0.16)') };
    default:
      return { label: '同步', style: pillStyle('#c4b5fd', 'rgba(139, 92, 246, 0.16)') };
  }
}

export function getAuditActionMeta(action: TeamAuditLogRecord['action']) {
  switch (action) {
    case 'shared_comment_created':
      return { label: '共享评论', style: pillStyle('#f9a8d4', 'rgba(236, 72, 153, 0.16)') };
    case 'shared_permission_replied':
      return { label: '权限处理', style: pillStyle('#c4b5fd', 'rgba(139, 92, 246, 0.18)') };
    case 'shared_question_replied':
      return { label: '问题处理', style: pillStyle('#fcd34d', 'rgba(245, 158, 11, 0.18)') };
    case 'share_permission_updated':
      return { label: '权限变更', style: pillStyle('#93c5fd', 'rgba(59, 130, 246, 0.16)') };
    case 'share_deleted':
      return { label: '取消共享', style: pillStyle('#fda4af', 'rgba(244, 63, 94, 0.16)') };
    default:
      return { label: '新增共享', style: pillStyle('#86efac', 'rgba(34, 197, 94, 0.18)') };
  }
}

interface SectionHeaderProps {
  eyebrow: string;
  title: string;
  description: string;
}

export function TeamSectionHeader({ eyebrow, title, description }: SectionHeaderProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.18em',
          color: 'var(--accent)',
        }}
      >
        {eyebrow}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>{title}</span>
        <span style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-3)' }}>{description}</span>
      </div>
    </div>
  );
}

interface MemberPanelProps {
  members: TeamMemberRecord[];
  form: {
    avatarUrl: string;
    email: string;
    name: string;
    role: TeamMemberRecord['role'];
  };
  onAvatarUrlChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onRoleChange: (value: TeamMemberRecord['role']) => void;
  onSubmit: () => void;
  busy: boolean;
}

export function TeamMembersPanel({
  busy,
  form,
  members,
  onAvatarUrlChange,
  onEmailChange,
  onNameChange,
  onRoleChange,
  onSubmit,
}: MemberPanelProps) {
  return (
    <section style={panelStyle}>
      <TeamSectionHeader
        eyebrow="Team roster"
        title="协作成员"
        description="把执行者、Reviewer 和推动者放进同一节奏里，确保每个任务都有人认领。"
      />
      <div style={{ display: 'grid', gap: 10 }}>
        {members.length === 0 ? (
          <div className="content-card" style={{ padding: 14, color: 'var(--text-3)' }}>
            还没有成员。先添加一个合作者，让任务和消息真正有归属人。
          </div>
        ) : (
          members.map((member) => (
            <div
              key={member.id}
              className="content-card"
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr auto',
                gap: 12,
                alignItems: 'center',
                padding: 14,
              }}
            >
              <div
                aria-hidden="true"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 12,
                  display: 'grid',
                  placeItems: 'center',
                  background: 'rgba(91, 140, 255, 0.14)',
                  color: 'var(--accent)',
                  fontWeight: 800,
                }}
              >
                {member.name.slice(0, 1).toUpperCase()}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 700 }}>{member.name}</span>
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{member.email}</span>
              </div>
              <div
                style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}
              >
                <span style={pillStyle('var(--accent)', 'rgba(91, 140, 255, 0.14)')}>
                  {member.role}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{member.status}</span>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="content-card" style={{ display: 'grid', gap: 10, padding: 14 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>添加成员</span>
        <input
          name="team-member-name"
          value={form.name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder="例如：林雾"
        />
        <input
          name="team-member-email"
          value={form.email}
          onChange={(event) => onEmailChange(event.target.value)}
          placeholder="name@openawork.local"
        />
        <select
          value={form.role}
          onChange={(event) => onRoleChange(event.target.value as TeamMemberRecord['role'])}
        >
          <option value="member">member</option>
          <option value="admin">admin</option>
          <option value="owner">owner</option>
        </select>
        <input
          name="team-member-avatar"
          value={form.avatarUrl}
          onChange={(event) => onAvatarUrlChange(event.target.value)}
          placeholder="头像 URL（可选）"
        />
        <button
          type="button"
          className="primary-button"
          onClick={onSubmit}
          disabled={busy || !form.name.trim() || !form.email.trim()}
        >
          {busy ? '提交中…' : '新增成员'}
        </button>
      </div>
    </section>
  );
}

interface TasksPanelProps {
  busy: boolean;
  form: {
    assigneeId: string;
    priority: TeamTaskRecord['priority'];
    title: string;
  };
  members: TeamMemberRecord[];
  onAssigneeIdChange: (value: string) => void;
  onPriorityChange: (value: TeamTaskRecord['priority']) => void;
  onStatusChange: (taskId: string, status: 'in_progress' | 'completed' | 'failed') => void;
  onSubmit: () => void;
  onTitleChange: (value: string) => void;
  tasks: TeamTaskRecord[];
}

export function TeamTasksPanel({
  busy,
  form,
  members,
  onAssigneeIdChange,
  onPriorityChange,
  onStatusChange,
  onSubmit,
  onTitleChange,
  tasks,
}: TasksPanelProps) {
  const memberLabelMap = new Map(members.map((member) => [member.id, member.name]));

  return (
    <section style={panelStyle}>
      <TeamSectionHeader
        eyebrow="Execution board"
        title="任务看板"
        description="把协作请求变成可认领、可推进、可交付的任务脉络，避免“谁来做”再次漂移。"
      />
      <div style={{ display: 'grid', gap: 10 }}>
        {tasks.length === 0 ? (
          <div className="content-card" style={{ padding: 14, color: 'var(--text-3)' }}>
            还没有协作任务。先创建一个小目标，团队消息就会围绕它开始流动。
          </div>
        ) : (
          tasks.map((task) => {
            const statusMeta = getTaskStatusMeta(task.status);
            return (
              <div
                key={task.id}
                className="content-card"
                style={{ display: 'grid', gap: 10, padding: 14 }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    alignItems: 'flex-start',
                  }}
                >
                  <div style={{ display: 'grid', gap: 4 }}>
                    <span style={{ fontSize: 14, fontWeight: 700 }}>{task.title}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                      负责人：
                      {task.assigneeId
                        ? (memberLabelMap.get(task.assigneeId) ?? '未知成员')
                        : '未指派'}{' '}
                      · 优先级：{task.priority}
                    </span>
                  </div>
                  <span style={statusMeta.style}>{statusMeta.label}</span>
                </div>
                {task.result ? (
                  <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--text-2)' }}>
                    {task.result}
                  </div>
                ) : null}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => onStatusChange(task.id, 'in_progress')}
                    disabled={busy}
                  >
                    开始推进
                  </button>
                  <button
                    type="button"
                    onClick={() => onStatusChange(task.id, 'completed')}
                    disabled={busy}
                  >
                    标为完成
                  </button>
                  <button
                    type="button"
                    onClick={() => onStatusChange(task.id, 'failed')}
                    disabled={busy}
                  >
                    标记受阻
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="content-card" style={{ display: 'grid', gap: 10, padding: 14 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>创建任务</span>
        <input
          name="team-task-title"
          value={form.title}
          onChange={(event) => onTitleChange(event.target.value)}
          placeholder="例如：落地共享审批流 MVP"
        />
        <select
          value={form.priority}
          onChange={(event) => onPriorityChange(event.target.value as TeamTaskRecord['priority'])}
        >
          <option value="high">high</option>
          <option value="medium">medium</option>
          <option value="low">low</option>
        </select>
        <select
          value={form.assigneeId}
          onChange={(event) => onAssigneeIdChange(event.target.value)}
        >
          <option value="">暂不指派</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="primary-button"
          onClick={onSubmit}
          disabled={busy || !form.title.trim()}
        >
          {busy ? '提交中…' : '新增任务'}
        </button>
      </div>
    </section>
  );
}

interface MessagesPanelProps {
  busy: boolean;
  form: {
    content: string;
    senderId: string;
    type: TeamMessageRecord['type'];
  };
  memberNameMap: Map<string, string>;
  members: TeamMemberRecord[];
  messages: TeamMessageRecord[];
  onContentChange: (value: string) => void;
  onSenderIdChange: (value: string) => void;
  onSubmit: () => void;
  onTypeChange: (value: TeamMessageRecord['type']) => void;
}

export function TeamMessagesPanel({
  busy,
  form,
  memberNameMap,
  members,
  messages,
  onContentChange,
  onSenderIdChange,
  onSubmit,
  onTypeChange,
}: MessagesPanelProps) {
  return (
    <section style={panelStyle}>
      <TeamSectionHeader
        eyebrow="Shared feed"
        title="协作消息流"
        description="把认领、阻塞、结果和追问都沉淀到一个共享时间轴里，减少跨会话信息丢失。"
      />
      <div style={{ display: 'grid', gap: 10, maxHeight: 480, overflowY: 'auto', paddingRight: 4 }}>
        {messages.length === 0 ? (
          <div className="content-card" style={{ padding: 14, color: 'var(--text-3)' }}>
            还没有团队消息。发出第一条同步，让协作节奏从这里开始。
          </div>
        ) : (
          messages.map((message) => {
            const typeMeta = getMessageTypeMeta(message.type);
            const interactionMessage = parseInteractionAgentMessage(message.content);
            return (
              <div
                key={message.id}
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
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-2)' }}>
                    {interactionMessage?.actorLabel ??
                      ((memberNameMap.get(message.memberId) ?? message.memberId) || 'system')}
                  </span>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    {interactionMessage?.statusLabel ? (
                      <span style={pillStyle('#fef3c7', 'rgba(245, 158, 11, 0.16)')}>
                        {interactionMessage.statusLabel}
                      </span>
                    ) : null}
                    <span style={typeMeta.style}>{typeMeta.label}</span>
                  </div>
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text)' }}>
                  {interactionMessage?.body ?? message.content}
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                  {new Date(message.timestamp).toLocaleString('zh-CN', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            );
          })
        )}
      </div>
      <div className="content-card" style={{ display: 'grid', gap: 10, padding: 14 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>发送同步</span>
        <select
          value={form.type}
          onChange={(event) => onTypeChange(event.target.value as TeamMessageRecord['type'])}
        >
          <option value="update">update</option>
          <option value="question">question</option>
          <option value="result">result</option>
          <option value="error">error</option>
        </select>
        <select value={form.senderId} onChange={(event) => onSenderIdChange(event.target.value)}>
          <option value="">system</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
        <textarea
          name="team-message-content"
          rows={4}
          value={form.content}
          onChange={(event) => onContentChange(event.target.value)}
          placeholder="例如：我先认领 T-12 的前端页面，后端接口今晚补齐验证。"
        />
        <button
          type="button"
          className="primary-button"
          onClick={onSubmit}
          disabled={busy || !form.content.trim()}
        >
          {busy ? '提交中…' : '发送消息'}
        </button>
      </div>
    </section>
  );
}

interface SessionSharesPanelProps {
  busy: boolean;
  form: {
    memberId: string;
    permission: TeamSessionShareRecord['permission'];
    sessionId: string;
  };
  members: TeamMemberRecord[];
  onDelete: (shareId: string) => void;
  onMemberIdChange: (value: string) => void;
  onPermissionChange: (value: TeamSessionShareRecord['permission']) => void;
  onSharePermissionUpdate: (
    shareId: string,
    permission: TeamSessionShareRecord['permission'],
  ) => void;
  onSessionIdChange: (value: string) => void;
  onSubmit: () => void;
  sessionShares: TeamSessionShareRecord[];
  sessions: Array<{ id: string; title: string | null; workspacePath: string | null }>;
}

export function TeamSessionSharesPanel({
  busy,
  form,
  members,
  onDelete,
  onMemberIdChange,
  onPermissionChange,
  onSharePermissionUpdate,
  onSessionIdChange,
  onSubmit,
  sessionShares,
  sessions,
}: SessionSharesPanelProps) {
  return (
    <section style={panelStyle}>
      <TeamSectionHeader
        eyebrow="Shared sessions"
        title="共享会话"
        description="把具体会话按成员和权限分享出去，让团队协作真正落在同一条执行记录上。"
      />
      <div style={{ display: 'grid', gap: 10 }}>
        {sessionShares.length === 0 ? (
          <div className="content-card" style={{ padding: 14, color: 'var(--text-3)' }}>
            还没有共享会话。先挑一个会话分发给成员，开始真正的协作接力。
          </div>
        ) : (
          sessionShares.map((share) => (
            <div
              key={share.id}
              className="content-card"
              style={{ display: 'grid', gap: 8, padding: 14 }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  alignItems: 'flex-start',
                }}
              >
                <div style={{ display: 'grid', gap: 4 }}>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{share.sessionLabel}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                    共享给 {share.memberName} · {share.memberEmail}
                  </span>
                </div>
                <span style={pillStyle('var(--accent)', 'rgba(91, 140, 255, 0.14)')}>
                  {share.permission}
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                会话：{share.sessionId.slice(0, 8)}… · 创建于{' '}
                {new Date(share.createdAt).toLocaleString('zh-CN')} · 最近同步于{' '}
                {new Date(share.updatedAt).toLocaleString('zh-CN')}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                工作区：{formatWorkspacePath(share.workspacePath)}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <select
                  aria-label={`共享权限-${share.id}`}
                  value={share.permission}
                  onChange={(event) =>
                    onSharePermissionUpdate(
                      share.id,
                      event.target.value as TeamSessionShareRecord['permission'],
                    )
                  }
                  disabled={busy}
                >
                  <option value="view">view</option>
                  <option value="comment">comment</option>
                  <option value="operate">operate</option>
                </select>
                <button type="button" onClick={() => onDelete(share.id)} disabled={busy}>
                  取消共享
                </button>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="content-card" style={{ display: 'grid', gap: 10, padding: 14 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>共享当前会话</span>
        <select
          name="team-share-session"
          value={form.sessionId}
          onChange={(event) => onSessionIdChange(event.target.value)}
        >
          <option value="">选择会话</option>
          {sessions.map((session) => (
            <option key={session.id} value={session.id}>
              {formatSessionOptionLabel(session)}
            </option>
          ))}
        </select>
        <select
          name="team-share-member"
          value={form.memberId}
          onChange={(event) => onMemberIdChange(event.target.value)}
        >
          <option value="">选择成员</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
        <select
          name="team-share-permission"
          value={form.permission}
          onChange={(event) =>
            onPermissionChange(event.target.value as TeamSessionShareRecord['permission'])
          }
        >
          <option value="view">view</option>
          <option value="comment">comment</option>
          <option value="operate">operate</option>
        </select>
        <button
          type="button"
          className="primary-button"
          onClick={onSubmit}
          disabled={busy || !form.sessionId || !form.memberId}
        >
          {busy ? '提交中…' : '共享会话'}
        </button>
      </div>
    </section>
  );
}

interface TeamSharedSessionsPanelProps {
  commentDraft: string;
  onCommentDraftChange: (value: string) => void;
  onReplyPermission: (
    requestId: string,
    decision: 'once' | 'session' | 'permanent' | 'reject',
  ) => void;
  onReplyQuestion: (input: {
    answers?: string[][];
    requestId: string;
    status: 'answered' | 'dismissed';
  }) => void;
  onSubmitComment: () => void;
  selectedSessionDetail: SharedSessionDetailRecord | null;
  selectedSessionId: string | null;
  sharedCommentBusy: boolean;
  sharedOperateBusy: boolean;
  sharedOperateError: string | null;
  sharedSessionLoading: boolean;
  sharedSessions: SharedSessionSummaryRecord[];
  onSelectSession: (sessionId: string) => void;
}

export function TeamSharedSessionsPanel({
  commentDraft,
  onCommentDraftChange,
  onReplyPermission,
  onReplyQuestion,
  onSubmitComment,
  selectedSessionDetail,
  selectedSessionId,
  sharedCommentBusy,
  sharedOperateBusy,
  sharedOperateError,
  sharedSessionLoading,
  sharedSessions,
  onSelectSession,
}: TeamSharedSessionsPanelProps) {
  const previewMessages = (selectedSessionDetail?.session.messages ?? []).slice(-8);
  const sharedComments = selectedSessionDetail?.comments ?? [];
  const sharedPresence = selectedSessionDetail?.presence ?? [];
  const activeViewers = sharedPresence.filter((entry) => entry.active);
  const pendingPermission = selectedSessionDetail?.pendingPermissions[0] ?? null;
  const pendingQuestion = selectedSessionDetail?.pendingQuestions[0] ?? null;
  const canComment =
    selectedSessionDetail?.share.permission === 'comment' ||
    selectedSessionDetail?.share.permission === 'operate';
  const canOperate = selectedSessionDetail?.share.permission === 'operate';
  const [questionAnswers, setQuestionAnswers] = useState<string[][]>([]);

  useEffect(() => {
    if (!pendingQuestion) {
      setQuestionAnswers([]);
      return;
    }

    setQuestionAnswers(pendingQuestion.questions.map(() => []));
  }, [pendingQuestion]);

  const handleToggleQuestionOption = (
    questionIndex: number,
    optionLabel: string,
    multiple: boolean,
  ) => {
    setQuestionAnswers((current) => {
      const next = current.map((answers) => [...answers]);
      const existing = next[questionIndex] ?? [];
      const selected = existing.includes(optionLabel);
      if (multiple) {
        next[questionIndex] = selected
          ? existing.filter((answer) => answer !== optionLabel)
          : [...existing, optionLabel];
      } else {
        next[questionIndex] = selected ? [] : [optionLabel];
      }
      return next;
    });
  };

  return (
    <section style={panelStyle}>
      <TeamSectionHeader
        eyebrow="Shared with me"
        title="共享给我的会话"
        description="把真正对我开放只读权限的会话集中起来，让协作成员可以直接读取上下文，而不是靠截图或转述。"
      />
      {sharedSessions.length === 0 ? (
        <div className="content-card" style={{ padding: 14, color: 'var(--text-3)' }}>
          还没有共享给你的会话。团队成员把会话分发给你的时候，这里会出现共享入口。
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(220px, 280px) minmax(0, 1fr)',
            gap: 12,
          }}
        >
          <div
            style={{ display: 'grid', gap: 10, maxHeight: 520, overflowY: 'auto', paddingRight: 4 }}
          >
            {sharedSessions.map((share) => {
              const active = share.sessionId === selectedSessionId;
              return (
                <button
                  key={share.sessionId}
                  type="button"
                  onClick={() => onSelectSession(share.sessionId)}
                  className="content-card"
                  style={{
                    textAlign: 'left',
                    display: 'grid',
                    gap: 6,
                    padding: 14,
                    borderColor: active
                      ? 'rgba(91, 140, 255, 0.42)'
                      : 'color-mix(in srgb, var(--border) 82%, transparent)',
                    background: active
                      ? 'linear-gradient(180deg, rgba(91, 140, 255, 0.14), rgba(91, 140, 255, 0.05))'
                      : undefined,
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                      {share.title ?? share.sessionId}
                    </span>
                    <span style={pillStyle('var(--accent)', 'rgba(91, 140, 255, 0.14)')}>
                      {share.permission}
                    </span>
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                    来自 {share.sharedByEmail}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    工作区：{formatWorkspacePath(share.workspacePath)}
                  </span>
                </button>
              );
            })}
          </div>

          <div
            className="content-card"
            style={{ display: 'grid', gap: 12, padding: 16, minHeight: 320 }}
          >
            {sharedSessionLoading ? (
              <div style={{ color: 'var(--text-3)' }}>共享会话预览加载中…</div>
            ) : !selectedSessionDetail ? (
              <div style={{ color: 'var(--text-3)' }}>
                选择一条共享会话，查看它的上下文与协作评论。
              </div>
            ) : (
              <>
                <div style={{ display: 'grid', gap: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>
                      {selectedSessionDetail.share.title ?? selectedSessionDetail.share.sessionId}
                    </span>
                    <span style={pillStyle('var(--accent)', 'rgba(91, 140, 255, 0.14)')}>
                      {selectedSessionDetail.share.permission}
                    </span>
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                    分享人：{selectedSessionDetail.share.sharedByEmail}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                    工作区：{formatWorkspacePath(selectedSessionDetail.share.workspacePath)}
                  </span>
                </div>
                <div style={{ display: 'grid', gap: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                      在线查看者
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                      {activeViewers.length > 0
                        ? `${activeViewers.length} 人在线`
                        : `${sharedPresence.length} 人最近查看`}
                    </span>
                  </div>
                  {sharedPresence.length === 0 ? (
                    <div style={{ color: 'var(--text-3)' }}>
                      还没有查看轨迹。有人打开这条共享会话后，这里会显示最近查看者。
                    </div>
                  ) : (
                    sharedPresence.map((entry) => (
                      <div
                        key={entry.viewerUserId}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: 12,
                          alignItems: 'center',
                          padding: 10,
                          borderRadius: 12,
                          border: '1px solid color-mix(in srgb, var(--border) 82%, transparent)',
                          background:
                            'color-mix(in srgb, var(--surface) 96%, rgba(91, 140, 255, 0.05))',
                        }}
                      >
                        <div style={{ display: 'grid', gap: 4 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
                            {entry.viewerEmail}
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                            最近查看：{new Date(entry.lastSeenAt).toLocaleString('zh-CN')}
                          </span>
                        </div>
                        <span
                          style={pillStyle(
                            entry.active ? '#86efac' : '#cbd5f5',
                            entry.active ? 'rgba(34, 197, 94, 0.18)' : 'rgba(148, 163, 184, 0.16)',
                          )}
                        >
                          {entry.active ? '在线' : '最近查看'}
                        </span>
                      </div>
                    ))
                  )}
                </div>
                <div style={{ display: 'grid', gap: 10 }}>
                  {previewMessages.length === 0 ? (
                    <div style={{ color: 'var(--text-3)' }}>
                      这条共享会话目前还没有可预览的消息。
                    </div>
                  ) : (
                    previewMessages.map((message) => (
                      <div
                        key={message.id}
                        style={{
                          display: 'grid',
                          gap: 4,
                          padding: 12,
                          borderRadius: 12,
                          border: '1px solid color-mix(in srgb, var(--border) 82%, transparent)',
                          background:
                            'color-mix(in srgb, var(--surface) 94%, rgba(15, 23, 42, 0.2))',
                        }}
                      >
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)' }}>
                          {message.role}
                        </span>
                        <span style={{ fontSize: 12, lineHeight: 1.7, color: 'var(--text-2)' }}>
                          {describeMessageContent(message.content)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
                <div style={{ display: 'grid', gap: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                      协作评论
                    </span>
                    {!canComment ? (
                      <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                        当前权限为 view，只可阅读评论
                      </span>
                    ) : null}
                  </div>
                  {sharedComments.length === 0 ? (
                    <div style={{ color: 'var(--text-3)' }}>
                      还没有协作评论。先留下一条上下文补充，让后续接手人不用反复追问。
                    </div>
                  ) : (
                    sharedComments.map((comment) => (
                      <div
                        key={comment.id}
                        style={{
                          display: 'grid',
                          gap: 4,
                          padding: 12,
                          borderRadius: 12,
                          border: '1px solid color-mix(in srgb, var(--border) 82%, transparent)',
                          background:
                            'color-mix(in srgb, var(--surface) 95%, rgba(91, 140, 255, 0.06))',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: 12,
                            flexWrap: 'wrap',
                          }}
                        >
                          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>
                            {comment.authorEmail}
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                            {new Date(comment.createdAt).toLocaleString('zh-CN')}
                          </span>
                        </div>
                        <span style={{ fontSize: 12, lineHeight: 1.7, color: 'var(--text-2)' }}>
                          {comment.content}
                        </span>
                      </div>
                    ))
                  )}
                  {canComment ? (
                    <div className="content-card" style={{ display: 'grid', gap: 10, padding: 12 }}>
                      <textarea
                        aria-label="共享会话评论输入框"
                        value={commentDraft}
                        onChange={(event) => onCommentDraftChange(event.target.value)}
                        placeholder="补充你看到的上下文、阻塞点或下一步建议…"
                        rows={4}
                        style={{ resize: 'vertical' }}
                      />
                      <button
                        type="button"
                        className="primary-button"
                        disabled={sharedCommentBusy || !commentDraft.trim()}
                        onClick={onSubmitComment}
                      >
                        {sharedCommentBusy ? '发送中…' : '发送协作评论'}
                      </button>
                    </div>
                  ) : null}
                </div>
                {canOperate && pendingPermission ? (
                  <div style={{ display: 'grid', gap: 10 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                      待审批权限
                    </span>
                    <PermissionPrompt
                      requestId={pendingPermission.requestId}
                      toolName={pendingPermission.toolName}
                      scope={pendingPermission.scope}
                      reason={pendingPermission.reason}
                      riskLevel={pendingPermission.riskLevel}
                      previewAction={pendingPermission.previewAction}
                      errorMessage={sharedOperateError ?? undefined}
                      onDecide={onReplyPermission}
                      style={{ maxWidth: '100%', position: 'static', boxShadow: 'none' }}
                    />
                  </div>
                ) : null}
                {canOperate && pendingQuestion ? (
                  <div style={{ display: 'grid', gap: 10 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                      待回答问题
                    </span>
                    <QuestionPromptCard
                      answers={questionAnswers}
                      errorMessage={sharedOperateError ?? undefined}
                      pendingAction={sharedOperateBusy ? 'answered' : null}
                      request={pendingQuestion}
                      onDismiss={() =>
                        onReplyQuestion({
                          requestId: pendingQuestion.requestId,
                          status: 'dismissed',
                        })
                      }
                      onSubmit={() =>
                        onReplyQuestion({
                          answers: questionAnswers,
                          requestId: pendingQuestion.requestId,
                          status: 'answered',
                        })
                      }
                      onToggleOption={handleToggleQuestionOption}
                      style={{
                        maxWidth: '100%',
                        position: 'static',
                        right: 'auto',
                        bottom: 'auto',
                      }}
                    />
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

interface TeamAuditPanelProps {
  auditLogs: TeamAuditLogRecord[];
}

export function TeamAuditPanel({ auditLogs }: TeamAuditPanelProps) {
  return (
    <section style={panelStyle}>
      <TeamSectionHeader
        eyebrow="Audit trail"
        title="协作审计流"
        description="把共享权限、共享评论和共享操作都留成可追溯时间线，减少口头同步后的事实漂移。"
      />
      <div style={{ display: 'grid', gap: 10, maxHeight: 480, overflowY: 'auto', paddingRight: 4 }}>
        {auditLogs.length === 0 ? (
          <div className="content-card" style={{ padding: 14, color: 'var(--text-3)' }}>
            还没有审计记录。共享会话开始运转后，这里会留下评论、权限与操作的真实轨迹。
          </div>
        ) : (
          auditLogs.map((log) => {
            const actionMeta = getAuditActionMeta(log.action);
            return (
              <div
                key={log.id}
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
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                    {log.summary}
                  </span>
                  <span style={actionMeta.style}>{actionMeta.label}</span>
                </div>
                {log.detail ? (
                  <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>
                    {log.detail}
                  </div>
                ) : null}
                {log.actorEmail ? (
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    执行人：{log.actorEmail}
                  </span>
                ) : null}
                <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                  {new Date(log.createdAt).toLocaleString('zh-CN')}
                </span>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
