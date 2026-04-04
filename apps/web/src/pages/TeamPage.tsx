import { useMemo, useState } from 'react';
import type { TeamMemberRecord, TeamMessageRecord, TeamTaskRecord } from '@openAwork/web-client';
import { TeamMembersPanel, TeamMessagesPanel, TeamTasksPanel } from './team/team-page-sections.js';
import { useTeamCollaboration } from './team/use-team-collaboration.js';

export default function TeamPage() {
  const {
    busy,
    createMember,
    createMessage,
    createTask,
    error,
    feedback,
    loading,
    members,
    messages,
    tasks,
    updateTask,
  } = useTeamCollaboration();

  const [memberForm, setMemberForm] = useState<{
    avatarUrl: string;
    email: string;
    name: string;
    role: TeamMemberRecord['role'];
  }>({
    avatarUrl: '',
    email: '',
    name: '',
    role: 'member',
  });
  const [taskForm, setTaskForm] = useState<{
    assigneeId: string;
    priority: TeamTaskRecord['priority'];
    title: string;
  }>({ assigneeId: '', priority: 'medium', title: '' });
  const [messageForm, setMessageForm] = useState<{
    content: string;
    senderId: string;
    type: TeamMessageRecord['type'];
  }>({ content: '', senderId: '', type: 'update' });

  const stats = useMemo(() => {
    const inProgress = tasks.filter((task) => task.status === 'in_progress').length;
    const completed = tasks.filter((task) => task.status === 'completed').length;
    return [
      { label: '成员', value: members.length, hint: '可被指派的协作者' },
      { label: '推进中', value: inProgress, hint: '当前正在处理的任务' },
      { label: '已完成', value: completed, hint: '已经交付的结果' },
      { label: '消息', value: messages.length, hint: '共享更新与阻塞同步' },
    ];
  }, [members.length, messages.length, tasks]);

  const memberNameMap = useMemo(
    () => new Map(members.map((member) => [member.id, member.name])),
    [members],
  );

  const handleCreateMember = async () => {
    await createMember({
      name: memberForm.name.trim(),
      email: memberForm.email.trim(),
      role: memberForm.role,
      ...(memberForm.avatarUrl.trim() ? { avatarUrl: memberForm.avatarUrl.trim() } : {}),
    });
    setMemberForm({ avatarUrl: '', email: '', name: '', role: 'member' });
  };

  const handleCreateTask = async () => {
    await createTask({
      title: taskForm.title.trim(),
      priority: taskForm.priority,
      ...(taskForm.assigneeId ? { assigneeId: taskForm.assigneeId } : {}),
    });
    setTaskForm({ assigneeId: '', priority: 'medium', title: '' });
  };

  const handleCreateMessage = async () => {
    await createMessage({
      content: messageForm.content.trim(),
      type: messageForm.type,
      ...(messageForm.senderId ? { senderId: messageForm.senderId } : {}),
    });
    setMessageForm((current) => ({ ...current, content: '' }));
  };

  return (
    <div className="page-root">
      <div className="page-header">
        <span className="page-title">团队协作</span>
        <span className="page-subtitle">把成员、任务和消息沉淀进同一个共享工作区</span>
      </div>
      <div className="page-content">
        <div
          style={{
            maxWidth: 'min(1440px, 100%)',
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
              borderRadius: 24,
              background:
                'radial-gradient(circle at top left, rgba(91, 140, 255, 0.22), transparent 34%), linear-gradient(135deg, color-mix(in srgb, var(--surface) 94%, rgba(15, 23, 42, 0.3)) 0%, var(--surface) 100%)',
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
                Collaboration moat
              </span>
              <div style={{ display: 'grid', gap: 8 }}>
                <span
                  style={{
                    fontSize: 'clamp(28px, 4vw, 44px)',
                    fontWeight: 800,
                    letterSpacing: '-0.04em',
                    lineHeight: 1.02,
                  }}
                >
                  把协作从“旁路沟通”拉回产品主舞台。
                </span>
                <span
                  style={{
                    maxWidth: 820,
                    fontSize: 14,
                    lineHeight: 1.8,
                    color: 'var(--text-2)',
                  }}
                >
                  这里不是简单的任务列表，而是一个把协作成员、上下文认领、结果同步和阻塞提醒串到一起的共享作战室。你可以直接在产品内看见谁在做、做到哪一步、还卡在哪里。
                </span>
              </div>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                gap: 12,
              }}
            >
              {stats.map((stat) => (
                <div
                  key={stat.label}
                  className="content-card"
                  style={{ padding: 14, display: 'grid', gap: 4 }}
                >
                  <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{stat.label}</span>
                  <span style={{ fontSize: 24, fontWeight: 800 }}>{stat.value}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{stat.hint}</span>
                </div>
              ))}
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
                style={{
                  padding: 12,
                  borderColor: 'rgba(244, 63, 94, 0.35)',
                  color: '#fecdd3',
                }}
              >
                {error}
              </div>
            ) : null}
          </section>

          {loading ? (
            <div
              className="content-card"
              style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)' }}
            >
              团队协作面板加载中…
            </div>
          ) : (
            <section
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                gap: 16,
                alignItems: 'start',
              }}
            >
              <TeamMembersPanel
                busy={busy}
                form={memberForm}
                members={members}
                onAvatarUrlChange={(value) =>
                  setMemberForm((current) => ({ ...current, avatarUrl: value }))
                }
                onEmailChange={(value) =>
                  setMemberForm((current) => ({ ...current, email: value }))
                }
                onNameChange={(value) => setMemberForm((current) => ({ ...current, name: value }))}
                onRoleChange={(value) => setMemberForm((current) => ({ ...current, role: value }))}
                onSubmit={() => void handleCreateMember()}
              />
              <TeamTasksPanel
                busy={busy}
                form={taskForm}
                members={members}
                onAssigneeIdChange={(value) =>
                  setTaskForm((current) => ({ ...current, assigneeId: value }))
                }
                onPriorityChange={(value) =>
                  setTaskForm((current) => ({ ...current, priority: value }))
                }
                onStatusChange={(taskId, status) =>
                  void updateTask(taskId, {
                    status: status === 'completed' ? 'done' : status,
                    result:
                      status === 'completed'
                        ? '已在协作面板中完成收口'
                        : status === 'failed'
                          ? '任务当前受阻，需要进一步协调'
                          : '任务已进入推进阶段',
                  })
                }
                onSubmit={() => void handleCreateTask()}
                onTitleChange={(value) => setTaskForm((current) => ({ ...current, title: value }))}
                tasks={tasks}
              />
              <TeamMessagesPanel
                busy={busy}
                form={messageForm}
                memberNameMap={memberNameMap}
                members={members}
                messages={messages}
                onContentChange={(value) =>
                  setMessageForm((current) => ({ ...current, content: value }))
                }
                onSenderIdChange={(value) =>
                  setMessageForm((current) => ({ ...current, senderId: value }))
                }
                onSubmit={() => void handleCreateMessage()}
                onTypeChange={(value) => setMessageForm((current) => ({ ...current, type: value }))}
              />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
