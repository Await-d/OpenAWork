/**
 * `/memories/*` 客户端：用户长期记忆 CRUD + 抽取 + 全局设置。
 *
 * 用于 Settings → 记忆管理面板。响应保留 `unknown`，由调用方收敛实际形状。
 */

import {
  appendQueryParam,
  authHeader,
  extractJsonErrorMessage,
  HttpError,
  isGenericFetchErrorMessage,
  jsonAuthHeaders,
  readJsonErrorData,
  withQuery,
  type JsonErrorData,
  fetchWithTimeout,
} from '../gateway/http.js';

/** 记忆作用域类型：个人 / 项目 / 团队 / 渠道对话。 */
export type MemoryScopeType = 'user' | 'workspace' | 'team' | 'channel_chat';

export interface MemoryScope {
  type: MemoryScopeType;
  id: string;
}

/** 记忆生命周期状态。 */
export type MemoryLifecycle = 'active' | 'archived' | 'superseded';

/** 确认来源：手动确认 / 提议确认 / 未确认。 */
export type MemoryConfirmationKind = 'manual' | 'proposal' | null;

/** 记忆正式条目（与后端 `MemoryEntry` 契约对齐，旧字段保留以兼容既有调用方）。 */
export interface MemoryEntry {
  id: string;
  type: string;
  key: string;
  value: string;
  source: string;
  confidence: number;
  priority: number;
  workspaceRoot: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  scope?: MemoryScope;
  lifecycle?: MemoryLifecycle;
  revision?: number;
  confirmationKind?: MemoryConfirmationKind;
  confirmedAt?: string | null;
  changeSeq?: number;
  validUntil?: string | null;
  supersededBy?: string | null;
}

/** 提议动作类型。 */
export type MemoryProposalAction = 'create' | 'update' | 'archive' | 'restore' | 'merge' | 'rule';

/** 提议来源。 */
export type MemoryProposalOrigin =
  'auto_extract' | 'manual_extract' | 'tool' | 'team_init' | 'maintenance' | 'channel' | 'api';

export type MemoryProposalStatus =
  'pending' | 'applied' | 'rejected' | 'expired' | 'conflicted' | 'cancelled';

/** 提议载荷（按 action 取用不同字段）。 */
export interface MemoryProposalPayload {
  type?: string;
  key?: string;
  value?: string;
  priority?: number;
  confidence?: number;
  roleLayers?: string[];
  workspaceRoot?: string | null;
  teamWorkspaceId?: string | null;
  enabled?: boolean;
  name?: string;
  body?: string;
  /** `rule` 动作：目标规则的 id（规则权威在 `memory_rule_entries`，历史按它查询）。 */
  ruleId?: string;
  /** `rule` 动作：提议基线的规则版本号。 */
  ruleRevision?: number;
  /** `merge` 动作：保留条目 id。 */
  mergeIntoId?: string;
  /** 整理依据。 */
  dependencies?: Array<{ memoryId: string; revision: number }>;
}

/** 提议与既有记忆的关系。 */
export type MemoryProposalRelationKind = 'duplicate' | 'conflict' | 'supersedes';

export interface MemoryProposalRelation {
  kind: MemoryProposalRelationKind;
  memoryId: string;
  key: string;
  value: string;
}

export interface MemoryProposal {
  id: string;
  userId: string;
  action: MemoryProposalAction;
  scope: MemoryScope;
  targetMemoryId: string | null;
  expectedRevision: number | null;
  payload: MemoryProposalPayload;
  payloadDigest: string;
  reason: string;
  origin: MemoryProposalOrigin;
  confidence: number;
  status: MemoryProposalStatus;
  createdAt: string;
  expiresAt: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  resultMemoryId: string | null;
  revision: number | null;
  relations?: MemoryProposalRelation[];
}

export type MemoryRevisionOperation =
  'create' | 'update' | 'archive' | 'restore' | 'merge' | 'rollback' | 'rule';

export type MemoryRevisionOrigin = 'manual' | 'periodic' | 'proposal' | 'channel';

export interface MemoryRevisionRecord {
  id: string;
  memoryId: string;
  revision: number;
  operation: MemoryRevisionOperation;
  origin: MemoryRevisionOrigin;
  actorId: string | null;
  createdAt: string;
  changeSeq?: number;
  before: MemoryEntry | null;
  after: MemoryEntry | null;
  /** 实际回滚目标：恢复变更前状态；null 表示撤销创建并停用记忆。 */
  payload: MemoryEntry | null;
}

