import type {
  CreateManagedAgentInput,
  ManagedAgentRecord,
  UpdateManagedAgentInput,
} from '@openAwork/shared';
import {
  extractJsonErrorMessage,
  HttpError,
  isGenericFetchErrorMessage,
  readJsonErrorData,
  type JsonErrorData,
  fetchWithTimeout,
} from '../gateway/http.js';

export interface AgentsListResult {
  agents: ManagedAgentRecord[];
  errorMessage?: string;
  ok: boolean;
  retryable: boolean;
  status?: number;
}

export interface AgentsClient {
  list(token: string): Promise<ManagedAgentRecord[]>;
  listResult(token: string): Promise<AgentsListResult>;
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

function isRetryableAgentsStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function buildAgentsListErrorMessage(
  status: number,
  data: JsonErrorData | undefined,
): string {
  const extracted = extractJsonErrorMessage(data);
  if (extracted) {
    return extracted;
  }
  if (status === 401 || status === 403) {
    return '认证失效或当前账号无权读取 Agents 列表。';
  }
  return `加载 Agents 列表失败（HTTP ${status}）。`;
}

function buildAgentsActionErrorMessage(
  actionLabel: string,
  status: number,
  data: JsonErrorData | undefined,
): string {
  const extracted = extractJsonErrorMessage(data);
  if (extracted) {
    return extracted;
  }
  if (status === 401 || status === 403) {
    return `认证失效或当前账号无权${actionLabel}。`;
  }
  if (status === 404) {
    return `目标 Agent 不存在，无法${actionLabel}。`;
  }
  if (status === 409) {
    return `当前状态不允许${actionLabel}。`;
  }
  return `${actionLabel}失败（HTTP ${status}）。`;
}

function isGenericAgentsNetworkErrorMessage(message: string): boolean {
  return isGenericFetchErrorMessage(message);
}

function normalizeAgentsActionError(actionLabel: string, error: unknown): Error {
  if (error instanceof HttpError) {
    const extracted = extractJsonErrorMessage((error.data ?? undefined) as JsonErrorData | undefined);
    if (extracted) {
      return new HttpError(extracted, error.status, error.data);
    }
    return error;
  }
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message.length > 0 && !isGenericAgentsNetworkErrorMessage(message)) {
      return error;
    }
  }
  return new Error(`网络异常，${actionLabel}失败。`);
}

async function performAgentsRequest<T>(input: {
  actionLabel: string;
  parseJson?: boolean;
  request: () => Promise<Response>;
}): Promise<T> {
  try {
    const response = await input.request();
    if (!response.ok) {
      const data = await readJsonErrorData<JsonErrorData>(response);
      throw new HttpError(
        buildAgentsActionErrorMessage(
          input.actionLabel,
          response.status,
          data,
        ),
        response.status,
        data,
      );
    }
    if (input.parseJson === false || response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  } catch (error) {
    throw normalizeAgentsActionError(input.actionLabel, error);
  }
}

export function createAgentsClient(baseUrl: string): AgentsClient {
  const listResult = async (token: string): Promise<AgentsListResult> => {
    try {
      const response = await fetchWithTimeout(`${baseUrl}/agents`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const data = await readJsonErrorData<JsonErrorData>(response);
        return {
          agents: [],
          ok: false,
          retryable: isRetryableAgentsStatus(response.status),
          errorMessage: buildAgentsListErrorMessage(response.status, data),
          status: response.status,
        };
      }
      const data = (await response.json()) as { agents?: ManagedAgentRecord[] };
      return {
        agents: data.agents ?? [],
        ok: true,
        retryable: false,
      };
    } catch (error) {
      return {
        agents: [],
        ok: false,
        retryable: true,
        errorMessage: normalizeAgentsActionError('加载 Agents 列表', error).message,
      };
    }
  };

  return {
    async list(token: string): Promise<ManagedAgentRecord[]> {
      const result = await listResult(token);
      if (!result.ok) {
        throw new Error(result.errorMessage ?? '加载 Agents 列表失败');
      }
      return result.agents;
    },

    listResult,

    async create(token: string, input: CreateManagedAgentInput): Promise<ManagedAgentRecord> {
      const data = await performAgentsRequest<{ agent: ManagedAgentRecord }>({
        actionLabel: '创建 Agent',
        request: () =>
          fetchWithTimeout(`${baseUrl}/agents`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(input),
          }),
      });
      return data.agent;
    },

    async update(
      token: string,
      agentId: string,
      input: UpdateManagedAgentInput,
    ): Promise<ManagedAgentRecord> {
      const data = await performAgentsRequest<{ agent: ManagedAgentRecord }>({
        actionLabel: '更新 Agent',
        request: () =>
          fetchWithTimeout(`${baseUrl}/agents/${encodeURIComponent(agentId)}`, {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(input),
          }),
      });
      return data.agent;
    },

    async remove(token: string, agentId: string): Promise<void> {
      await performAgentsRequest({
        actionLabel: '删除 Agent',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/agents/${encodeURIComponent(agentId)}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          }),
      });
    },

    async reset(token: string, agentId: string): Promise<ManagedAgentRecord> {
      const data = await performAgentsRequest<{ agent: ManagedAgentRecord }>({
        actionLabel: '恢复 Agent 默认配置',
        request: () =>
          fetchWithTimeout(`${baseUrl}/agents/${encodeURIComponent(agentId)}/reset`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          }),
      });
      return data.agent;
    },

    async resetAll(token: string): Promise<ManagedAgentRecord[]> {
      const data = await performAgentsRequest<{ agents: ManagedAgentRecord[] }>({
        actionLabel: '恢复全部 Agent 默认配置',
        request: () =>
          fetchWithTimeout(`${baseUrl}/agents/reset-all`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          }),
      });
      return data.agents;
    },
  };
}
