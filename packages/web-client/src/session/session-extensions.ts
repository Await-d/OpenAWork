/**
 * 会话扩展（Skill / MCP）客户端（261031）。
 *
 * 约束（与仓库既有约定一致）：`apps/**` 不得直连网关，所有请求必须经本模块。
 * 覆盖：读取会话扩展状态、切换继承策略、创建待确认提案、确认/拒绝/取消、
 * 以及所有者维护管理员清单。
 */

import { HttpError } from './sessions.js';
import { fetchWithTimeout } from '../gateway/http.js';

/** 生效范围：`session` = 只影响当前会话；`user` = 用户级（历史行为）。 */
export type SessionExtensionScope = 'session' | 'user';

/** 继承模式：`inherit` 沿用用户级配置；`explicit` 只用会话自己的条目。 */
export type SessionExtensionInheritance = 'inherit' | 'explicit';

export type SessionExtensionOperationStatus =
  | 'pending_approval'
  | 'approved'
  | 'applying'
  | 'succeeded'
  | 'configured_unavailable'
  | 'failed'
  | 'rejected'
  | 'expired'
  | 'cancelled';

export interface SessionExtensionSkillSummary {
  skillId: string;
  resourceRef: string;
  version: string | null;
  enabled: boolean;
  pinned: boolean;
  contentDigest: string;
}

export interface SessionExtensionMcpSummary {
  resourceRef: string;
  displayId: string;
  enabled: boolean;
  /** 仅表示「已配置凭据引用」；端点与密钥不回显。 */
  hasSecret: boolean;
}

export interface SessionExtensionState {
  sessionId: string;
  /** 可信来源：channel / cron / team / web / unknown。 */
  source: string;
  /** 该来源是否显式开启了会话级扩展管理（渠道默认关闭）。 */
  managementEnabled: boolean;
  inheritance: SessionExtensionInheritance;
  configured: boolean;
  revision: number;
  skills: SessionExtensionSkillSummary[];
  mcpServers: SessionExtensionMcpSummary[];
  /** 已录入的会话凭据：**只有名字与轮换时间**，永不含明文。 */
  secrets: SessionExtensionSecretMeta[];
}

export interface SessionExtensionSecretMeta {
  name: string;
  updatedAt: number;
}

export interface SessionExtensionOperationSummary {
  operationId: string;
  kind: 'skill' | 'mcp';
  action: string;
  status: SessionExtensionOperationStatus;
  resourceRef: string | null;
  configDigest: string | null;
  requestedAt: number;
  expiresAt: number;
  requesterActorId: string | null;
  errorMessage: string | null;
  result: unknown;
}

export interface SessionExtensionOperationDetail extends SessionExtensionOperationSummary {
  nonce?: string;
  expectedRevision: number | null;
  decisionAt: number | null;
  appliedAt: number | null;
  approverUserId: string | null;
  channelId: string | null;
  chatId: string | null;
  errorCode: string | null;
  /** 脱敏预览（不含 env / headers / token）。 */
  preview: Record<string, unknown>;
}

export interface SessionExtensionProposalResult {
  ok: boolean;
  scope?: SessionExtensionScope;
  status?: string;
  operationId?: string;
  expiresAt?: number;
  preview?: Record<string, unknown>;
  hint?: string;
  error?: string;
}

/**
 * 确认结果。
 *
 * `decision` 刻意用 `string` 而不是字面量联合：网关会随状态机演进新增取值，
 * 客户端遇到未知值时应**原样透传并提示**，而不是类型崩塌。
 *
 * 已知取值：`approved` | `rejected` | `forbidden` | `not_found` | `not_pending` | `expired`
 */
export interface SessionExtensionDecisionResult {
  ok: boolean;
  decision: string;
  applied?: unknown;
}