export interface ListProposalsQuery {
  status?: string;
  limit?: number;
  offset?: number;
}

export interface DecideProposalInput {
  decision: 'approve' | 'reject';
  payload?: MemoryProposalPayload;
  note?: string;
  expectedRevision?: number;
  keepOriginal?: boolean;
}

export interface DecideProposalResult {
  ok: boolean;
  memory?: MemoryEntry;
}

export interface ListRevisionsQuery {
  memoryId: string;
  limit?: number;
}

export interface RollbackRevisionResult {
  ok: boolean;
  memory?: MemoryEntry;
}

/** `PUT /memories/:id` 入参（新增可选 `expectedRevision` 用于乐观并发控制）。 */
export interface UpdateMemoryInput {
  type?: string;
  key?: string;
  value?: string;
  priority?: number;
  confidence?: number;
  enabled?: boolean;
  workspaceRoot?: string | null;
  expectedRevision?: number;
}

export interface MemoryRuleEntry {
  id: string;
  userId: string;
  scope: MemoryScope;
  name: string;
  body: string;
  revision: number;
  enabled: boolean;
  confirmedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ListMemoryRulesQuery {
  scopeType?: MemoryScopeType;
  scopeId?: string;
}

export interface ProposeMemoryRuleInput {
  scope: MemoryScope;
  name: string;
  body: string;
  expectedRevision?: number;
}

export interface ProposeMemoryRuleResult {
  status: 'pending_confirmation';
  proposalId: string;
  message: string;
  scope: MemoryScope;
}

export interface MemoriesClient {
  listRules(token: string, query?: ListMemoryRulesQuery): Promise<MemoryRuleEntry[]>;
  proposeRule(token: string, input: ProposeMemoryRuleInput): Promise<ProposeMemoryRuleResult>;
  disableRule(token: string, ruleId: string): Promise<{ ok: boolean; enabled: false }>;
  deleteRule(token: string, ruleId: string): Promise<{ ok: boolean }>;
  list(token: string, options?: { signal?: AbortSignal }): Promise<unknown>;
  getStats(token: string, options?: { signal?: AbortSignal }): Promise<unknown>;
  getSettings(token: string, options?: { signal?: AbortSignal }): Promise<unknown>;
  putSettings(token: string, payload: unknown): Promise<unknown>;
  create(token: string, payload: unknown): Promise<unknown>;
  update(token: string, memoryId: string, payload: unknown): Promise<unknown>;
  remove(token: string, memoryId: string, options?: { expectedRevision?: number }): Promise<void>;
  extract(token: string, payload: unknown): Promise<unknown>;
  /** 列出待确认/已决策的记忆提议。 */
  listProposals(token: string, query?: ListProposalsQuery): Promise<MemoryProposal[]>;
  /** 读取单条提议及其与既有记忆的关系。 */
  getProposal(
    token: string,
    proposalId: string,
  ): Promise<{ proposal: MemoryProposal; relations: MemoryProposalRelation[] }>;
  /** 对提议做出接受/拒绝决策。 */
  decideProposal(
    token: string,
    proposalId: string,
    decision: DecideProposalInput,
  ): Promise<DecideProposalResult>;
  /** 待确认提议数量（用于角标）。 */
  countPendingProposals(token: string): Promise<number>;
  /** 某条记忆的历史版本列表。 */
  listRevisions(token: string, query: ListRevisionsQuery): Promise<MemoryRevisionRecord[]>;
  /** 回滚到指定历史版本。 */
  rollbackRevision(token: string, revisionId: string): Promise<RollbackRevisionResult>;
}

function buildMemoriesActionErrorMessage(
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
    return `目标记忆资源不存在，无法${actionLabel}。`;
  }
  if (status === 409) {
    return `当前状态不允许${actionLabel}。`;
  }
  return `${actionLabel}失败（HTTP ${status}）。`;
}

function isGenericMemoriesNetworkErrorMessage(message: string): boolean {
  return isGenericFetchErrorMessage(message);
}

