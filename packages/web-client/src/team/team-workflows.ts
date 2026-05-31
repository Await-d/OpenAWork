/**
 * 260517-team-phase-e · Team Workflows Web Client
 *
 * 封装 services/agent-gateway 的 workflow CRUD：
 *   GET    /team/workflows
 *   POST   /team/workflows
 *   PUT    /team/workflows/:workflowDbId
 *   DELETE /team/workflows/:workflowDbId
 *
 * 注意：
 *   - 内置 workflow（source='builtin'）的 _dbId 为 null，不可 PUT/DELETE
 *   - 自定义 workflow 的 _dbId 不为 null
 *   - workflow body 必须满足 teamWorkflowSchema（前后端字段对齐）
 */

import {
  fetchWithTimeout,
  extractJsonErrorMessage,
  HttpError,
  isGenericFetchErrorMessage,
  jsonAuthHeaders,
  readJsonErrorData,
  type JsonErrorData,
} from '../gateway/http.js';

export type WorkflowRoleLayer = 'reception' | 'pm1' | 'pm2' | 'executor' | 'reviewer';

export type WorkflowGate = 'constitution-check' | 'spec-review' | 'quality-review';

export type WorkflowSource = 'builtin' | 'custom' | 'forked';

export interface WorkflowStep {
  id: string;
  roleLayer: WorkflowRoleLayer;
  label: string;
  promptTemplate: string;
  toolsets: string[];
  handoffTargets: string[];
  parallel: boolean;
  minInstances: number;
  maxInstances: number;
  gates: WorkflowGate[];
  terminal: boolean;
}

export interface TeamWorkflow {
  id: string;
  name: string;
  description: string;
  version: string;
  source: WorkflowSource;
  entryStepId: string;
  steps: WorkflowStep[];
  defaultBindings: Record<string, string>;
  tags: string[];
}

/** 后端在 list 接口返回的 workflow 包含一个额外 `_dbId` 字段。 */
export interface TeamWorkflowWithDbId extends TeamWorkflow {
  /** 内置包为 null；自定义包为 workflow_templates.id。 */
  _dbId: string | null;
}

export interface CreateTeamWorkflowResponse {
  id: string;
  workflow: TeamWorkflow;
}

export type UpdateTeamWorkflowResponse = CreateTeamWorkflowResponse;

export interface TeamWorkflowsClient {
  list(token: string | null): Promise<TeamWorkflowWithDbId[]>;
  listResult(token: string | null): Promise<TeamWorkflowsListResult>;
  create(token: string | null, workflow: TeamWorkflow): Promise<CreateTeamWorkflowResponse | null>;
  update(
    token: string | null,
    workflowDbId: string,
    workflow: TeamWorkflow,
  ): Promise<UpdateTeamWorkflowResponse | null>;
  remove(token: string | null, workflowDbId: string): Promise<boolean>;
}

export interface TeamWorkflowsListResult {
  errorMessage?: string;
  ok: boolean;
  retryable: boolean;
  status?: number;
  workflows: TeamWorkflowWithDbId[];
}

function isRetryableTeamWorkflowStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function buildTeamWorkflowListErrorMessage(
  status: number,
  data: JsonErrorData | undefined,
): string {
  const extracted = extractJsonErrorMessage(data);
  if (extracted) {
    return extracted;
  }
  if (status === 401 || status === 403) {
    return '认证失效或当前账号无权读取团队工作流。';
  }
  return `加载团队工作流失败（HTTP ${status}）。`;
}

function buildTeamWorkflowActionErrorMessage(
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
    return `目标工作流不存在，无法${actionLabel}。`;
  }
  if (status === 409) {
    return `当前状态不允许${actionLabel}。`;
  }
  return `${actionLabel}失败（HTTP ${status}）。`;
}

function isGenericTeamWorkflowNetworkErrorMessage(message: string): boolean {
  return isGenericFetchErrorMessage(message);
}

