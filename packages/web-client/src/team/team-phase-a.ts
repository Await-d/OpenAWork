/**
 * 260515-team-phase-a · 前端 API 客户端
 *
 * 与 services/agent-gateway/src/routes/team-phase-a.ts 一一对应。
 *
 * 这个文件作为 TeamClient 的姊妹篇独立存在，方便未来 Phase B 不污染 team.ts。
 * 所有 HTTP 请求通过 `./http.js` 的统一封装（authHeader / jsonAuthHeaders /
 * HttpError）完成，与仓库其他客户端保持一致。
 */

import {
  fetchWithTimeout,
  authHeader,
  appendQueryParam,
  extractJsonErrorMessage,
  HttpError,
  isGenericFetchErrorMessage,
  jsonAuthHeaders,
  readJsonErrorData,
  type JsonErrorData,
  withQuery,
} from '../gateway/http.js';

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

export type TeamWorkspaceKnowledgeType =
  'preference' | 'fact' | 'instruction' | 'project_context' | 'learned_pattern';

export type TeamWorkspaceKnowledgeSource = 'manual' | 'auto_extracted' | 'api';
export type TeamWorkspaceKnowledgeRoleLayer = 'reception' | 'pm1' | 'pm2' | 'executor' | 'reviewer';

export interface TeamWorkspaceKnowledgeRecord {
  confidence: number;
  createdAt: string;
  enabled: boolean;
  id: string;
  key: string;
  priority: number;
  source: TeamWorkspaceKnowledgeSource;
  teamWorkspaceId: string | null;
  roleLayers: TeamWorkspaceKnowledgeRoleLayer[] | null;
  type: TeamWorkspaceKnowledgeType;
  updatedAt: string;
  value: string;
  workspaceRoot: string | null;
}

export interface UpsertTeamWorkspaceKnowledgeInput {
  confidence?: number;
  key: string;
  priority?: number;
  roleLayers?: TeamWorkspaceKnowledgeRoleLayer[] | null;
  source?: TeamWorkspaceKnowledgeSource;
  type: TeamWorkspaceKnowledgeType;
  value: string;
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
    workspaceKnowledge: boolean;
    soul: boolean;
  };
}

/** 单层能力天花板内的工具类别（含默认启用标记）。 */
export interface LayerToolsetCategory {
  id: string;
  label: string;
  description: string;
  defaultEnabled: boolean;
}

/** 某层角色的能力摘要（固定护栏 + 默认启用项）。 */
export interface LayerCapabilitySummary {
  layer: string;
  adapterDisplayName: string | null;
  agentImplKey: string | null;
  toolsetCategories: LayerToolsetCategory[];
  canHandoffTo: string[];
  canWriteArtifactPhases: string[];
  allowedBuiltinInstructions: string[];
  terminal: boolean;
}

export interface LayerCapabilitiesLoadResult {
  errorMessage?: string;
  ok: boolean;
  retryable: boolean;
  status?: number;
  layers?: LayerCapabilitySummary[];
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
  getConstitutionResult(token: string, teamWorkspaceId: string): Promise<ConstitutionLoadResult>;
  getConstitution(token: string, teamWorkspaceId: string): Promise<ConstitutionRecord>;
  putConstitution(
    token: string,
    teamWorkspaceId: string,
    input: { body: string; expectedVersion: number },
  ): Promise<ConstitutionRecord>;
  listConstitutionTemplatesResult(token: string): Promise<ConstitutionTemplatesLoadResult>;
  listConstitutionTemplates(token: string): Promise<ConstitutionTemplate[]>;

  listPersonas(token: string): Promise<AgentPersonaRecord[]>;
  getPersonaResult(
    token: string,
    roleLayer: SoulRoleLayer,
    key?: string,
  ): Promise<PersonaLoadResult>;
  getPersona(token: string, roleLayer: SoulRoleLayer, key?: string): Promise<PersonaResponse>;
  putPersona(
    token: string,
    roleLayer: SoulRoleLayer,
    input: { soulMd: string; key?: string },
  ): Promise<AgentPersonaRecord>;
  /**
   * 把某层 persona 重置为「当前最新内置默认 SOUL」（覆盖用户自定义）。
   * 返回重置后的完整 PersonaResponse（含 effective.soulMd）。
   */
  resetPersona(token: string, roleLayer: SoulRoleLayer, key?: string): Promise<PersonaResponse>;
  listDefaultSouls(token: string): Promise<DefaultSoul[]>;

