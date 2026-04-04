import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createTeamClient,
  type CreateTeamMemberInput,
  type CreateTeamMessageInput,
  type CreateTeamTaskInput,
  type TeamMemberRecord,
  type TeamMessageRecord,
  type TeamTaskRecord,
  type UpdateTeamTaskInput,
} from '@openAwork/web-client';
import { useAuthStore } from '../../stores/auth.js';

interface TeamSnapshot {
  members: TeamMemberRecord[];
  messages: TeamMessageRecord[];
  tasks: TeamTaskRecord[];
}

export interface TeamActionFeedback {
  message: string;
  tone: 'error' | 'success';
}

function sortMembers(members: TeamMemberRecord[]): TeamMemberRecord[] {
  return [...members].sort((left, right) => left.createdAt.localeCompare(right.createdAt, 'zh-CN'));
}

function sortTasks(tasks: TeamTaskRecord[]): TeamTaskRecord[] {
  const statusRank: Record<TeamTaskRecord['status'], number> = {
    in_progress: 0,
    pending: 1,
    failed: 2,
    completed: 3,
  };

  return [...tasks].sort((left, right) => {
    const rankDelta = statusRank[left.status] - statusRank[right.status];
    if (rankDelta !== 0) {
      return rankDelta;
    }
    return (right.updatedAt ?? right.createdAt ?? '').localeCompare(
      left.updatedAt ?? left.createdAt ?? '',
      'zh-CN',
    );
  });
}

function sortMessages(messages: TeamMessageRecord[]): TeamMessageRecord[] {
  return [...messages].sort((left, right) => left.timestamp - right.timestamp);
}

export function useTeamCollaboration() {
  const accessToken = useAuthStore((state) => state.accessToken);
  const gatewayUrl = useAuthStore((state) => state.gatewayUrl);
  const [members, setMembers] = useState<TeamMemberRecord[]>([]);
  const [tasks, setTasks] = useState<TeamTaskRecord[]>([]);
  const [messages, setMessages] = useState<TeamMessageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<TeamActionFeedback | null>(null);

  const client = useMemo(() => createTeamClient(gatewayUrl), [gatewayUrl]);

  const loadSnapshot = useCallback(async (): Promise<TeamSnapshot> => {
    if (!accessToken) {
      return { members: [], messages: [], tasks: [] };
    }

    const [nextMembers, nextTasks, nextMessages] = await Promise.all([
      client.listMembers(accessToken),
      client.listTasks(accessToken),
      client.listMessages(accessToken),
    ]);

    return {
      members: sortMembers(nextMembers),
      messages: sortMessages(nextMessages),
      tasks: sortTasks(nextTasks),
    };
  }, [accessToken, client]);

  const refresh = useCallback(async () => {
    if (!accessToken) {
      setMembers([]);
      setTasks([]);
      setMessages([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const snapshot = await loadSnapshot();
      setMembers(snapshot.members);
      setTasks(snapshot.tasks);
      setMessages(snapshot.messages);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '加载团队协作数据失败');
    } finally {
      setLoading(false);
    }
  }, [accessToken, loadSnapshot]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runMutation = useCallback(
    async (action: () => Promise<void>, successMessage: string) => {
      setBusy(true);
      setError(null);
      setFeedback(null);
      try {
        await action();
        const snapshot = await loadSnapshot();
        setMembers(snapshot.members);
        setTasks(snapshot.tasks);
        setMessages(snapshot.messages);
        setFeedback({ message: successMessage, tone: 'success' });
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : '团队协作操作失败';
        setError(message);
        setFeedback({ message, tone: 'error' });
      } finally {
        setBusy(false);
      }
    },
    [loadSnapshot],
  );

  const createMember = useCallback(
    async (input: CreateTeamMemberInput) => {
      if (!accessToken) {
        return;
      }
      await runMutation(async () => {
        await client.createMember(accessToken, input);
      }, '已新增团队成员');
    },
    [accessToken, client, runMutation],
  );

  const createTask = useCallback(
    async (input: CreateTeamTaskInput) => {
      if (!accessToken) {
        return;
      }
      await runMutation(async () => {
        await client.createTask(accessToken, input);
      }, '已创建协作任务');
    },
    [accessToken, client, runMutation],
  );

  const updateTask = useCallback(
    async (taskId: string, input: UpdateTeamTaskInput) => {
      if (!accessToken) {
        return;
      }
      await runMutation(async () => {
        await client.updateTask(accessToken, taskId, input);
      }, '已更新任务状态');
    },
    [accessToken, client, runMutation],
  );

  const createMessage = useCallback(
    async (input: CreateTeamMessageInput) => {
      if (!accessToken) {
        return;
      }
      await runMutation(async () => {
        await client.createMessage(accessToken, input);
      }, '已发送团队消息');
    },
    [accessToken, client, runMutation],
  );

  return {
    busy,
    createMember,
    createMessage,
    createTask,
    error,
    feedback,
    loading,
    members,
    messages,
    refresh,
    tasks,
    updateTask,
  };
}
