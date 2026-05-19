/**
 * 260515-team-phase-a · 前端 API 客户端
 *
 * 与 services/agent-gateway/src/routes/team-phase-a.ts 一一对应。
 *
 * 这个文件作为 TeamClient 的姊妹篇独立存在，方便未来 Phase B 不污染 team.ts。
 * 所有 HTTP 请求通过 `./http.js` 的统一封装（authHeader / jsonAuthHeaders /
 * expectJson / HttpError）完成，与仓库其他客户端保持一致。
 */

import { authHeader, appendQueryParam, expectJson, jsonAuthHeaders, withQuery } from '../gateway/http.js';

export type SoulRoleLayer = 'reception' | 'pm1' | 'pm2' | 'executor' | 'reviewer';

export interface ConstitutionRecord {
  teamWorkspaceId: string;
  body: string;
  version: number;
  updatedAt: string;
}

export interface ConstitutionTemplate {
  id: string;
  name: string;
  description: string;
  recommendedFor: string;
  body: string;
}

export interface AgentPersonaRecord {
  id: string;
  roleLayer: SoulRoleLayer;
  key: string;
  soulMd: string;
  createdAt: string;
  updatedAt: string;
}

export interface PersonaResponse {
  roleLayer: SoulRoleLayer;
  key: string;
  persona: AgentPersonaRecord | null;
  effective: { soulMd: string; isDefault: boolean };
}

export interface DefaultSoul {
  roleLayer: SoulRoleLayer;
  key: string;
  displayName: string;
  summary: string;
  soulMd: string;
}

export interface UserMemoryRecord {
  body: string;
}

export interface ForceApplyState {
  usedInWindow: number;
  maxInWindow: number;
  lastAppliedAt: string | null;
}

export interface InstructionStackPreview {
  stableBlock: string;
  estimatedTokens: number;
  oversize: boolean;
  layers: {
    agentsMd: boolean;
    architectureMd: boolean;
    constitution: boolean;
    projectMemory: boolean;
    lessonsLearned: boolean;
    userMemory: boolean;
    soul: boolean;
  };
}

export interface MemoryWriteBlocked {
  error: 'memory-write-blocked';
  field: string;
  threat: string;
  reason: string;
  sample?: string;
}

export interface VersionConflict {
  error: 'version-conflict';
  currentVersion: number | null;
}

export interface RateLimited {
  error: 'rate-limited';
  state: ForceApplyState;
  retryHintHours: number;
}

/**
 * 复用 HttpError 作为统一错误类型。
 * 前端代码应直接从 `@openAwork/web-client` 导入 `HttpError`。
 */

export interface TeamPhaseAClient {
  getConstitution(token: string, teamWorkspaceId: string): Promise<ConstitutionRecord>;
  putConstitution(
    token: string,
    teamWorkspaceId: string,
    input: { body: string; expectedVersion: number },
  ): Promise<ConstitutionRecord>;
  listConstitutionTemplates(token: string): Promise<ConstitutionTemplate[]>;

  listPersonas(token: string): Promise<AgentPersonaRecord[]>;
  getPersona(token: string, roleLayer: SoulRoleLayer, key?: string): Promise<PersonaResponse>;
  putPersona(
    token: string,
    roleLayer: SoulRoleLayer,
    input: { soulMd: string; key?: string },
  ): Promise<AgentPersonaRecord>;
  listDefaultSouls(token: string): Promise<DefaultSoul[]>;

  getUserMemory(token: string): Promise<UserMemoryRecord>;
  putUserMemory(token: string, body: string): Promise<UserMemoryRecord>;

  getForceApplyState(token: string): Promise<ForceApplyState>;
  forceApply(token: string): Promise<{ ok: true; state: ForceApplyState }>;

  previewInstructionStack(
    token: string,
    options: {
      teamWorkspaceId?: string;
      roleLayer?: SoulRoleLayer;
      personaKey?: string;
      sessionId?: string;
    },
  ): Promise<InstructionStackPreview>;

  /** Phase C: 查询产物链 */
  listTeamArtifacts(
    token: string,
    options: { phase?: string; teamWorkspaceId?: string; sessionId?: string },
  ): Promise<Array<{ id: string; content: string; phase: string | null; title: string }>>;
}