  getUserMemoryResult(token: string): Promise<UserMemoryLoadResult>;
  getUserMemory(token: string): Promise<UserMemoryRecord>;
  putUserMemory(token: string, body: string): Promise<UserMemoryRecord>;
  listWorkspaceKnowledge(
    token: string,
    teamWorkspaceId: string,
    options?: {
      enabled?: boolean;
      limit?: number;
      offset?: number;
      roleLayer?: TeamWorkspaceKnowledgeRoleLayer;
      search?: string;
      type?: TeamWorkspaceKnowledgeType;
    },
  ): Promise<TeamWorkspaceKnowledgeRecord[]>;
  listWorkspaceKnowledgeResult(
    token: string,
    teamWorkspaceId: string,
    options?: {
      enabled?: boolean;
      limit?: number;
      offset?: number;
      roleLayer?: TeamWorkspaceKnowledgeRoleLayer;
      search?: string;
      type?: TeamWorkspaceKnowledgeType;
    },
  ): Promise<TeamWorkspaceKnowledgeListResult>;
  upsertWorkspaceKnowledge(
    token: string,
    teamWorkspaceId: string,
    input: UpsertTeamWorkspaceKnowledgeInput,
  ): Promise<UpsertTeamWorkspaceKnowledgeResult>;

  getForceApplyStateResult(token: string): Promise<ForceApplyStateLoadResult>;
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
  previewInstructionStackResult(
    token: string,
    options: {
      teamWorkspaceId?: string;
      roleLayer?: SoulRoleLayer;
      personaKey?: string;
      sessionId?: string;
    },
  ): Promise<InstructionStackPreviewLoadResult>;

  /** 层级角色能力摘要（固定工具护栏 + 可派发/可写产物/可调指令）。 */
  getLayerCapabilitiesResult(
    token: string,
    roleLayer?: SoulRoleLayer,
  ): Promise<LayerCapabilitiesLoadResult>;

  /** Phase C: 查询产物链 */
  listTeamArtifacts(
    token: string,
    options: { phase?: string; teamWorkspaceId?: string; sessionId?: string },
  ): Promise<
    Array<{
      content: string;
      createdAt?: string;
      id: string;
      parentArtifactId?: string | null;
      phase: string | null;
      sessionId?: string;
      teamWorkspaceId?: string | null;
      title: string;
      type?: string;
      updatedAt?: string;
      version?: number;
    }>
  >;
  listTeamArtifactsResult(
    token: string,
    options: { phase?: string; teamWorkspaceId?: string; sessionId?: string },
  ): Promise<TeamArtifactsListResult>;

  /** Converge — 评估代码库与 spec/plan/tasks 的一致性 */
  runConverge(token: string, sessionId: string): Promise<ConvergeResult>;
}

export interface TeamArtifactsListResult {
  artifacts: Array<{
    content: string;
    createdAt?: string;
    id: string;
    parentArtifactId?: string | null;
    phase: string | null;
    sessionId?: string;
    teamWorkspaceId?: string | null;
    title: string;
    type?: string;
    updatedAt?: string;
    version?: number;
  }>;
  errorMessage?: string;
  ok: boolean;
  retryable: boolean;
  status?: number;
}

export interface ConvergeDeviation {
  type:
    | 'spec_not_implemented'
    | 'plan_not_executed'
    | 'task_not_completed'
    | 'code_not_in_spec'
    | 'spec_changed_without_plan'
    | 'missing_artifact';
  severity: 'critical' | 'warning' | 'info';
  description: string;
  reference?: string;
  suggestedAction: string;
}

export interface ConvergeResult {
  deviations: ConvergeDeviation[];
  evaluatedArtifacts: string[];
  timestamp: number;
  durationMs: number;
  hasCriticalDeviations: boolean;
  report: string;
}

export interface ConstitutionLoadResult {
  constitution?: ConstitutionRecord;
  errorMessage?: string;
  ok: boolean;
  retryable: boolean;
  status?: number;
}

export interface ConstitutionTemplatesLoadResult {
  errorMessage?: string;
  ok: boolean;
  retryable: boolean;
  status?: number;
  templates: ConstitutionTemplate[];
}

