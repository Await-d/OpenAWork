export interface AgentProfileRecord {
  agentId: string | null;
  createdAt: string;
  id: string;
  label: string;
  modelId: string | null;
  note: string | null;
  providerId: string | null;
  toolSurfaceProfile: 'openawork' | 'claude_code_default' | 'claude_code_simple';
  updatedAt: string;
  workspacePath: string;
}

export interface AgentProfilesClient {
  list(token: string): Promise<AgentProfileRecord[]>;
  getCurrent(token: string, workspacePath: string): Promise<AgentProfileRecord | null>;
  create(
    token: string,
    input: {
      workspacePath: string;
      label: string;
      agentId?: string;
      providerId?: string;
      modelId?: string;
      toolSurfaceProfile?: 'openawork' | 'claude_code_default' | 'claude_code_simple';
      note?: string;
    },
  ): Promise<AgentProfileRecord>;
  update(
    token: string,
    profileId: string,
    input: Partial<{
      workspacePath: string;
      label: string;
      agentId?: string;
      providerId?: string;
      modelId?: string;
      toolSurfaceProfile?: 'openawork' | 'claude_code_default' | 'claude_code_simple';
      note?: string;
    }>,
  ): Promise<AgentProfileRecord>;
  remove(token: string, profileId: string): Promise<void>;
}

function authHeader(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

export function createAgentProfilesClient(baseUrl: string): AgentProfilesClient {
  return {
    async list(token) {
      const response = await fetch(`${baseUrl}/agent-profiles`, { headers: authHeader(token) });
      if (!response.ok) {
        throw new Error(`Failed to load agent profiles: ${response.status}`);
      }
      const data = (await response.json()) as { profiles?: AgentProfileRecord[] };
      return data.profiles ?? [];
    },

    async getCurrent(token, workspacePath) {
      const response = await fetch(
        `${baseUrl}/agent-profiles/current?workspacePath=${encodeURIComponent(workspacePath)}`,
        { headers: authHeader(token) },
      );
      if (!response.ok) {
        throw new Error(`Failed to load current agent profile: ${response.status}`);
      }
      const data = (await response.json()) as { profile?: AgentProfileRecord | null };
      return data.profile ?? null;
    },

    async create(token, input) {
      const response = await fetch(`${baseUrl}/agent-profiles`, {
        method: 'POST',
        headers: { ...authHeader(token), 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw new Error(`Failed to create agent profile: ${response.status}`);
      }
      const data = (await response.json()) as { profile: AgentProfileRecord };
      return data.profile;
    },

    async update(token, profileId, input) {
      const response = await fetch(`${baseUrl}/agent-profiles/${encodeURIComponent(profileId)}`, {
        method: 'PUT',
        headers: { ...authHeader(token), 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw new Error(`Failed to update agent profile: ${response.status}`);
      }
      const data = (await response.json()) as { profile: AgentProfileRecord };
      return data.profile;
    },

    async remove(token, profileId) {
      const response = await fetch(`${baseUrl}/agent-profiles/${encodeURIComponent(profileId)}`, {
        method: 'DELETE',
        headers: authHeader(token),
      });
      if (!response.ok && response.status !== 204) {
        throw new Error(`Failed to remove agent profile: ${response.status}`);
      }
    },
  };
}
