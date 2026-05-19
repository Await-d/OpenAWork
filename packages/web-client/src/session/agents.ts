import type {
  CreateManagedAgentInput,
  ManagedAgentRecord,
  UpdateManagedAgentInput,
} from '@openAwork/shared';

export interface AgentsClient {
  list(token: string): Promise<ManagedAgentRecord[]>;
  create(token: string, input: CreateManagedAgentInput): Promise<ManagedAgentRecord>;
  update(
    token: string,
    agentId: string,
    input: UpdateManagedAgentInput,
  ): Promise<ManagedAgentRecord>;
  remove(token: string, agentId: string): Promise<void>;
  reset(token: string, agentId: string): Promise<ManagedAgentRecord>;
  resetAll(token: string): Promise<ManagedAgentRecord[]>;
}

export function createAgentsClient(baseUrl: string): AgentsClient {
  return {
    async list(token: string): Promise<ManagedAgentRecord[]> {
      const response = await fetch(`${baseUrl}/agents`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error(`Failed to load agents: ${response.status}`);
      }
      const data = (await response.json()) as { agents?: ManagedAgentRecord[] };
      return data.agents ?? [];
    },

    async create(token: string, input: CreateManagedAgentInput): Promise<ManagedAgentRecord> {
      const response = await fetch(`${baseUrl}/agents`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw new Error(`Failed to create agent: ${response.status}`);
      }
      const data = (await response.json()) as { agent: ManagedAgentRecord };
      return data.agent;
    },

    async update(
      token: string,
      agentId: string,
      input: UpdateManagedAgentInput,
    ): Promise<ManagedAgentRecord> {
      const response = await fetch(`${baseUrl}/agents/${encodeURIComponent(agentId)}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw new Error(`Failed to update agent: ${response.status}`);
      }
      const data = (await response.json()) as { agent: ManagedAgentRecord };
      return data.agent;
    },

    async remove(token: string, agentId: string): Promise<void> {
      const response = await fetch(`${baseUrl}/agents/${encodeURIComponent(agentId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok && response.status !== 204) {
        throw new Error(`Failed to remove agent: ${response.status}`);
      }
    },

    async reset(token: string, agentId: string): Promise<ManagedAgentRecord> {
      const response = await fetch(`${baseUrl}/agents/${encodeURIComponent(agentId)}/reset`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error(`Failed to reset agent: ${response.status}`);
      }
      const data = (await response.json()) as { agent: ManagedAgentRecord };
      return data.agent;
    },

    async resetAll(token: string): Promise<ManagedAgentRecord[]> {
      const response = await fetch(`${baseUrl}/agents/reset-all`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error(`Failed to reset all agents: ${response.status}`);
      }
      const data = (await response.json()) as { agents: ManagedAgentRecord[] };
      return data.agents;
    },
  };
}