export interface UserMemoryLoadResult {
  errorMessage?: string;
  memory?: UserMemoryRecord;
  ok: boolean;
  retryable: boolean;
  status?: number;
}

export interface TeamWorkspaceKnowledgeListResult {
  errorMessage?: string;
  knowledge: TeamWorkspaceKnowledgeRecord[];
  ok: boolean;
  persistedKnowledge: TeamWorkspaceKnowledgeRecord[];
  persistedKnowledgeTruncated: boolean;
  retryable: boolean;
  status?: number;
  workspace?: {
    id: string;
    name: string;
    workspaceRoot: string | null;
  };
}

export interface UpsertTeamWorkspaceKnowledgeResult {
  created: boolean;
  knowledge: TeamWorkspaceKnowledgeRecord;
}

export interface PersonaLoadResult {
  errorMessage?: string;
  ok: boolean;
  personaResponse?: PersonaResponse;
  retryable: boolean;
  status?: number;
}

export interface ForceApplyStateLoadResult {
  errorMessage?: string;
  ok: boolean;
  retryable: boolean;
  state?: ForceApplyState;
  status?: number;
}

export interface InstructionStackPreviewLoadResult {
  errorMessage?: string;
  ok: boolean;
  preview?: InstructionStackPreview;
  retryable: boolean;
  status?: number;
}

function isRetryableTeamPhaseAStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function buildTeamArtifactsErrorMessage(status: number, data: JsonErrorData | undefined): string {
  const extracted = extractJsonErrorMessage(data);
  if (extracted) {
    return extracted;
  }
  if (status === 401 || status === 403) {
    return '认证失效或当前账号无权读取团队产物链。';
  }
  if (status === 404) {
    return '目标团队产物不存在。';
  }
  return `加载团队产物失败（HTTP ${status}）。`;
}

function buildConstitutionErrorMessage(status: number, data: JsonErrorData | undefined): string {
  const extracted = extractJsonErrorMessage(data);
  if (extracted) {
    return extracted;
  }
  if (status === 401 || status === 403) {
    return '认证失效或当前账号无权读取团队宪法。';
  }
  if (status === 404) {
    return '目标团队工作区不存在，无法读取团队宪法。';
  }
  return `加载团队宪法失败（HTTP ${status}）。`;
}

function buildConstitutionTemplatesErrorMessage(
  status: number,
  data: JsonErrorData | undefined,
): string {
  const extracted = extractJsonErrorMessage(data);
  if (extracted) {
    return extracted;
  }
  if (status === 401 || status === 403) {
    return '认证失效或当前账号无权读取团队宪法模板。';
  }
  return `加载团队宪法模板失败（HTTP ${status}）。`;
}

function buildUserMemoryErrorMessage(status: number, data: JsonErrorData | undefined): string {
  const extracted = extractJsonErrorMessage(data);
  if (extracted) {
    return extracted;
  }
  if (status === 401 || status === 403) {
    return '认证失效或当前账号无权读取个人长期记忆。';
  }
  return `加载个人长期记忆失败（HTTP ${status}）。`;
}

function buildWorkspaceKnowledgeErrorMessage(
  status: number,
  data: JsonErrorData | undefined,
): string {
  const extracted = extractJsonErrorMessage(data);
  if (extracted) {
    return extracted;
  }
  if (status === 401 || status === 403) {
    return '认证失效或当前账号无权读取工作区知识。';
  }
  if (status === 404) {
    return '目标团队工作区不存在，无法读取知识库。';
  }
  return `加载工作区知识失败（HTTP ${status}）。`;
}

function extractKnowledgeKeyConflictMessage(
  data: (JsonErrorData & { error?: string; message?: string }) | undefined,
): string | null {
  if (data?.error !== 'knowledge-key-conflict') {
    return null;
  }
  return typeof data.message === 'string' && data.message.length > 0
    ? data.message
    : '该知识 key 已被其它工作区占用。';
}

function buildPersonaErrorMessage(status: number, data: JsonErrorData | undefined): string {
  const extracted = extractJsonErrorMessage(data);
  if (extracted) {
    return extracted;
  }
  if (status === 401 || status === 403) {
    return '认证失效或当前账号无权读取角色 SOUL。';
  }
  return `加载角色 SOUL 失败（HTTP ${status}）。`;
}

