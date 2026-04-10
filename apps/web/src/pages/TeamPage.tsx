import { useState } from 'react';
import type {
  CreateTeamMessageInput,
  TeamMemberRecord,
  TeamMessageRecord,
  TeamSessionShareRecord,
  TeamTaskRecord,
} from '@openAwork/web-client';
import { useTeamCollaboration } from './team/use-team-collaboration.js';
import { submitInteractionAgentFlow } from './team/runtime/interaction-agent-flow.js';
import { TeamRuntimeShell } from './team/runtime/team-runtime-shell.js';

export default function TeamPage() {
  const {
    auditLogs,
    busy,
    createMember,
    createMessage,
    createSharedSessionComment,
    createSessionShare,
    createTask,
    deleteSessionShare,
    error,
    feedback,
    loading,
    members,
    messages,
    replySharedPermission,
    replySharedQuestion,
    selectedSharedSession,
    selectedSharedSessionId,
    tasks,
    sessionShares,
    sharedCommentBusy,
    sharedOperateBusy,
    sharedOperateError,
    sharedSessionLoading,
    sharedSessions,
    sessions,
    setSelectedSharedSessionId,
    updateSessionShare,
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
  const [shareForm, setShareForm] = useState<{
    memberId: string;
    permission: TeamSessionShareRecord['permission'];
    sessionId: string;
  }>({ memberId: '', permission: 'view', sessionId: '' });
  const [sharedCommentDraft, setSharedCommentDraft] = useState('');

  const handleCreateMember = async () => {
    const succeeded = await createMember({
      name: memberForm.name.trim(),
      email: memberForm.email.trim(),
      role: memberForm.role,
      ...(memberForm.avatarUrl.trim() ? { avatarUrl: memberForm.avatarUrl.trim() } : {}),
    });
    if (succeeded) {
      setMemberForm({ avatarUrl: '', email: '', name: '', role: 'member' });
    }
  };

  const handleCreateTask = async () => {
    const succeeded = await createTask({
      title: taskForm.title.trim(),
      priority: taskForm.priority,
      ...(taskForm.assigneeId ? { assigneeId: taskForm.assigneeId } : {}),
    });
    if (succeeded) {
      setTaskForm({ assigneeId: '', priority: 'medium', title: '' });
    }
  };

  const handleCreateMessage = async () => {
    const succeeded = await submitTeamMessage({
      content: messageForm.content,
      type: messageForm.type,
      ...(messageForm.senderId ? { senderId: messageForm.senderId } : {}),
    });
    if (succeeded) {
      setMessageForm((current) => ({ ...current, content: '' }));
    }
  };

  const submitTeamMessage = async (input: CreateTeamMessageInput) => {
    return createMessage({
      ...input,
      content: input.content.trim(),
    });
  };

  const handleCreateInteractionMessage = async (content: string) => {
    return submitInteractionAgentFlow({
      submitMessage: submitTeamMessage,
      userIntent: content,
    });
  };

  const handleCreateSessionShare = async () => {
    const succeeded = await createSessionShare({
      memberId: shareForm.memberId,
      permission: shareForm.permission,
      sessionId: shareForm.sessionId,
    });
    if (succeeded) {
      setShareForm({ memberId: '', permission: 'view', sessionId: '' });
    }
  };

  const handleCreateSharedComment = async () => {
    if (!selectedSharedSessionId) {
      return;
    }

    const succeeded = await createSharedSessionComment(selectedSharedSessionId, {
      content: sharedCommentDraft.trim(),
    });
    if (succeeded) {
      setSharedCommentDraft('');
    }
  };

  return (
    <TeamRuntimeShell
      auditLogs={auditLogs}
      busy={busy}
      error={error}
      feedback={feedback}
      loading={loading}
      memberForm={memberForm}
      members={members}
      messageForm={messageForm}
      messages={messages}
      onCreateMember={() => void handleCreateMember()}
      onCreateInteractionMessage={handleCreateInteractionMessage}
      onCreateMessage={() => void handleCreateMessage()}
      onCreateSessionShare={() => void handleCreateSessionShare()}
      onCreateSharedComment={() => void handleCreateSharedComment()}
      onCreateTask={() => void handleCreateTask()}
      onDeleteSessionShare={(shareId) => void deleteSessionShare(shareId)}
      onMemberFormChange={(patch) => setMemberForm((current) => ({ ...current, ...patch }))}
      onMessageFormChange={(patch) => setMessageForm((current) => ({ ...current, ...patch }))}
      onReplySharedPermission={(requestId, decision) => {
        if (!selectedSharedSessionId) {
          return;
        }
        void replySharedPermission(selectedSharedSessionId, { requestId, decision });
      }}
      onReplySharedQuestion={(input) => {
        if (!selectedSharedSessionId) {
          return;
        }
        void replySharedQuestion(selectedSharedSessionId, input);
      }}
      onSelectSharedSession={(sessionId) => {
        setSelectedSharedSessionId(sessionId);
        setSharedCommentDraft('');
      }}
      onSessionSharePermissionChange={(shareId, permission) =>
        void updateSessionShare(shareId, { permission })
      }
      onShareFormChange={(patch) => setShareForm((current) => ({ ...current, ...patch }))}
      onSharedCommentDraftChange={setSharedCommentDraft}
      onTaskFormChange={(patch) => setTaskForm((current) => ({ ...current, ...patch }))}
      onTaskStatusChange={(taskId, status) =>
        void updateTask(taskId, {
          status: status === 'completed' ? 'done' : status,
          result:
            status === 'completed'
              ? '已在 Team Runtime 总控页中完成收口'
              : status === 'failed'
                ? '任务当前受阻，需要进一步协调'
                : '任务已进入推进阶段',
        })
      }
      selectedSharedSession={selectedSharedSession}
      selectedSharedSessionId={selectedSharedSessionId}
      sessionShares={sessionShares}
      sessions={sessions}
      shareForm={shareForm}
      sharedCommentBusy={sharedCommentBusy}
      sharedCommentDraft={sharedCommentDraft}
      sharedOperateBusy={sharedOperateBusy}
      sharedOperateError={sharedOperateError}
      sharedSessionLoading={sharedSessionLoading}
      sharedSessions={sharedSessions}
      taskForm={taskForm}
      tasks={tasks}
    />
  );
}