export function createTeamPhaseAClient(baseUrl: string): TeamPhaseAClient {
  return {
    async getConstitution(token, teamWorkspaceId) {
      const response = await fetch(
        `${baseUrl}/team/workspaces/${encodeURIComponent(teamWorkspaceId)}/constitution`,
        { headers: authHeader(token) },
      );
      return expectJson<ConstitutionRecord>(response, 'getConstitution');
    },

    async putConstitution(token, teamWorkspaceId, input) {
      const response = await fetch(
        `${baseUrl}/team/workspaces/${encodeURIComponent(teamWorkspaceId)}/constitution`,
        {
          method: 'PUT',
          headers: jsonAuthHeaders(token),
          body: JSON.stringify(input),
        },
      );
      return expectJson<ConstitutionRecord>(response, 'putConstitution');
    },

    async listConstitutionTemplates(token) {
      const response = await fetch(`${baseUrl}/team/constitution-templates`, {
        headers: authHeader(token),
      });
      const data = await expectJson<{ templates: ConstitutionTemplate[] }>(
        response,
        'listConstitutionTemplates',
      );
      return data.templates;
    },

    async listPersonas(token) {
      const response = await fetch(`${baseUrl}/team/personas`, {
        headers: authHeader(token),
      });
      const data = await expectJson<{ personas: AgentPersonaRecord[] }>(response, 'listPersonas');
      return data.personas;
    },

    async getPersona(token, roleLayer, key = 'default') {
      const params = new URLSearchParams();
      appendQueryParam(params, 'key', key);
      const url = withQuery(`${baseUrl}/team/personas/${encodeURIComponent(roleLayer)}`, params);
      const response = await fetch(url, { headers: authHeader(token) });
      return expectJson<PersonaResponse>(response, 'getPersona');
    },

    async putPersona(token, roleLayer, input) {
      const response = await fetch(`${baseUrl}/team/personas/${encodeURIComponent(roleLayer)}`, {
        method: 'PUT',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify(input),
      });
      const data = await expectJson<{ persona: AgentPersonaRecord }>(response, 'putPersona');
      return data.persona;
    },

    async listDefaultSouls(token) {
      const response = await fetch(`${baseUrl}/team/soul-defaults`, {
        headers: authHeader(token),
      });
      const data = await expectJson<{ souls: DefaultSoul[] }>(response, 'listDefaultSouls');
      return data.souls;
    },

    async getUserMemory(token) {
      const response = await fetch(`${baseUrl}/team/user-memory`, {
        headers: authHeader(token),
      });
      return expectJson<UserMemoryRecord>(response, 'getUserMemory');
    },

    async putUserMemory(token, body) {
      const response = await fetch(`${baseUrl}/team/user-memory`, {
        method: 'PUT',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify({ body }),
      });
      return expectJson<UserMemoryRecord>(response, 'putUserMemory');
    },

    async getForceApplyState(token) {
      const response = await fetch(`${baseUrl}/team/force-apply/state`, {
        headers: authHeader(token),
      });
      return expectJson<ForceApplyState>(response, 'getForceApplyState');
    },

    async forceApply(token) {
      const response = await fetch(`${baseUrl}/team/force-apply`, {
        method: 'POST',
        headers: jsonAuthHeaders(token),
      });
      return expectJson<{ ok: true; state: ForceApplyState }>(response, 'forceApply');
    },

    async previewInstructionStack(token, options) {
      const params = new URLSearchParams();
      appendQueryParam(params, 'teamWorkspaceId', options.teamWorkspaceId);
      appendQueryParam(params, 'roleLayer', options.roleLayer);
      appendQueryParam(params, 'personaKey', options.personaKey);
      appendQueryParam(params, 'sessionId', options.sessionId);
      const url = withQuery(`${baseUrl}/team/instruction-stack/preview`, params);
      const response = await fetch(url, { headers: authHeader(token) });
      return expectJson<InstructionStackPreview>(response, 'previewInstructionStack');
    },

    async listTeamArtifacts(token, options) {
      const params = new URLSearchParams();
      appendQueryParam(params, 'phase', options.phase);
      appendQueryParam(params, 'teamWorkspaceId', options.teamWorkspaceId);
      appendQueryParam(params, 'sessionId', options.sessionId);
      const url = withQuery(`${baseUrl}/team/artifacts`, params);
      const response = await fetch(url, { headers: authHeader(token) });
      const data = await expectJson<{
        artifacts: Array<{ id: string; content: string; phase: string | null; title: string }>;
      }>(response, 'listTeamArtifacts');
      return data.artifacts;
    },
  };
}