function buildForceApplyStateErrorMessage(status: number, data: JsonErrorData | undefined): string {
  const extracted = extractJsonErrorMessage(data);
  if (extracted) {
    return extracted;
  }
  if (status === 401 || status === 403) {
    return '认证失效或当前账号无权读取 ForceApply 状态。';
  }
  return `加载 ForceApply 状态失败（HTTP ${status}）。`;
}

function buildInstructionStackPreviewErrorMessage(
  status: number,
  data: JsonErrorData | undefined,
): string {
  const extracted = extractJsonErrorMessage(data);
  if (extracted) {
    return extracted;
  }
  if (status === 401 || status === 403) {
    return '认证失效或当前账号无权预览指令栈。';
  }
  if (status === 404) {
    return '目标工作区或角色不存在，无法生成指令栈预览。';
  }
  return `生成指令栈预览失败（HTTP ${status}）。`;
}

function buildTeamPhaseAActionErrorMessage(
  actionLabel: string,
  status: number,
  data:
    | (JsonErrorData & {
        currentVersion?: number | null;
        error?: string;
        reason?: string;
        retryHintHours?: number;
        threat?: string;
      })
    | undefined,
): string {
  const knowledgeConflictMessage = extractKnowledgeKeyConflictMessage(data);
  if (status === 409 && knowledgeConflictMessage) {
    return knowledgeConflictMessage;
  }
  if (status === 400 && (typeof data?.reason === 'string' || typeof data?.threat === 'string')) {
    return `安全扫描拒绝：${data.reason ?? data.threat ?? '未知威胁'}`;
  }
  if (status === 401 || status === 403) {
    return `认证失效或当前账号无权${actionLabel}。`;
  }
  if (status === 404) {
    return `目标资源不存在，无法${actionLabel}。`;
  }
  if (status === 409) {
    return '当前内容已发生变化，请刷新后重试。';
  }
  if (status === 429) {
    return typeof data?.retryHintHours === 'number'
      ? `${actionLabel}过于频繁，请在 ${data.retryHintHours} 小时后重试。`
      : `${actionLabel}过于频繁，请稍后重试。`;
  }
  const extracted = extractJsonErrorMessage(data);
  if (
    extracted &&
    extracted !== 'memory-write-blocked' &&
    extracted !== 'rate-limited' &&
    extracted !== 'version-conflict'
  ) {
    return extracted;
  }
  return `${actionLabel}失败（HTTP ${status}）。`;
}

function isGenericTeamPhaseANetworkErrorMessage(message: string): boolean {
  return isGenericFetchErrorMessage(message);
}

function normalizeTeamPhaseAActionError(actionLabel: string, error: unknown): Error {
  if (error instanceof HttpError) {
    const data = (error.data ?? undefined) as
      (JsonErrorData & { error?: string; message?: string }) | undefined;
    const knowledgeConflictMessage = extractKnowledgeKeyConflictMessage(data);
    if (knowledgeConflictMessage) {
      return new HttpError(knowledgeConflictMessage, error.status, error.data);
    }
    const extracted = extractJsonErrorMessage(data);
    if (
      extracted &&
      extracted !== 'memory-write-blocked' &&
      extracted !== 'rate-limited' &&
      extracted !== 'version-conflict'
    ) {
      return new HttpError(extracted, error.status, error.data);
    }
    return error;
  }
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message.length > 0 && !isGenericTeamPhaseANetworkErrorMessage(message)) {
      return error;
    }
  }
  return new Error(`网络异常，${actionLabel}失败。`);
}