/** 提议/回滚类动作的失败文案：后端有 `code` 时优先用 code 映射，便于 UI 区分 403/409/410。 */
function buildProposalActionErrorMessage(
  actionLabel: string,
  status: number,
  data: JsonErrorData | undefined,
): string {
  const extracted = extractJsonErrorMessage(data);
  if (extracted) {
    return extracted;
  }
  switch (data?.code) {
    case 'memory_proposal_forbidden':
      return `无权${actionLabel}。`;
    case 'memory_proposal_conflict':
      return '内容已被修改，请重新查看后确认。';
    case 'memory_proposal_expired':
      return '该提议已过期，需重新发起。';
    case 'memory_proposal_not_found':
      return '该提议不存在或已被处理。';
    default:
      break;
  }
  if (status === 401) {
    return '认证失效，请重新登录。';
  }
  if (status === 403) {
    return `无权${actionLabel}。`;
  }
  if (status === 404) {
    return '目标记忆资源不存在，无法完成操作。';
  }
  if (status === 409) {
    return '内容已被修改，请重新查看后确认。';
  }
  if (status === 410) {
    return '该提议已过期，需重新发起。';
  }
  return `${actionLabel}失败（HTTP ${status}）。`;
}

/**
 * 提议动作统一执行封装：文案走 `buildProposalActionErrorMessage`（保留 code/状态码），
 * 其余与 `performMemoriesRequest` 一致（网络失败归一化）。
 */
async function performProposalRequest<T>(input: {
  actionLabel: string;
  request: () => Promise<Response>;
}): Promise<T> {
  try {
    const response = await input.request();
    if (!response.ok) {
      const data = await readJsonErrorData<JsonErrorData>(response);
      throw new HttpError(
        buildProposalActionErrorMessage(input.actionLabel, response.status, data),
        response.status,
        data,
      );
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  } catch (error) {
    throw normalizeMemoriesError(input.actionLabel, error);
  }
}

function normalizeMemoriesError(actionLabel: string, error: unknown): Error {
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
    if (message.length > 0 && !isGenericMemoriesNetworkErrorMessage(message)) {
      return error;
    }
  }
  return new Error(`网络异常，${actionLabel}失败。`);
}

