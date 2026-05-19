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

import { jsonAuthHeaders } from '../gateway/http.js';

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
  create(token: string | null, workflow: TeamWorkflow): Promise<CreateTeamWorkflowResponse | null>;
  update(
    token: string | null,
    workflowDbId: string,
    workflow: TeamWorkflow,
  ): Promise<UpdateTeamWorkflowResponse | null>;
  remove(token: string | null, workflowDbId: string): Promise<boolean>;
}

export function createTeamWorkflowsClient(baseUrl: string): TeamWorkflowsClient {
  const trimmed = baseUrl.replace(/\/$/, '');

  return {
    async list(token) {
      if (!token) return [];
      try {
        const response = await fetch(`${trimmed}/team/workflows`, {
          headers: jsonAuthHeaders(token),
        });
        if (!response.ok) return [];
        const data = (await response.json()) as { workflows?: TeamWorkflowWithDbId[] };
        return data.workflows ?? [];
      } catch {
        return [];
      }
    },

    async create(token, workflow) {
      if (!token) return null;
      try {
        const response = await fetch(`${trimmed}/team/workflows`, {
          method: 'POST',
          headers: jsonAuthHeaders(token),
          body: JSON.stringify({ workflow }),
        });
        if (!response.ok) return null;
        return (await response.json()) as CreateTeamWorkflowResponse;
      } catch {
        return null;
      }
    },

    async update(token, workflowDbId, workflow) {
      if (!token) return null;
      try {
        const response = await fetch(
          `${trimmed}/team/workflows/${encodeURIComponent(workflowDbId)}`,
          {
            method: 'PUT',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify({ workflow }),
          },
        );
        if (!response.ok) return null;
        return (await response.json()) as UpdateTeamWorkflowResponse;
      } catch {
        return null;
      }
    },

    async remove(token, workflowDbId) {
      if (!token) return false;
      try {
        const response = await fetch(
          `${trimmed}/team/workflows/${encodeURIComponent(workflowDbId)}`,
          {
            method: 'DELETE',
            headers: jsonAuthHeaders(token),
          },
        );
        return response.ok;
      } catch {
        return false;
      }
    },
  };
}