async function performTeamPhaseARequest<T>(input: {
  actionLabel: string;
  parseJson?: boolean;
  request: () => Promise<Response>;
}): Promise<T> {
  try {
    const response = await input.request();
    if (!response.ok) {
      const data = await readJsonErrorData<{
        currentVersion?: number | null;
        error?: string;
        reason?: string;
        retryHintHours?: number;
        threat?: string;
        message?: string;
        data?: { message?: string };
      }>(response);
      throw new HttpError(
        buildTeamPhaseAActionErrorMessage(input.actionLabel, response.status, data),
        response.status,
        data,
      );
    }
    if (input.parseJson === false || response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  } catch (error) {
    throw normalizeTeamPhaseAActionError(input.actionLabel, error);
  }
}

export function createTeamPhaseAClient(baseUrl: string): TeamPhaseAClient {
  const getConstitutionResult = async (
    token: string,
    teamWorkspaceId: string,
  ): Promise<ConstitutionLoadResult> => {
    try {
      const response = await fetchWithTimeout(
        `${baseUrl}/team/workspaces/${encodeURIComponent(teamWorkspaceId)}/constitution`,
        { headers: authHeader(token) },
      );
      if (!response.ok) {
        const data = await readJsonErrorData<JsonErrorData>(response);
        return {
          ok: false,
          retryable: isRetryableTeamPhaseAStatus(response.status),
          errorMessage: buildConstitutionErrorMessage(response.status, data),
          status: response.status,
        };
      }
      return {
        constitution: (await response.json()) as ConstitutionRecord,
        ok: true,
        retryable: false,
      };
    } catch (error) {
      return {
        ok: false,
        retryable: true,
        errorMessage: normalizeTeamPhaseAActionError('加载团队宪法', error).message,
      };
    }
  };

  const listConstitutionTemplatesResult = async (
    token: string,
  ): Promise<ConstitutionTemplatesLoadResult> => {
    try {
      const response = await fetchWithTimeout(`${baseUrl}/team/constitution-templates`, {
        headers: authHeader(token),
      });
      if (!response.ok) {
        const data = await readJsonErrorData<JsonErrorData>(response);
        return {
          ok: false,
          retryable: isRetryableTeamPhaseAStatus(response.status),
          errorMessage: buildConstitutionTemplatesErrorMessage(response.status, data),
          status: response.status,
          templates: [],
        };
      }
      const data = (await response.json()) as { templates: ConstitutionTemplate[] };
      return {
        ok: true,
        retryable: false,
        templates: data.templates,
      };
    } catch (error) {
      return {
        ok: false,
        retryable: true,
        errorMessage: normalizeTeamPhaseAActionError('加载团队宪法模板', error).message,
        templates: [],
      };
    }
  };

  const getUserMemoryResult = async (token: string): Promise<UserMemoryLoadResult> => {
    try {
      const response = await fetchWithTimeout(`${baseUrl}/team/user-memory`, {
        headers: authHeader(token),
      });
      if (!response.ok) {
        const data = await readJsonErrorData<JsonErrorData>(response);
        return {
          ok: false,
          retryable: isRetryableTeamPhaseAStatus(response.status),
          errorMessage: buildUserMemoryErrorMessage(response.status, data),
          status: response.status,
        };
      }
      return {
        memory: (await response.json()) as UserMemoryRecord,
        ok: true,
        retryable: false,
      };
    } catch (error) {
      return {
        ok: false,
        retryable: true,
        errorMessage: normalizeTeamPhaseAActionError('加载个人长期记忆', error).message,
      };
    }
  };

  const listWorkspaceKnowledgeResult = async (
    token: string,
    teamWorkspaceId: string,
    options: {
      enabled?: boolean;
      limit?: number;
      offset?: number;
      roleLayer?: TeamWorkspaceKnowledgeRoleLayer;
      search?: string;
      type?: TeamWorkspaceKnowledgeType;
    } = {},
  ): Promise<TeamWorkspaceKnowledgeListResult> => {
    const params = new URLSearchParams();
    appendQueryParam(params, 'enabled', options.enabled);
    appendQueryParam(params, 'limit', options.limit);
    appendQueryParam(params, 'offset', options.offset);
    appendQueryParam(params, 'roleLayer', options.roleLayer);
    appendQueryParam(params, 'search', options.search);
    appendQueryParam(params, 'type', options.type);
    const url = withQuery(
      `${baseUrl}/team/workspaces/${encodeURIComponent(teamWorkspaceId)}/knowledge`,
      params,
    );
    try {
      const response = await fetchWithTimeout(url, { headers: authHeader(token) });
      if (!response.ok) {
        const data = await readJsonErrorData<JsonErrorData>(response);
        return {
          knowledge: [],
          ok: false,
          persistedKnowledge: [],
          persistedKnowledgeTruncated: false,
          retryable: isRetryableTeamPhaseAStatus(response.status),
          errorMessage: buildWorkspaceKnowledgeErrorMessage(response.status, data),
          status: response.status,
        };
      }
      const data = (await response.json()) as {
        knowledge: TeamWorkspaceKnowledgeRecord[];
        persistedKnowledge?: TeamWorkspaceKnowledgeRecord[];
        persistedKnowledgeTruncated?: boolean;
        workspace?: {
          id: string;
          name: string;
          workspaceRoot: string | null;
        };
      };
      return {
        knowledge: data.knowledge,
        ok: true,
        persistedKnowledge: data.persistedKnowledge ?? data.knowledge,
        persistedKnowledgeTruncated: data.persistedKnowledgeTruncated ?? false,
        retryable: false,
        workspace: data.workspace,
      };
    } catch (error) {
      return {
        knowledge: [],
        ok: false,
        persistedKnowledge: [],
        persistedKnowledgeTruncated: false,
        retryable: true,
        errorMessage: normalizeTeamPhaseAActionError('加载工作区知识', error).message,
      };
    }
  };

  const getPersonaResult = async (
    token: string,
    roleLayer: SoulRoleLayer,
    key = 'default',
  ): Promise<PersonaLoadResult> => {
    const params = new URLSearchParams();
    appendQueryParam(params, 'key', key);
    const url = withQuery(`${baseUrl}/team/personas/${encodeURIComponent(roleLayer)}`, params);
    try {
      const response = await fetchWithTimeout(url, { headers: authHeader(token) });
      if (!response.ok) {
        const data = await readJsonErrorData<JsonErrorData>(response);
        return {
          ok: false,
          retryable: isRetryableTeamPhaseAStatus(response.status),
          errorMessage: buildPersonaErrorMessage(response.status, data),
          status: response.status,
        };
      }
      return {
        ok: true,
        retryable: false,
        personaResponse: (await response.json()) as PersonaResponse,
      };
    } catch (error) {
      return {
        ok: false,
        retryable: true,
        errorMessage: normalizeTeamPhaseAActionError('加载角色 SOUL', error).message,
      };
    }
  };

  const getForceApplyStateResult = async (token: string): Promise<ForceApplyStateLoadResult> => {
    try {
      const response = await fetchWithTimeout(`${baseUrl}/team/force-apply/state`, {
        headers: authHeader(token),
      });
      if (!response.ok) {
        const data = await readJsonErrorData<JsonErrorData>(response);
        return {
          ok: false,
          retryable: isRetryableTeamPhaseAStatus(response.status),
          errorMessage: buildForceApplyStateErrorMessage(response.status, data),
          status: response.status,
        };
      }
      return {
        ok: true,
        retryable: false,
        state: (await response.json()) as ForceApplyState,
      };
    } catch (error) {
      return {
        ok: false,
        retryable: true,
        errorMessage: normalizeTeamPhaseAActionError('加载 ForceApply 状态', error).message,
      };
    }
  };

  const previewInstructionStackResult = async (
    token: string,
    options: {
      teamWorkspaceId?: string;
      roleLayer?: SoulRoleLayer;
      personaKey?: string;
      sessionId?: string;
    },
  ): Promise<InstructionStackPreviewLoadResult> => {
    const params = new URLSearchParams();
    appendQueryParam(params, 'teamWorkspaceId', options.teamWorkspaceId);
    appendQueryParam(params, 'roleLayer', options.roleLayer);
    appendQueryParam(params, 'personaKey', options.personaKey);
    appendQueryParam(params, 'sessionId', options.sessionId);
    const url = withQuery(`${baseUrl}/team/instruction-stack/preview`, params);
    try {
      const response = await fetchWithTimeout(url, { headers: authHeader(token) });
      if (!response.ok) {
        const data = await readJsonErrorData<JsonErrorData>(response);
        return {
          ok: false,
          retryable: isRetryableTeamPhaseAStatus(response.status),
          errorMessage: buildInstructionStackPreviewErrorMessage(response.status, data),
          status: response.status,
        };
      }
      return {
        ok: true,
        retryable: false,
        preview: (await response.json()) as InstructionStackPreview,
      };
    } catch (error) {
      return {
        ok: false,
        retryable: true,
        errorMessage: normalizeTeamPhaseAActionError('生成指令栈预览', error).message,
      };
    }
  };

  const getLayerCapabilitiesResult = async (
    token: string,
    roleLayer?: SoulRoleLayer,
  ): Promise<LayerCapabilitiesLoadResult> => {
    const params = new URLSearchParams();
    appendQueryParam(params, 'layer', roleLayer);
    const url = withQuery(`${baseUrl}/team/layer-capabilities`, params);
    try {
      const response = await fetchWithTimeout(url, { headers: authHeader(token) });
      if (!response.ok) {
        const data = await readJsonErrorData<JsonErrorData>(response);
        return {
          ok: false,
          retryable: isRetryableTeamPhaseAStatus(response.status),
          errorMessage: data?.error ?? `加载层级能力失败（HTTP ${response.status}）。`,
          status: response.status,
        };
      }
      const payload = (await response.json()) as { layers: LayerCapabilitySummary[] };
      return { ok: true, retryable: false, layers: payload.layers };
    } catch (error) {
      return {
        ok: false,
        retryable: true,
        errorMessage: normalizeTeamPhaseAActionError('加载层级能力', error).message,
      };
    }
  };

  const listTeamArtifactsResult = async (
    token: string,
    options: { phase?: string; teamWorkspaceId?: string; sessionId?: string },
  ): Promise<TeamArtifactsListResult> => {
    const params = new URLSearchParams();
    appendQueryParam(params, 'phase', options.phase);
    appendQueryParam(params, 'teamWorkspaceId', options.teamWorkspaceId);
    appendQueryParam(params, 'sessionId', options.sessionId);
    const url = withQuery(`${baseUrl}/team/artifacts`, params);
    try {
      const response = await fetchWithTimeout(url, { headers: authHeader(token) });
      if (!response.ok) {
        const data = await readJsonErrorData<JsonErrorData>(response);
        return {
          artifacts: [],
          ok: false,
          retryable: isRetryableTeamPhaseAStatus(response.status),
          errorMessage: buildTeamArtifactsErrorMessage(response.status, data),
          status: response.status,
        };
      }
      const data = (await response.json()) as {
        artifacts: Array<{
          content: string;
          createdAt?: string;
          id: string;
          parentArtifactId?: string | null;
          phase: string | null;
          sessionId?: string;
          teamWorkspaceId?: string | null;
          title: string;
          type?: string;
          updatedAt?: string;
          version?: number;
        }>;
      };
      return {
        artifacts: data.artifacts,
        ok: true,
        retryable: false,
      };
    } catch (error) {
      return {
        artifacts: [],
        ok: false,
        retryable: true,
        errorMessage: normalizeTeamPhaseAActionError('加载团队产物', error).message,
      };
    }
  };

  return {
    getConstitutionResult,

    async getConstitution(token, teamWorkspaceId) {
      const result = await getConstitutionResult(token, teamWorkspaceId);
      if (!result.ok || !result.constitution) {
        throw new Error(result.errorMessage ?? '加载团队宪法失败');
      }
      return result.constitution;
    },

    async putConstitution(token, teamWorkspaceId, input) {
      return performTeamPhaseARequest<ConstitutionRecord>({
        actionLabel: '保存团队宪法',
        request: () =>
          fetchWithTimeout(
            `${baseUrl}/team/workspaces/${encodeURIComponent(teamWorkspaceId)}/constitution`,
            {
              method: 'PUT',
              headers: jsonAuthHeaders(token),
              body: JSON.stringify(input),
            },
          ),
      });
    },

    listConstitutionTemplatesResult,

    async listConstitutionTemplates(token) {
      const result = await listConstitutionTemplatesResult(token);
      if (!result.ok) {
        throw new Error(result.errorMessage ?? '加载团队宪法模板失败');
      }
      return result.templates;
    },

    async listPersonas(token) {
      const data = await performTeamPhaseARequest<{ personas: AgentPersonaRecord[] }>({
        actionLabel: '读取角色 SOUL 列表',
        request: () =>
          fetchWithTimeout(`${baseUrl}/team/personas`, {
            headers: authHeader(token),
          }),
      });
      return data.personas;
    },

    getPersonaResult,

    async getPersona(token, roleLayer, key = 'default') {
      const result = await getPersonaResult(token, roleLayer, key);
      if (!result.ok || !result.personaResponse) {
        throw new Error(result.errorMessage ?? '加载角色 SOUL 失败');
      }
      return result.personaResponse;
    },

    async putPersona(token, roleLayer, input) {
      const data = await performTeamPhaseARequest<{ persona: AgentPersonaRecord }>({
        actionLabel: '保存角色 SOUL',
        request: () =>
          fetchWithTimeout(`${baseUrl}/team/personas/${encodeURIComponent(roleLayer)}`, {
            method: 'PUT',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(input),
          }),
      });
      return data.persona;
    },

    async resetPersona(token, roleLayer, key = 'default') {
      const params = new URLSearchParams();
      appendQueryParam(params, 'key', key);
      const url = withQuery(
        `${baseUrl}/team/personas/${encodeURIComponent(roleLayer)}/reset`,
        params,
      );
      return performTeamPhaseARequest<PersonaResponse>({
        actionLabel: '恢复角色 SOUL 默认',
        request: () =>
          fetchWithTimeout(url, {
            method: 'POST',
            headers: authHeader(token),
          }),
      });
    },

    async listDefaultSouls(token) {
      const data = await performTeamPhaseARequest<{ souls: DefaultSoul[] }>({
        actionLabel: '读取默认 SOUL',
        request: () =>
          fetchWithTimeout(`${baseUrl}/team/soul-defaults`, {
            headers: authHeader(token),
          }),
      });
      return data.souls;
    },

    getUserMemoryResult,

    async getUserMemory(token) {
      const result = await getUserMemoryResult(token);
      if (!result.ok || !result.memory) {
        throw new Error(result.errorMessage ?? '加载个人长期记忆失败');
      }
      return result.memory;
    },

    async putUserMemory(token, body) {
      return performTeamPhaseARequest<UserMemoryRecord>({
        actionLabel: '保存个人长期记忆',
        request: () =>
          fetchWithTimeout(`${baseUrl}/team/user-memory`, {
            method: 'PUT',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify({ body }),
          }),
      });
    },

    listWorkspaceKnowledgeResult,

    async listWorkspaceKnowledge(token, teamWorkspaceId, options) {
      const result = await listWorkspaceKnowledgeResult(token, teamWorkspaceId, options);
      if (!result.ok) {
        throw new Error(result.errorMessage ?? '加载工作区知识失败');
      }
      return result.knowledge;
    },

    async upsertWorkspaceKnowledge(token, teamWorkspaceId, input) {
      return performTeamPhaseARequest<UpsertTeamWorkspaceKnowledgeResult>({
        actionLabel: '入库工作区知识',
        request: () =>
          fetchWithTimeout(
            `${baseUrl}/team/workspaces/${encodeURIComponent(teamWorkspaceId)}/knowledge`,
            {
              method: 'POST',
              headers: jsonAuthHeaders(token),
              body: JSON.stringify(input),
            },
          ),
      });
    },

    getForceApplyStateResult,

    async getForceApplyState(token) {
      const result = await getForceApplyStateResult(token);
      if (!result.ok || !result.state) {
        throw new Error(result.errorMessage ?? '加载 ForceApply 状态失败');
      }
      return result.state;
    },

    async forceApply(token) {
      return performTeamPhaseARequest<{ ok: true; state: ForceApplyState }>({
        actionLabel: '触发 ForceApply',
        request: () =>
          fetchWithTimeout(`${baseUrl}/team/force-apply`, {
            method: 'POST',
            headers: jsonAuthHeaders(token),
          }),
      });
    },

    previewInstructionStackResult,

    async previewInstructionStack(token, options) {
      const result = await previewInstructionStackResult(token, options);
      if (!result.ok || !result.preview) {
        throw new Error(result.errorMessage ?? '生成指令栈预览失败');
      }
      return result.preview;
    },

    getLayerCapabilitiesResult,

    listTeamArtifactsResult,

    async listTeamArtifacts(token, options) {
      const result = await listTeamArtifactsResult(token, options);
      if (!result.ok) {
        throw new Error(result.errorMessage ?? '加载团队产物失败');
      }
      return result.artifacts;
    },

    async runConverge(token, sessionId) {
      return performTeamPhaseARequest<ConvergeResult>({
        actionLabel: '执行一致性评估',
        request: () =>
          fetchWithTimeout(`${baseUrl}/team/sessions/${encodeURIComponent(sessionId)}/converge`, {
            method: 'POST',
            headers: jsonAuthHeaders(token),
          }),
      });
    },
  };
}
