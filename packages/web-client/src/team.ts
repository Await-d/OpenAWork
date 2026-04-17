import type {
  Session,
  SessionImportInput,
  SessionImportResult,
  SessionTask,
  SharedSessionCommentRecord,
  SharedSessionDetailRecord,
  SharedSessionPresenceRecord,
  SharedSessionSummaryRecord,
} from './sessions.js';

export type TeamWorkspaceVisibility = 'open' | 'closed' | 'private';

export interface TeamWorkspaceSummary {
  id: string;
  name: string;
  description: string | null;
  visibility: TeamWorkspaceVisibility;
  defaultWorkingRoot: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export type TeamWorkspaceDetail = TeamWorkspaceSummary;

export interface CreateTeamWorkspaceInput {
  name: string;
  description?: string | null;
  visibility?: TeamWorkspaceVisibility;
  defaultWorkingRoot?: string | null;
}

export interface UpdateTeamWorkspaceInput {
  name?: string;
  description?: string | null;
  visibility?: TeamWorkspaceVisibility;
  defaultWorkingRoot?: string | null;
}

export interface CreateTeamThreadInput {
  metadata?: Record<string, unknown>;
  title?: string;
}

export type TeamSessionTemplateSourceKind = 'blank' | 'builtin-template' | 'saved-template';

export interface CreateTeamSessionInput {
  title?: string;
  source?: {
    kind: TeamSessionTemplateSourceKind;
    templateId?: string;
  };
  optionalAgentIds?: string[];
  defaultProvider?: string | null;
}

export type ImportTeamWorkspaceSessionInput = SessionImportInput;

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

export interface TeamRuntimeSessionRecord {
  id: string;
  metadataJson: string;
  parentSessionId: string | null;
  stateStatus: string;
  title: string | null;
  updatedAt: string;
  workspacePath: string | null;
}

export interface TeamRuntimeTaskGroupRecord {
  sessionIds: string[];
  tasks: SessionTask[];
  updatedAt: number;
  workspacePath: string | null;
}

export interface TeamWorkspaceSnapshot {
  workspace: TeamWorkspaceDetail;
  sessions: TeamRuntimeSessionRecord[];
  sharedSessions: SharedSessionSummaryRecord[];
  sessionShares: TeamSessionShareRecord[];
  runtimeTaskGroups: TeamRuntimeTaskGroupRecord[];
}

export interface TeamRuntimeReadModel {
  auditLogs: TeamAuditLogRecord[];
  members: TeamMemberRecord[];
  messages: TeamMessageRecord[];
  runtimeTaskGroups: TeamRuntimeTaskGroupRecord[];
  sessionShares: TeamSessionShareRecord[];
  sessions: TeamRuntimeSessionRecord[];
  sharedSessions: SharedSessionSummaryRecord[];
  tasks: TeamTaskRecord[];
}

export interface TeamClient {
  listWorkspaces(token: string): Promise<TeamWorkspaceSummary[]>;
  getWorkspace(token: string, teamWorkspaceId: string): Promise<TeamWorkspaceDetail>;
  createWorkspace(token: string, input: CreateTeamWorkspaceInput): Promise<TeamWorkspaceDetail>;
  updateWorkspace(
    token: string,
    teamWorkspaceId: string,
    input: UpdateTeamWorkspaceInput,
  ): Promise<TeamWorkspaceDetail>;
  createThread(
    token: string,
    teamWorkspaceId: string,
    input?: CreateTeamThreadInput,
  ): Promise<Session>;
  createSession(
    token: string,
    teamWorkspaceId: string,
    input: CreateTeamSessionInput,
  ): Promise<Session>;
  importIntoWorkspace(
    token: string,
    teamWorkspaceId: string,
    input: ImportTeamWorkspaceSessionInput,
  ): Promise<SessionImportResult>;
  getSharedSessionDetail(token: string, sessionId: string): Promise<SharedSessionDetailRecord>;
  createSharedSessionComment(
    token: string,
    sessionId: string,
    input: { content: string },
  ): Promise<SharedSessionCommentRecord>;
  touchSharedSessionPresence(
    token: string,
    sessionId: string,
  ): Promise<SharedSessionPresenceRecord[]>;
  replySharedSessionPermission(
    token: string,
    sessionId: string,
    input: { decision: 'once' | 'session' | 'permanent' | 'reject'; requestId: string },
  ): Promise<void>;
  replySharedSessionQuestion(
    token: string,
    sessionId: string,
    input: { answers?: string[][]; requestId: string; status: 'answered' | 'dismissed' },
  ): Promise<void>;
  getWorkspaceSnapshot(token: string, teamWorkspaceId: string): Promise<TeamWorkspaceSnapshot>;
  getRuntime(token: string, options?: { teamWorkspaceId?: string }): Promise<TeamRuntimeReadModel>;
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
  updateSessionState(
    token: string,
    sessionId: string,
    input: { stateStatus: 'idle' | 'running' | 'paused'; title?: string },
  ): Promise<void>;
  deleteSession(token: string, sessionId: string): Promise<string[]>;
}

function buildAuthHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

export function createTeamClient(baseUrl: string): TeamClient {
  return {
    async listWorkspaces(token: string): Promise<TeamWorkspaceSummary[]> {
      const response = await fetch(`${baseUrl}/team/workspaces`, {
        headers: buildAuthHeaders(token),
      });
      if (!response.ok) {
        throw new Error(`Failed to load team workspaces: ${response.status}`);
      }
      return (await response.json()) as TeamWorkspaceSummary[];
    },

    async getWorkspace(token: string, teamWorkspaceId: string): Promise<TeamWorkspaceDetail> {
      const response = await fetch(
        `${baseUrl}/team/workspaces/${encodeURIComponent(teamWorkspaceId)}`,
        {
          headers: buildAuthHeaders(token),
        },
      );
      if (!response.ok) {
        throw new Error(`Failed to load team workspace: ${response.status}`);
      }
      return (await response.json()) as TeamWorkspaceDetail;
    },

    async createWorkspace(
      token: string,
      input: CreateTeamWorkspaceInput,
    ): Promise<TeamWorkspaceDetail> {
      const response = await fetch(`${baseUrl}/team/workspaces`, {
        method: 'POST',
        headers: {
          ...buildAuthHeaders(token),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw new Error(`Failed to create team workspace: ${response.status}`);
      }
      return (await response.json()) as TeamWorkspaceDetail;
    },

    async updateWorkspace(
      token: string,
      teamWorkspaceId: string,
      input: UpdateTeamWorkspaceInput,
    ): Promise<TeamWorkspaceDetail> {
      const response = await fetch(
        `${baseUrl}/team/workspaces/${encodeURIComponent(teamWorkspaceId)}`,
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
        throw new Error(`Failed to update team workspace: ${response.status}`);
      }
      return (await response.json()) as TeamWorkspaceDetail;
    },

    async createThread(
      token: string,
      teamWorkspaceId: string,
      input: CreateTeamThreadInput = {},
    ): Promise<Session> {
      const response = await fetch(
        `${baseUrl}/team/workspaces/${encodeURIComponent(teamWorkspaceId)}/threads`,
        {
          method: 'POST',
          headers: {
            ...buildAuthHeaders(token),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(input),
        },
      );
      if (!response.ok) {
        throw new Error(`Failed to create team thread: ${response.status}`);
      }
      return (await response.json()) as Session;
    },

    async createSession(
      token: string,
      teamWorkspaceId: string,
      input: CreateTeamSessionInput,
    ): Promise<Session> {
      const response = await fetch(
        `${baseUrl}/team/workspaces/${encodeURIComponent(teamWorkspaceId)}/sessions`,
        {
          method: 'POST',
          headers: {
            ...buildAuthHeaders(token),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(input),
        },
      );
      if (!response.ok) {
        throw new Error(`Failed to create team session: ${response.status}`);
      }
      return (await response.json()) as Session;
    },

    async importIntoWorkspace(
      token: string,
      teamWorkspaceId: string,
      input: ImportTeamWorkspaceSessionInput,
    ): Promise<SessionImportResult> {
      const response = await fetch(
        `${baseUrl}/team/workspaces/${encodeURIComponent(teamWorkspaceId)}/imports`,
        {
          method: 'POST',
          headers: {
            ...buildAuthHeaders(token),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(input),
        },
      );
      if (!response.ok) {
        throw new Error(`Failed to import session into workspace: ${response.status}`);
      }
      return (await response.json()) as SessionImportResult;
    },

    async getSharedSessionDetail(
      token: string,
      sessionId: string,
    ): Promise<SharedSessionDetailRecord> {
      const response = await fetch(`${baseUrl}/sessions/shared-with-me/${sessionId}`, {
        headers: buildAuthHeaders(token),
      });
      if (!response.ok) {
        throw new Error(`Failed to load shared session detail: ${response.status}`);
      }
      return (await response.json()) as SharedSessionDetailRecord;
    },

    async createSharedSessionComment(
      token: string,
      sessionId: string,
      input: { content: string },
    ): Promise<SharedSessionCommentRecord> {
      const response = await fetch(`${baseUrl}/sessions/shared-with-me/${sessionId}/comments`, {
        method: 'POST',
        headers: {
          ...buildAuthHeaders(token),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw new Error(`Failed to create shared session comment: ${response.status}`);
      }
      const data = (await response.json()) as { comment: SharedSessionCommentRecord };
      return data.comment;
    },

    async touchSharedSessionPresence(
      token: string,
      sessionId: string,
    ): Promise<SharedSessionPresenceRecord[]> {
      const response = await fetch(`${baseUrl}/sessions/shared-with-me/${sessionId}/presence`, {
        method: 'POST',
        headers: buildAuthHeaders(token),
      });
      if (!response.ok) {
        throw new Error(`Failed to update shared session presence: ${response.status}`);
      }
      const data = (await response.json()) as { presence?: SharedSessionPresenceRecord[] };
      return data.presence ?? [];
    },

    async replySharedSessionPermission(
      token: string,
      sessionId: string,
      input: { decision: 'once' | 'session' | 'permanent' | 'reject'; requestId: string },
    ): Promise<void> {
      const response = await fetch(
        `${baseUrl}/sessions/shared-with-me/${sessionId}/permissions/reply`,
        {
          method: 'POST',
          headers: {
            ...buildAuthHeaders(token),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(input),
        },
      );
      if (!response.ok) {
        throw new Error(`Failed to reply shared permission: ${response.status}`);
      }
    },

    async replySharedSessionQuestion(
      token: string,
      sessionId: string,
      input: { answers?: string[][]; requestId: string; status: 'answered' | 'dismissed' },
    ): Promise<void> {
      const response = await fetch(
        `${baseUrl}/sessions/shared-with-me/${sessionId}/questions/reply`,
        {
          method: 'POST',
          headers: {
            ...buildAuthHeaders(token),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(input),
        },
      );
      if (!response.ok) {
        throw new Error(`Failed to reply shared question: ${response.status}`);
      }
    },

    async getWorkspaceSnapshot(
      token: string,
      teamWorkspaceId: string,
    ): Promise<TeamWorkspaceSnapshot> {
      const response = await fetch(
        `${baseUrl}/team/workspaces/${encodeURIComponent(teamWorkspaceId)}/runtime`,
        {
          headers: buildAuthHeaders(token),
        },
      );
      if (!response.ok) {
        throw new Error(`Failed to load team workspace snapshot: ${response.status}`);
      }
      return (await response.json()) as TeamWorkspaceSnapshot;
    },

    async getRuntime(
      token: string,
      options?: { teamWorkspaceId?: string },
    ): Promise<TeamRuntimeReadModel> {
      const params = new URLSearchParams();
      if (options?.teamWorkspaceId) {
        params.set('teamWorkspaceId', options.teamWorkspaceId);
      }
      const suffix = params.toString();
      const response = await fetch(`${baseUrl}/team/runtime${suffix ? `?${suffix}` : ''}`, {
        headers: buildAuthHeaders(token),
      });
      if (!response.ok) {
        throw new Error(`Failed to load team runtime: ${response.status}`);
      }
      return (await response.json()) as TeamRuntimeReadModel;
    },

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

    async updateSessionState(
      token: string,
      sessionId: string,
      input: { stateStatus: 'idle' | 'running' | 'paused'; title?: string },
    ): Promise<void> {
      const response = await fetch(`${baseUrl}/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'PATCH',
        headers: {
          ...buildAuthHeaders(token),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          state_status: input.stateStatus,
          ...(input.title != null ? { title: input.title } : {}),
        }),
      });
      if (!response.ok) {
        throw new Error(`Failed to update session state: ${response.status}`);
      }
    },

    async deleteSession(token: string, sessionId: string): Promise<string[]> {
      const response = await fetch(`${baseUrl}/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
        headers: buildAuthHeaders(token),
      });
      if (!response.ok) {
        throw new Error(`Failed to delete session: ${response.status}`);
      }
      const data = (await response.json()) as { deletedSessionIds: string[]; ok: boolean };
      return data.deletedSessionIds ?? [];
    },
  };
}