function normalizeTeamWorkflowActionError(actionLabel: string, error: unknown): Error {
  if (error instanceof HttpError) {
    const extracted = extractJsonErrorMessage(
      (error.data ?? undefined) as JsonErrorData | undefined,
    );
    if (extracted) {
      return new HttpError(extracted, error.status, error.data);
    }
    return error;
  }
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message.length > 0 && !isGenericTeamWorkflowNetworkErrorMessage(message)) {
      return error;
    }
  }
  return new Error(`网络异常，${actionLabel}失败。`);
}

async function performTeamWorkflowRequest<T>(input: {
  actionLabel: string;
  parseJson?: boolean;
  request: () => Promise<Response>;
}): Promise<T> {
  try {
    const response = await input.request();
    if (!response.ok) {
      const data = await readJsonErrorData<JsonErrorData>(response);
      throw new HttpError(
        buildTeamWorkflowActionErrorMessage(input.actionLabel, response.status, data),
        response.status,
        data,
      );
    }
    if (input.parseJson === false || response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  } catch (error) {
    throw normalizeTeamWorkflowActionError(input.actionLabel, error);
  }
}

export function createTeamWorkflowsClient(baseUrl: string): TeamWorkflowsClient {
  const trimmed = baseUrl.replace(/\/$/, '');
  const listResult = async (token: string | null): Promise<TeamWorkflowsListResult> => {
    if (!token) {
      return {
        errorMessage: '未登录，无法读取团队工作流。',
        ok: false,
        retryable: false,
        workflows: [],
      };
    }
    try {
      const response = await fetchWithTimeout(`${trimmed}/team/workflows`, {
        headers: jsonAuthHeaders(token),
      });
      if (!response.ok) {
        let data: JsonErrorData | undefined;
        try {
          data = (await response.json()) as JsonErrorData;
        } catch {
          data = undefined;
        }
        return {
          ok: false,
          retryable: isRetryableTeamWorkflowStatus(response.status),
          errorMessage: buildTeamWorkflowListErrorMessage(response.status, data),
          status: response.status,
          workflows: [],
        };
      }
      const data = (await response.json()) as { workflows?: TeamWorkflowWithDbId[] };
      return {
        ok: true,
        retryable: false,
        workflows: data.workflows ?? [],
      };
    } catch (error) {
      return {
        ok: false,
        retryable: true,
        errorMessage: normalizeTeamWorkflowActionError('加载团队工作流', error).message,
        workflows: [],
      };
    }
  };

  return {
    async list(token) {
      const result = await listResult(token);
      if (!result.ok) {
        throw new Error(result.errorMessage ?? '加载团队工作流失败');
      }
      return result.workflows;
    },

    listResult,

    async create(token, workflow) {
      if (!token) {
        throw new Error('未登录，无法创建团队工作流。');
      }
      return performTeamWorkflowRequest<CreateTeamWorkflowResponse>({
        actionLabel: '创建团队工作流',
        request: () =>
          fetchWithTimeout(`${trimmed}/team/workflows`, {
            method: 'POST',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify({ workflow }),
          }),
      });
    },

    async update(token, workflowDbId, workflow) {
      if (!token) {
        throw new Error('未登录，无法更新团队工作流。');
      }
      return performTeamWorkflowRequest<UpdateTeamWorkflowResponse>({
        actionLabel: '更新团队工作流',
        request: () =>
          fetchWithTimeout(`${trimmed}/team/workflows/${encodeURIComponent(workflowDbId)}`, {
            method: 'PUT',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify({ workflow }),
          }),
      });
    },

    async remove(token, workflowDbId) {
      if (!token) {
        throw new Error('未登录，无法删除团队工作流。');
      }
      await performTeamWorkflowRequest({
        actionLabel: '删除团队工作流',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${trimmed}/team/workflows/${encodeURIComponent(workflowDbId)}`, {
            method: 'DELETE',
            headers: jsonAuthHeaders(token),
          }),
      });
      return true;
    },
  };
}
