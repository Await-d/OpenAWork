import React, { useEffect, useState } from 'react';
import { TeamPanel, StatusPill } from '@openAwork/shared-ui';
import type { TeamMember, TeamTask, TeamMessage } from '@openAwork/shared-ui';
import { useAuthStore } from '../stores/auth.js';

const sharedUiThemeVars = {
  '--color-surface': 'var(--surface)',
  '--color-border': 'var(--border)',
  '--color-text': 'var(--text)',
  '--color-muted': 'var(--text-3)',
  '--color-accent': 'var(--accent)',
  '--color-bg': 'var(--bg)',
  '--color-background': 'var(--bg)',
  '--color-foreground': 'var(--text)',
  '--color-primary': 'var(--accent)',
  '--color-primary-foreground': 'var(--accent-text)',
} as React.CSSProperties;

export default function TeamPage() {
  const token = useAuthStore((s) => s.accessToken);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [tasks, setTasks] = useState<TeamTask[]>([]);
  const [messages, setMessages] = useState<TeamMessage[]>([]);
  const [messageInput, setMessageInput] = useState('');

  useEffect(() => {
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    Promise.all([
      fetch(`${gatewayUrl}/team/members`, { headers }).then(
        (r) => r.json() as Promise<TeamMember[]>,
      ),
      fetch(`${gatewayUrl}/team/tasks`, { headers }).then((r) => r.json() as Promise<TeamTask[]>),
      fetch(`${gatewayUrl}/team/messages`, { headers }).then(
        (r) => r.json() as Promise<TeamMessage[]>,
      ),
    ]).then(([m, t, msg]) => {
      setMembers(m);
      setTasks(t);
      setMessages(msg);
    });
  }, [token, gatewayUrl]);

  const headers = token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : undefined;
  const currentActorId = members[0]?.id;

  async function sendTeamMessage(type: TeamMessage['type'] = 'update') {
    if (!token || !messageInput.trim()) return;
    const response = await fetch(`${gatewayUrl}/team/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ content: messageInput.trim(), type }),
    });
    const payload = (await response.json()) as TeamMessage;
    setMessages((prev) => [...prev, payload]);
    setMessageInput('');
  }

  async function claimTask(taskId: string) {
    if (!token) return;
    await fetch(`${gatewayUrl}/team/tasks/${taskId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        assigneeId: currentActorId ?? null,
        status: 'in_progress',
        result: '任务已认领',
      }),
    });
    setTasks((prev) =>
      prev.map((task) =>
        task.id === taskId
          ? { ...task, assignedTo: currentActorId ?? 'system', status: 'in_progress' }
          : task,
      ),
    );
    setMessages((prev) => [
      ...prev,
      {
        id: `claim-${taskId}-${Date.now()}`,
        memberId: currentActorId ?? 'system',
        content: '任务已认领',
        timestamp: Date.now(),
        type: 'update',
      },
    ]);
  }

  const workingCount = members.filter((m) => m.status === 'working').length;
  const idleCount = members.filter((m) => m.status === 'idle').length;

  return (
    <div className="page-root">
      <div className="page-header">
        <span className="page-title">团队协作</span>
        <div style={{ flex: 1 }} />
        {workingCount > 0 && <StatusPill label={`${workingCount} 运行中`} color="info" />}
        {idleCount > 0 && <StatusPill label={`${idleCount} 空闲`} color="muted" />}
        {members.length === 0 && <StatusPill label="无成员" color="muted" />}
      </div>
      <div className="page-content" style={{ padding: 0, overflow: 'hidden' }}>
        <div
          style={{ height: '100%', display: 'flex', flexDirection: 'column', ...sharedUiThemeVars }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '0.85rem 1rem',
              borderBottom: '1px solid var(--border)',
              background: 'var(--surface)',
            }}
          >
            <textarea
              value={messageInput}
              onChange={(event) => setMessageInput(event.target.value)}
              placeholder="发送团队协同消息…"
              style={{
                flex: 1,
                minHeight: 38,
                resize: 'vertical',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--bg)',
                color: 'var(--text)',
                padding: '8px 10px',
                fontSize: 12,
              }}
            />
            <button
              type="button"
              onClick={() => void sendTeamMessage('question')}
              style={{
                background: 'var(--accent)',
                color: 'var(--accent-text)',
                border: 'none',
                borderRadius: 8,
                padding: '8px 14px',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              发送消息
            </button>
            {tasks.length > 0 && (
              <button
                type="button"
                onClick={() => void claimTask(tasks[0]!.id)}
                style={{
                  background: 'transparent',
                  color: 'var(--text-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: '8px 12px',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                认领首个任务
              </button>
            )}
          </div>
          <TeamPanel
            teamName="OpenAWork 团队"
            description="AI 智能体协同处理你的代码库"
            members={members}
            tasks={tasks}
            messages={messages}
          />
        </div>
      </div>
    </div>
  );
}