export interface SessionExtensionsClient {
  getState(token: string, sessionId: string): Promise<SessionExtensionState>;
  setInheritance(
    token: string,
    sessionId: string,
    inheritance: SessionExtensionInheritance,
    expectedRevision: number,
  ): Promise<SessionExtensionState>;
  listOperations(
    token: string,
    sessionId: string,
  ): Promise<{ ok: boolean; count: number; operations: SessionExtensionOperationSummary[] }>;
  proposeSkill(
    token: string,
    sessionId: string,
    input: { skillId: string; sourceId?: string; idempotencyKey?: string },
  ): Promise<SessionExtensionProposalResult>;
  proposeMcp(
    token: string,
    sessionId: string,
    input: { config: Record<string, unknown>; secretRef?: string; idempotencyKey?: string },
  ): Promise<SessionExtensionProposalResult>;
  getOperation(
    token: string,
    sessionId: string,
    operationId: string,
  ): Promise<{ ok: boolean; operation: SessionExtensionOperationDetail }>;
  decide(
    token: string,
    sessionId: string,
    operationId: string,
    input: { decision: 'approve' | 'reject'; nonce: string; reason?: string },
  ): Promise<SessionExtensionDecisionResult>;
  cancel(token: string, sessionId: string, operationId: string): Promise<{ ok: boolean }>;
  /**
   * 禁用 / 移除一条会话条目。
   *
   * 只提供收窄方向：重新启用等于扩权，必须重新走提案确认。
   */
  revoke(
    token: string,
    sessionId: string,
    input: { kind: 'skill' | 'mcp'; resourceRef: string; remove: boolean },
  ): Promise<SessionExtensionState>;
  /** 录入或轮换一条会话凭据；明文只在这一刻上行，响应不回显。 */
  putSecret(
    token: string,
    sessionId: string,
    name: string,
    value: string,
  ): Promise<{ ok: boolean; name: string; secrets: SessionExtensionSecretMeta[] }>;
  deleteSecret(
    token: string,
    sessionId: string,
    name: string,
  ): Promise<{ ok: boolean; name: string; secrets: SessionExtensionSecretMeta[] }>;
  listAdmins(token: string): Promise<{ ok: boolean; admins: string[] }>;
  addAdmin(token: string, adminUserId: string): Promise<{ ok: boolean; admins: string[] }>;
  removeAdmin(token: string, adminUserId: string): Promise<{ ok: boolean; admins: string[] }>;
}

/** 确认动作会触发写入 + 探活，比普通读取慢很多，单独放宽超时。 */
const DECISION_TIMEOUT_MS = 120_000;
const PROPOSAL_TIMEOUT_MS = 60_000;

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as unknown;
    if (data && typeof data === 'object') {
      const record = data as Record<string, unknown>;
      const error = record['error'];
      if (typeof error === 'string' && error.length > 0) return error;
      const message = record['message'];
      if (typeof message === 'string' && message.length > 0) return message;
    }
  } catch {
    // 非 JSON 响应：落到兜底文案。
  }
  if (res.status === 401 || res.status === 403) return '认证失效或当前账号无权限。';
  if (res.status === 404) return '会话或操作不存在。';
  if (res.status === 409) return '当前状态不允许该操作（可能已被其他端处理）。';
  if (res.status === 410) return '该确认请求已过期，请重新发起。';
  return fallback;
}

/**
 * 提案与确认的失败语义不同：
 *   - 403：来源不允许（渠道未开启 / 非管理员），需要用户去设置页处理；
 *   - 409/410：并发或过期，属于可重试或需重新发起。
 * 保留状态码，让调用方能给出准确指引，而不是统一成「操作失败」。
 */
