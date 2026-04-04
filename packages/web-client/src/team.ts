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

export interface TeamClient {
  listMembers(token: string): Promise<TeamMemberRecord[]>;
  createMember(token: string, input: CreateTeamMemberInput): Promise<TeamMemberRecord>;
  listTasks(token: string): Promise<TeamTaskRecord[]>;
  createTask(token: string, input: CreateTeamTaskInput): Promise<TeamTaskRecord>;
  updateTask(token: string, taskId: string, input: UpdateTeamTaskInput): Promise<void>;
  listMessages(token: string): Promise<TeamMessageRecord[]>;
  createMessage(token: string, input: CreateTeamMessageInput): Promise<TeamMessageRecord>;
}

function buildAuthHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

export function createTeamClient(baseUrl: string): TeamClient {
  return {
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
  };
}
