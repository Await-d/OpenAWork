import type { TeamMemberRecord, TeamMessageRecord, TeamTaskRecord } from '@openAwork/web-client';

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
                    {memberNameMap.get(message.memberId) ?? message.memberId}
                  </span>
                  <span style={typeMeta.style}>{typeMeta.label}</span>
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text)' }}>
                  {message.content}
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