async function performMemoriesRequest<T>(input: {
  actionLabel: string;
  parseJson?: boolean;
  request: () => Promise<Response>;
}): Promise<T> {
  try {
    const response = await input.request();
    if (!response.ok) {
      const data = await readJsonErrorData<JsonErrorData>(response);
      throw new HttpError(
        buildMemoriesActionErrorMessage(input.actionLabel, response.status, data),
        response.status,
        data,
      );
    }
    if (input.parseJson === false || response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  } catch (error) {
    throw normalizeMemoriesError(input.actionLabel, error);
  }
}

export function createMemoriesClient(baseUrl: string): MemoriesClient {
  return {
    async listRules(token, query) {
      const params = new URLSearchParams();
      appendQueryParam(params, 'scopeType', query?.scopeType);
      appendQueryParam(params, 'scopeId', query?.scopeId);
      const payload = await performMemoriesRequest<{ rules: MemoryRuleEntry[] }>({
        actionLabel: '读取规则列表',
        request: () =>
          fetchWithTimeout(withQuery(`${baseUrl}/memories/rules`, params), {
            headers: authHeader(token),
          }),
      });
      return payload.rules;
    },

    async proposeRule(token, input) {
      return performMemoriesRequest<ProposeMemoryRuleResult>({
        actionLabel: '提交规则提议',
        request: () =>
          fetchWithTimeout(`${baseUrl}/memories/rules`, {
            method: 'POST',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(input),
          }),
      });
    },

    async disableRule(token, ruleId) {
      return performMemoriesRequest<{ ok: boolean; enabled: false }>({
        actionLabel: '停用规则',
        request: () =>
          fetchWithTimeout(`${baseUrl}/memories/rules/${encodeURIComponent(ruleId)}/disable`, {
            method: 'POST',
            headers: authHeader(token),
          }),
      });
    },

    async deleteRule(token, ruleId) {
      return performMemoriesRequest<{ ok: boolean }>({
        actionLabel: '删除规则',
        request: () =>
          fetchWithTimeout(`${baseUrl}/memories/rules/${encodeURIComponent(ruleId)}`, {
            method: 'DELETE',
            headers: authHeader(token),
          }),
      });
    },

    async list(token, options) {
      return performMemoriesRequest<unknown>({
        actionLabel: '读取记忆列表',
        request: () =>
          fetchWithTimeout(`${baseUrl}/memories`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
    },

    async getStats(token, options) {
      return performMemoriesRequest<unknown>({
        actionLabel: '读取记忆统计',
        request: () =>
          fetchWithTimeout(`${baseUrl}/memories/stats`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
    },

    async getSettings(token, options) {
      return performMemoriesRequest<unknown>({
        actionLabel: '读取记忆设置',
        request: () =>
          fetchWithTimeout(`${baseUrl}/memories/settings`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
    },

    async putSettings(token, payload) {
      return performMemoriesRequest<unknown>({
        actionLabel: '保存记忆设置',
        request: () =>
          fetchWithTimeout(`${baseUrl}/memories/settings`, {
            method: 'PUT',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(payload),
          }),
      });
    },

    async create(token, payload) {
      return performMemoriesRequest<unknown>({
        actionLabel: '创建记忆',
        request: () =>
          fetchWithTimeout(`${baseUrl}/memories`, {
            method: 'POST',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(payload),
          }),
      });
    },

    async update(token, memoryId, payload) {
      return performMemoriesRequest<unknown>({
        actionLabel: '更新记忆',
        request: () =>
          fetchWithTimeout(`${baseUrl}/memories/${encodeURIComponent(memoryId)}`, {
            method: 'PUT',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(payload),
          }),
      });
    },

    async remove(token, memoryId, options) {
      const params = new URLSearchParams();
      appendQueryParam(params, 'expectedRevision', options?.expectedRevision);
      await performMemoriesRequest({
        actionLabel: '删除记忆',
        parseJson: false,
        request: () =>
          fetchWithTimeout(
            withQuery(`${baseUrl}/memories/${encodeURIComponent(memoryId)}`, params),
            {
              method: 'DELETE',
              headers: authHeader(token),
            },
          ),
      });
    },

    async extract(token, payload) {
      return performMemoriesRequest<unknown>({
        actionLabel: '抽取记忆',
        request: () =>
          fetchWithTimeout(`${baseUrl}/memories/extract`, {
            timeoutMs: 120_000,
            method: 'POST',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(payload),
          }),
      });
    },

    async listProposals(token, query) {
      const params = new URLSearchParams();
      appendQueryParam(params, 'status', query?.status);
      appendQueryParam(params, 'limit', query?.limit);
      appendQueryParam(params, 'offset', query?.offset);
      const payload = await performProposalRequest<{ proposals?: MemoryProposal[] }>({
        actionLabel: '读取待确认提议',
        request: () =>
          fetchWithTimeout(withQuery(`${baseUrl}/memories/proposals`, params), {
            headers: authHeader(token),
          }),
      });
      return payload.proposals ?? [];
    },

    async getProposal(token, proposalId) {
      const payload = await performProposalRequest<{
        proposal: MemoryProposal;
        relations?: MemoryProposalRelation[];
      }>({
        actionLabel: '读取记忆提议',
        request: () =>
          fetchWithTimeout(`${baseUrl}/memories/proposals/${encodeURIComponent(proposalId)}`, {
            headers: authHeader(token),
          }),
      });
      return { proposal: payload.proposal, relations: payload.relations ?? [] };
    },

    async decideProposal(token, proposalId, decision) {
      const payload = await performProposalRequest<DecideProposalResult>({
        actionLabel: '确认记忆提议',
        request: () =>
          fetchWithTimeout(
            `${baseUrl}/memories/proposals/${encodeURIComponent(proposalId)}/decision`,
            {
              method: 'POST',
              headers: jsonAuthHeaders(token),
              body: JSON.stringify(decision),
            },
          ),
      });
      return { ok: payload.ok, ...(payload.memory ? { memory: payload.memory } : {}) };
    },

    async countPendingProposals(token) {
      const payload = await performProposalRequest<{ count?: number }>({
        actionLabel: '读取待确认数量',
        request: () =>
          fetchWithTimeout(`${baseUrl}/memories/proposals/pending/count`, {
            headers: authHeader(token),
          }),
      });
      return typeof payload.count === 'number' ? payload.count : 0;
    },

    async listRevisions(token, query) {
      const params = new URLSearchParams();
      appendQueryParam(params, 'memoryId', query.memoryId);
      appendQueryParam(params, 'limit', query.limit);
      const payload = await performProposalRequest<{ revisions?: MemoryRevisionRecord[] }>({
        actionLabel: '读取记忆历史',
        request: () =>
          fetchWithTimeout(withQuery(`${baseUrl}/memories/revisions`, params), {
            headers: authHeader(token),
          }),
      });
      return payload.revisions ?? [];
    },

    async rollbackRevision(token, revisionId) {
      const payload = await performProposalRequest<RollbackRevisionResult>({
        actionLabel: '回滚记忆版本',
        request: () =>
          fetchWithTimeout(
            `${baseUrl}/memories/revisions/${encodeURIComponent(revisionId)}/rollback`,
            {
              method: 'POST',
              headers: jsonAuthHeaders(token),
            },
          ),
      });
      return { ok: payload.ok, ...(payload.memory ? { memory: payload.memory } : {}) };
    },
  };
}
