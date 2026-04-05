export interface TeamMemberRecord {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'admin' | 'member';
  avatarUrl: string | null;
  status: 'idle' | 'working' | 'done' | 'error';
  createdAt: string;
}

export interface TeamTaskRecord {
  id: string;
  title: string;
  assigneeId: string | null;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  priority: 'low' | 'medium' | 'high';
  result: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface TeamMessageRecord {
  id: string;
  memberId: string;
  content: string;
  type: 'update' | 'question' | 'result' | 'error';
  timestamp: number;
}

export interface CreateTeamMemberInput {
  name: string;
  email: string;
  role?: 'owner' | 'admin' | 'member';
  avatarUrl?: string;
}

export interface CreateTeamTaskInput {
  title: string;
  assigneeId?: string;
  status?: 'pending' | 'in_progress' | 'done';
  priority?: 'low' | 'medium' | 'high';
}

export interface UpdateTeamTaskInput {
  assigneeId?: string | null;
  status?: 'pending' | 'in_progress' | 'done' | 'failed';
  result?: string | null;
}

export interface CreateTeamMessageInput {
  senderId?: string;
  content: string;
  type?: 'update' | 'question' | 'result' | 'error';
}

export interface TeamSessionShareRecord {
  id: string;
  sessionId: string;
  sessionLabel: string;
  workspacePath: string | null;
  memberId: string;
  memberName: string;
  memberEmail: string;
  permission: 'view' | 'comment' | 'operate';
  createdAt: string;
  updatedAt: string;
}

export interface TeamAuditLogRecord {
  id: string;
  action:
    | 'share_created'
    | 'share_deleted'
    | 'share_permission_updated'
    | 'shared_comment_created'
    | 'shared_permission_replied'
    | 'shared_question_replied';
  actorEmail: string | null;
  actorUserId: string | null;
  entityType:
    | 'session_share'
    | 'shared_session_comment'
    | 'permission_request'
    | 'question_request';
  entityId: string;
  summary: string;
  detail: string | null;
  createdAt: string;
}

export interface CreateTeamSessionShareInput {
  sessionId: string;
  memberId: string;
  permission?: 'view' | 'comment' | 'operate';
}

export interface TeamClient {
  listMembers(token: string): Promise<TeamMemberRecord[]>;
  createMember(token: string, input: CreateTeamMemberInput): Promise<TeamMemberRecord>;
  listAuditLogs(token: string, options?: { limit?: number }): Promise<TeamAuditLogRecord[]>;
  listTasks(token: string): Promise<TeamTaskRecord[]>;
  createTask(token: string, input: CreateTeamTaskInput): Promise<TeamTaskRecord>;
  updateTask(token: string, taskId: string, input: UpdateTeamTaskInput): Promise<void>;
  listMessages(token: string): Promise<TeamMessageRecord[]>;
  createMessage(token: string, input: CreateTeamMessageInput): Promise<TeamMessageRecord>;
  listSessionShares(token: string): Promise<TeamSessionShareRecord[]>;
  createSessionShare(
    token: string,
    input: CreateTeamSessionShareInput,
  ): Promise<TeamSessionShareRecord>;
  updateSessionShare(
    token: string,
    shareId: string,
    input: { permission: TeamSessionShareRecord['permission'] },
  ): Promise<TeamSessionShareRecord>;
  deleteSessionShare(token: string, shareId: string): Promise<void>;
}

function buildAuthHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

export function createTeamClient(baseUrl: string): TeamClient {
  return {
    async listAuditLogs(
      token: string,
      options?: { limit?: number },
    ): Promise<TeamAuditLogRecord[]> {
      const params = new URLSearchParams();
      if (typeof options?.limit === 'number') {
        params.set('limit', String(options.limit));
      }
      const suffix = params.toString();
      const response = await fetch(`${baseUrl}/team/audit-logs${suffix ? `?${suffix}` : ''}`, {
        headers: buildAuthHeaders(token),
      });
      if (!response.ok) {
        throw new Error(`Failed to load team audit logs: ${response.status}`);
      }
      return (await response.json()) as TeamAuditLogRecord[];
    },

    async listMembers(token: string): Promise<TeamMemberRecord[]> {
      const response = await fetch(`${baseUrl}/team/members`, {
        headers: buildAuthHeaders(token),
      });
      if (!response.ok) {
        throw new Error(`Failed to load team members: ${response.status}`);
      }
      return (await response.json()) as TeamMemberRecord[];
    },

    async createMember(token: string, input: CreateTeamMemberInput): Promise<TeamMemberRecord> {
      const response = await fetch(`${baseUrl}/team/members`, {
        method: 'POST',
        headers: {
          ...buildAuthHeaders(token),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw new Error(`Failed to create team member: ${response.status}`);
      }
      return (await response.json()) as TeamMemberRecord;
    },

    async listTasks(token: string): Promise<TeamTaskRecord[]> {
      const response = await fetch(`${baseUrl}/team/tasks`, {
        headers: buildAuthHeaders(token),
      });
      if (!response.ok) {
        throw new Error(`Failed to load team tasks: ${response.status}`);
      }
      return (await response.json()) as TeamTaskRecord[];
    },

    async createTask(token: string, input: CreateTeamTaskInput): Promise<TeamTaskRecord> {
      const response = await fetch(`${baseUrl}/team/tasks`, {
        method: 'POST',
        headers: {
          ...buildAuthHeaders(token),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw new Error(`Failed to create team task: ${response.status}`);
      }
      return (await response.json()) as TeamTaskRecord;
    },

    async updateTask(token: string, taskId: string, input: UpdateTeamTaskInput): Promise<void> {
      const response = await fetch(`${baseUrl}/team/tasks/${encodeURIComponent(taskId)}`, {
        method: 'PATCH',
        headers: {
          ...buildAuthHeaders(token),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw new Error(`Failed to update team task: ${response.status}`);
      }
    },

    async listMessages(token: string): Promise<TeamMessageRecord[]> {
      const response = await fetch(`${baseUrl}/team/messages`, {
        headers: buildAuthHeaders(token),
      });
      if (!response.ok) {
        throw new Error(`Failed to load team messages: ${response.status}`);
      }
      return (await response.json()) as TeamMessageRecord[];
    },

    async createMessage(token: string, input: CreateTeamMessageInput): Promise<TeamMessageRecord> {
      const response = await fetch(`${baseUrl}/team/messages`, {
        method: 'POST',
        headers: {
          ...buildAuthHeaders(token),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw new Error(`Failed to create team message: ${response.status}`);
      }
      return (await response.json()) as TeamMessageRecord;
    },

    async listSessionShares(token: string): Promise<TeamSessionShareRecord[]> {
      const response = await fetch(`${baseUrl}/team/session-shares`, {
        headers: buildAuthHeaders(token),
      });
      if (!response.ok) {
        throw new Error(`Failed to load session shares: ${response.status}`);
      }
      return (await response.json()) as TeamSessionShareRecord[];
    },

    async createSessionShare(
      token: string,
      input: CreateTeamSessionShareInput,
    ): Promise<TeamSessionShareRecord> {
      const response = await fetch(`${baseUrl}/team/session-shares`, {
        method: 'POST',
        headers: {
          ...buildAuthHeaders(token),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw new Error(`Failed to create session share: ${response.status}`);
      }
      return (await response.json()) as TeamSessionShareRecord;
    },

    async deleteSessionShare(token: string, shareId: string): Promise<void> {
      const response = await fetch(
        `${baseUrl}/team/session-shares/${encodeURIComponent(shareId)}`,
        {
          method: 'DELETE',
          headers: buildAuthHeaders(token),
        },
      );
      if (!response.ok && response.status !== 204) {
        throw new Error(`Failed to delete session share: ${response.status}`);
      }
    },

    async updateSessionShare(
      token: string,
      shareId: string,
      input: { permission: TeamSessionShareRecord['permission'] },
    ): Promise<TeamSessionShareRecord> {
      const response = await fetch(
        `${baseUrl}/team/session-shares/${encodeURIComponent(shareId)}`,
        {
          method: 'PATCH',
          headers: {
            ...buildAuthHeaders(token),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(input),
        },
      );
      if (!response.ok) {
        throw new Error(`Failed to update session share: ${response.status}`);
      }
      return (await response.json()) as TeamSessionShareRecord;
    },
  };
}