async function requestJson<T>(input: {
  url: string;
  token: string;
  method?: string;
  body?: unknown;
  timeoutMs?: number;
  fallbackError: string;
}): Promise<T> {
  const init: RequestInit & { timeoutMs?: number } = {
    method: input.method ?? 'GET',
    headers: {
      ...authHeaders(input.token),
      ...(input.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
  };
  if (input.body !== undefined) {
    init.body = JSON.stringify(input.body);
  }
  if (input.timeoutMs !== undefined) {
    // 确认动作会触发写入 + 探活，远超默认 20s，必须单独放宽。
    init.timeoutMs = input.timeoutMs;
  }

  const res = await fetchWithTimeout(input.url, init);

  if (!res.ok) {
    const message = await readErrorMessage(res, input.fallbackError);
    throw new HttpError(message, res.status);
  }
  return (await res.json()) as T;
}

export function createSessionExtensionsClient(gatewayUrl: string): SessionExtensionsClient {
  const base = `${gatewayUrl}/sessions`;

  return {
    getState: (token, sessionId) =>
      requestJson<SessionExtensionState>({
        url: `${base}/${encodeURIComponent(sessionId)}/extensions`,
        token,
        fallbackError: '读取会话扩展状态失败。',
      }),

    setInheritance: (token, sessionId, inheritance, expectedRevision) =>
      requestJson<SessionExtensionState>({
        url: `${base}/${encodeURIComponent(sessionId)}/extensions`,
        token,
        method: 'PATCH',
        body: { inheritance, expectedRevision },
        fallbackError: '更新会话扩展策略失败。',
      }),

    listOperations: (token, sessionId) =>
      requestJson<{
        ok: boolean;
        count: number;
        operations: SessionExtensionOperationSummary[];
      }>({
        url: `${base}/${encodeURIComponent(sessionId)}/extension-operations`,
        token,
        fallbackError: '读取待确认提案失败。',
      }),

    revoke: (token, sessionId, input) =>
      requestJson<SessionExtensionState>({
        url: `${base}/${encodeURIComponent(sessionId)}/extensions/revoke`,
        token,
        method: 'POST',
        body: input,
        fallbackError: '禁用 / 移除会话条目失败。',
      }),

    putSecret: (token, sessionId, name, value) =>
      requestJson<{ ok: boolean; name: string; secrets: SessionExtensionSecretMeta[] }>({
        url: `${base}/${encodeURIComponent(sessionId)}/extension-secrets/${encodeURIComponent(name)}`,
        token,
        method: 'PUT',
        body: { value },
        fallbackError: '保存会话凭据失败。',
      }),

    deleteSecret: (token, sessionId, name) =>
      requestJson<{ ok: boolean; name: string; secrets: SessionExtensionSecretMeta[] }>({
        url: `${base}/${encodeURIComponent(sessionId)}/extension-secrets/${encodeURIComponent(name)}`,
        token,
        method: 'DELETE',
        fallbackError: '删除会话凭据失败。',
      }),

    proposeSkill: (token, sessionId, input) =>
      requestJson<SessionExtensionProposalResult>({
        url: `${base}/${encodeURIComponent(sessionId)}/extension-operations`,
        token,
        method: 'POST',
        body: { kind: 'skill', ...input },
        timeoutMs: PROPOSAL_TIMEOUT_MS,
        fallbackError: '创建技能安装提案失败。',
      }),

    proposeMcp: (token, sessionId, input) =>
      requestJson<SessionExtensionProposalResult>({
        url: `${base}/${encodeURIComponent(sessionId)}/extension-operations`,
        token,
        method: 'POST',
        body: { kind: 'mcp', ...input },
        timeoutMs: PROPOSAL_TIMEOUT_MS,
        fallbackError: '创建 MCP 配置提案失败。',
      }),

    getOperation: (token, sessionId, operationId) =>
      requestJson<{ ok: boolean; operation: SessionExtensionOperationDetail }>({
        url: `${base}/${encodeURIComponent(sessionId)}/extension-operations/${encodeURIComponent(operationId)}`,
        token,
        fallbackError: '读取操作详情失败。',
      }),

    decide: (token, sessionId, operationId, input) =>
      requestJson<SessionExtensionDecisionResult>({
        url: `${base}/${encodeURIComponent(sessionId)}/extension-operations/${encodeURIComponent(operationId)}/decision`,
        token,
        method: 'POST',
        body: input,
        timeoutMs: DECISION_TIMEOUT_MS,
        fallbackError: '确认操作失败。',
      }),

    cancel: (token, sessionId, operationId) =>
      requestJson<{ ok: boolean }>({
        url: `${base}/${encodeURIComponent(sessionId)}/extension-operations/${encodeURIComponent(operationId)}/cancel`,
        token,
        method: 'POST',
        fallbackError: '取消操作失败。',
      }),

    listAdmins: (token) =>
      requestJson<{ ok: boolean; admins: string[] }>({
        url: `${gatewayUrl}/settings/session-extension-admins`,
        token,
        fallbackError: '读取管理员清单失败。',
      }),

    addAdmin: (token, adminUserId) =>
      requestJson<{ ok: boolean; admins: string[] }>({
        url: `${gatewayUrl}/settings/session-extension-admins`,
        token,
        method: 'POST',
        body: { adminUserId },
        fallbackError: '添加管理员失败。',
      }),

    removeAdmin: (token, adminUserId) =>
      requestJson<{ ok: boolean; admins: string[] }>({
        url: `${gatewayUrl}/settings/session-extension-admins/${encodeURIComponent(adminUserId)}`,
        token,
        method: 'DELETE',
        fallbackError: '移除管理员失败。',
      }),
  };
}
