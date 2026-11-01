/**
 * 会话扩展的**编排服务**：提案 → 审批 → 执行。
 *
 * 三个阶段刻意分离（方案 §渠道确认与操作状态机）：
 *   1. `propose*`   —— 校验来源与授权、取一次新鲜内容、落一条待审批操作；
 *   2. `decide*`    —— 管理员单次确认（CAS），只改操作状态，**不动配置**；
 *   3. `apply*`     —— 恢复执行：复核审批内容仍是最新、写入、探活、结算。
 *
 * 不变量：
 *   - 审批成功 ≠ 安装成功（`applying` 之后才可能 `succeeded`）；
 *   - 内容 / revision 变化必须重新审批（`isApprovedContentStillCurrent`）；
 *   - 探活失败是 `configured_unavailable`，不能报成功；
 *   - 重启不会自动重放（`failInterruptedSessionExtensionOperations`）。
 */

import {
  buildSessionResourceRef,
  SESSION_EXTENSION_MAX_RESOURCES,
} from './session-extension-contract.js';
import {
  isApprovedContentStillCurrent,
  resolveSessionExtensionProposalDecision,
  type SessionExtensionProposalDecision,
} from './session-extension-authorization.js';
import {
  resolveSessionExtensionOrigin,
  type SessionExtensionOrigin,
} from './session-extension-origin.js';
import {
  approveSessionExtensionOperation,
  createSessionExtensionOperation,
  getSessionExtensionOperation,
  markSessionExtensionOperationApplying,
  rejectSessionExtensionOperation,
  settleSessionExtensionOperation,
  type SessionExtensionOperation,
} from './session-extension-operation-store.js';
import {
  computeSessionExtensionDigest,
  ensureSessionExtensionSettings,
  isSessionExtensionApprover,
  listSessionMcpServers,
  listSessionSkills,
  readSessionExtensionRevision,
  removeSessionSkill,
  setSessionSkillFlags,
  upsertSessionMcpServer,
  upsertSessionSkill,
  removeSessionMcpServer,
  setSessionMcpEnabled,
} from './session-extension-store.js';
import { prepareSessionSkillInstall, type SessionSkillProposal } from './session-skill-source.js';
import { skillMcpPool, mcpConnectionPool } from '../skill/skill-mcp-connection-pool.js';
import { probeSessionExtensionMcpServer } from './session-extension-probe.js';
import { clearCatalogSnapshotsMatching } from '../mcp/mcp-tool-catalog.js';
import { BUILTIN_MCP_IDS } from '../mcp/builtin-mcps.js';
import { buildSessionMcpKeyMarker } from '../mcp/mcp-runtime.js';
import { logGatewayWarn } from '../infra/gateway-logger.js';
import {
  resolveSessionMcpRuntimePolicyDenial,
  sessionMcpConfigSchema,
} from './session-extension-runtime-policy.js';

/**
 * 探活注入点。
 *
 * 缺省即用真实实现（`probeSessionExtensionMcpServer`）；这个接口只为测试保留。
 * 曾经它是**必填的接线责任**，漏传会被当成「配置已保存但不可用」结算，把
 * `probe_not_configured` 这个假原因写给用户——所以现在默认值就是真的。
 */
export interface SessionExtensionApplyPorts {
  readonly probeMcpServer?: (params: {
    sessionId: string;
    displayId: string;
    ownerUserId: string;
  }) => Promise<{ ok: boolean; toolCount?: number; error?: string }>;
}

export interface ProposeSessionSkillInput {
  sessionId: string;
  skillId: string;
  sourceId?: string;
  idempotencyKey?: string;
  channelId?: string | null;
  chatId?: string | null;
  requesterActorId?: string | null;
}

export interface ProposeSessionMcpInput {
  sessionId: string;
  /** 已通过 `mcpServerConfigSchema` 校验的配置；**不含明文密钥**。 */
  config: Record<string, unknown>;
  secretRef?: string | null;
  idempotencyKey?: string;
  channelId?: string | null;
  chatId?: string | null;
  requesterActorId?: string | null;
}

export type ProposeResult =
  | { kind: 'created'; operation: SessionExtensionOperation; preview: unknown }
  | { kind: 'denied'; reason: string };

// ---------------------------------------------------------------------------
// 提案
// ---------------------------------------------------------------------------

/**
 * 建立技能安装提案。
 *
 * 这里就把内容取一次并算出 `contentDigest`——审批看到的就是将来执行的那一份。
 */
/**
 * 会话条目上限（`SESSION_EXTENSION_MAX_RESOURCES`）：防止模型在对话里无限堆积条目。
 *
 * 超限即拒绝并给出可操作的原因，而不是静默接受——条目越多，会话的扩展面板越不可
 * 维护，撤权审计也越难看清。
 */
function resolveResourceCapDenial(sessionId: string): string | null {
  const total = listSessionSkills(sessionId).length + listSessionMcpServers(sessionId).length;
  if (total < SESSION_EXTENSION_MAX_RESOURCES) return null;
  return `本会话的扩展条目已达上限（${SESSION_EXTENSION_MAX_RESOURCES}），请先移除不再使用的技能或 MCP。`;
}

export async function proposeSessionSkillInstall(
  input: ProposeSessionSkillInput,
): Promise<ProposeResult> {
  const origin = resolveSessionExtensionOrigin(input.sessionId);
  const decision = resolveSessionExtensionProposalDecision({
    origin: requireOrigin(origin),
    requestedScope: 'session',
  });
  if (!decision.allowed) {
    return { kind: 'denied', reason: decision.denialReason ?? '当前会话不允许变更扩展。' };
  }

  const owner = requireOrigin(origin);
  const resourceRef = buildSessionResourceRef('skill', input.skillId);
  // 上限检查放在**任何网络请求之前**：超限时没必要再去注册源拉 manifest。
  // 已存在的同一条目不算新增（重复 install 是更新，不该被自己的存在卡住）。
  if (!listSessionSkills(input.sessionId).some((row) => row.resourceRef === resourceRef)) {
    const capDenial = resolveResourceCapDenial(input.sessionId);
    if (capDenial) return { kind: 'denied', reason: capDenial };
  }

  const proposal = await prepareSessionSkillInstall({
    userId: owner.ownerUserId,
    skillId: input.skillId,
    sourceId: input.sourceId,
  });

  ensureSessionExtensionSettings(input.sessionId, owner.ownerUserId);
  const operation = createSessionExtensionOperation({
    sessionId: input.sessionId,
    ownerUserId: owner.ownerUserId,
    kind: 'skill',
    action: 'install',
    resourceRef: buildSessionResourceRef('skill', proposal.skillId),
    payload: {
      skillId: proposal.skillId,
      sourceId: proposal.sourceId,
      version: proposal.version,
      manifest: proposal.manifest,
      displayName: proposal.displayName,
      declaredPermissions: proposal.declaredPermissions,
      hasMcp: proposal.hasMcp,
      warnings: proposal.warnings,
    },
    configDigest: proposal.contentDigest,
    expectedRevision: readSessionExtensionRevision(input.sessionId),
    channelId: input.channelId ?? owner.channelId,
    chatId: input.chatId ?? owner.chatId,
    requesterActorId: input.requesterActorId ?? owner.actorId,
    idempotencyKey: input.idempotencyKey ?? null,
  });

  return { kind: 'created', operation, preview: buildSkillPreview(proposal) };
}

/** 建立 MCP 配置提案（新增 / 更新用同一入口，按 displayId 判定）。 */
export function proposeSessionMcpUpsert(input: ProposeSessionMcpInput): ProposeResult {
  const origin = resolveSessionExtensionOrigin(input.sessionId);
  const decision = resolveSessionExtensionProposalDecision({
    origin: requireOrigin(origin),
    requestedScope: 'session',
  });
  if (!decision.allowed) {
    return { kind: 'denied', reason: decision.denialReason ?? '当前会话不允许变更扩展。' };
  }

  const owner = requireOrigin(origin);

  // 运行时风险策略（T-10）：stdio 默认关、拒绝会话级 OAuth、secretRef 归属校验。
  const policyDenial = resolveSessionMcpRuntimePolicyDenial({
    config: input.config,
    secretRef: input.secretRef ?? null,
    sessionId: input.sessionId,
  });
  if (policyDenial) {
    return { kind: 'denied', reason: policyDenial };
  }

  // 密钥不进 payload：只保留引用与规范化配置。
  //
  // **先规范化再判定**：schema 里 `id` / `name` 都带 `.trim()`，所以「`" exa "`」这类
  // 带空白的 id 落库后就是 `exa`。如果拿**未 trim** 的原始值去做内置校验，`" open_websearch "`
  // 就不在内置清单里、顺利通过，落库后却变成 `open_websearch` 并顶替内置端点——
  // 等于给「不得替换内置端点」开了个空白后缀的后门。
  const parsedConfig = sessionMcpConfigSchema.safeParse(input.config);
  if (!parsedConfig.success)
    return {
      kind: 'denied',
      reason: '会话 MCP 配置无效或包含不支持的凭据字段，请使用无凭据端点。',
    };
  const sanitized = parsedConfig.data;
  const displayId = sanitized.id ?? sanitized.name;
  if (!displayId) {
    return { kind: 'denied', reason: 'MCP 配置缺少 id / name，无法建立提案。' };
  }

  // 规格 §3:48「模型不得替换内置端点」。
  //
  // 必须在这里拦：合并层（`mcp/builtin-mcps.ts`）只保护 `virtual` / `adapter` 两类内置，
  // 而 kind 为 `system` 的内置（含 exa.ai / grep.app 这类**远程端点**）在配置存在时会被
  // 配置**直接顶替**。也就是说，允许会话条目用内置 id 就等于允许模型把「内置工具」的
  // 端点改到任意地址，而界面上它看起来仍是那个内置工具。
  // `BUILTIN_MCP_IDS` 推出来是内置 id 的字面量联合，运行时才是数组；比较前放宽类型。
  if ((BUILTIN_MCP_IDS as readonly string[]).includes(displayId)) {
    return {
      kind: 'denied',
      reason: `「${displayId}」是内置 MCP，不能由会话条目覆盖，请换一个 id。`,
    };
  }

  // 上限检查：已存在的 displayId 是更新而非新增，不占用新名额。
  if (!listSessionMcpServers(input.sessionId).some((row) => row.displayId === displayId)) {
    const capDenial = resolveResourceCapDenial(input.sessionId);
    if (capDenial) return { kind: 'denied', reason: capDenial };
  }
  const digest = computeSessionExtensionDigest({
    config: sanitized,
    secretRef: input.secretRef ?? null,
  });

  ensureSessionExtensionSettings(input.sessionId, owner.ownerUserId);
  const operation = createSessionExtensionOperation({
    sessionId: input.sessionId,
    ownerUserId: owner.ownerUserId,
    kind: 'mcp',
    action: 'add',
    resourceRef: buildSessionResourceRef('mcp', displayId),
    payload: {
      displayId,
      config: sanitized,
      secretRef: input.secretRef ?? null,
      transport: readRequiredString(sanitized, 'transport'),
    },
    configDigest: digest,
    expectedRevision: readSessionExtensionRevision(input.sessionId),
    channelId: input.channelId ?? owner.channelId,
    chatId: input.chatId ?? owner.chatId,
    requesterActorId: input.requesterActorId ?? owner.actorId,
    idempotencyKey: input.idempotencyKey ?? null,
  });

  return {
    kind: 'created',
    operation,
    preview: buildMcpPreview(sanitized, input.secretRef ?? null),
  };
}

// ---------------------------------------------------------------------------
// 审批
// ---------------------------------------------------------------------------

export type DecideResult =
  | { kind: 'approved'; operation: SessionExtensionOperation }
  | { kind: 'rejected'; operation: SessionExtensionOperation }
  | { kind: 'forbidden'; reason: string }
  | { kind: 'invalid_nonce' }
  | { kind: 'not_found' }
  | { kind: 'not_pending'; status: string }
  | { kind: 'expired' };

/**
 * 管理员确认 / 拒绝。
 *
 * 授权是「owner 本人 ∨ 在 owner 的管理员清单内」，与渠道内的 senderId / ACL
 * 无关；渠道里的一句自然语言「同意」永远不走这里。
 */
export function decideSessionExtensionOperation(params: {
  sessionId: string;
  operationId: string;
  approverUserId: string;
  nonce: string;
  approve: boolean;
  reason?: string;
}): DecideResult {
  const operation = getSessionExtensionOperation(params.sessionId, params.operationId);
  if (!operation) return { kind: 'not_found' };

  const allowed = isSessionExtensionApprover(operation.ownerUserId, params.approverUserId);
  if (!allowed) {
    return {
      kind: 'forbidden',
      reason: '只有会话所有者或其授权的管理员可以确认该操作。',
    };
  }

  if (operation.status === 'expired') return { kind: 'expired' };
  if (operation.status !== 'pending_approval')
    return { kind: 'not_pending', status: operation.status };
  if (operation.expiresAt <= Date.now()) {
    approveSessionExtensionOperation({ ...params });
    return { kind: 'expired' };
  }
  if (operation.nonce !== params.nonce) return { kind: 'invalid_nonce' };

  if (params.approve) {
    const result = approveSessionExtensionOperation({
      sessionId: params.sessionId,
      operationId: params.operationId,
      approverUserId: params.approverUserId,
      nonce: params.nonce,
    });
    switch (result.kind) {
      case 'approved':
        return { kind: 'approved', operation: result.operation };
      case 'invalid_nonce':
        return { kind: 'invalid_nonce' };
      case 'expired':
        return { kind: 'expired' };
      case 'not_pending':
        return { kind: 'not_pending', status: result.operation.status };
      default:
        return { kind: 'not_found' };
    }
  }

  const rejected = rejectSessionExtensionOperation({
    sessionId: params.sessionId,
    operationId: params.operationId,
    approverUserId: params.approverUserId,
    nonce: params.nonce,
    reason: params.reason,
  });
  if (!rejected) {
    const current = getSessionExtensionOperation(params.sessionId, params.operationId);
    return current ? { kind: 'not_pending', status: current.status } : { kind: 'not_found' };
  }
  return { kind: 'rejected', operation: rejected };
}

// ---------------------------------------------------------------------------
// 执行
// ---------------------------------------------------------------------------

export type ApplyResult =
  | { kind: 'succeeded'; operation: SessionExtensionOperation }
  | { kind: 'configured_unavailable'; operation: SessionExtensionOperation; error: string }
  | { kind: 'failed'; operation: SessionExtensionOperation; error: string }
  | { kind: 'skipped'; reason: string; status: string }
  | { kind: 'not_found' };

/**
 * 执行一条已批准的操作。
 *
 * 复核顺序（任一不通过都必须停手）：
 *   1. 操作仍可执行（`approved`）；
 *   2. 提案内容摘要 / revision 未变化（否则视为需要重新审批）；
 *   3. 写入；
 *   4. MCP 探活（失败 ⇒ `configured_unavailable`，绝不报成功）。
 */
export async function applyApprovedSessionExtensionOperation(params: {
  sessionId: string;
  operationId: string;
  ports?: SessionExtensionApplyPorts;
}): Promise<ApplyResult> {
  const operation = getSessionExtensionOperation(params.sessionId, params.operationId);
  if (!operation) return { kind: 'not_found' };
  if (operation.status !== 'approved') {
    return { kind: 'skipped', reason: '操作不是已批准状态。', status: operation.status };
  }

  const applying = markSessionExtensionOperationApplying({
    sessionId: params.sessionId,
    operationId: params.operationId,
  });
  if (!applying) {
    return { kind: 'skipped', reason: '操作状态在并发中被改变。', status: operation.status };
  }

  const currentOrigin = resolveSessionExtensionOrigin(params.sessionId);
  const allowed =
    currentOrigin &&
    currentOrigin.ownerUserId === applying.ownerUserId &&
    resolveSessionExtensionProposalDecision({ origin: currentOrigin, requestedScope: 'session' })
      .allowed &&
    applying.approverUserId &&
    isSessionExtensionApprover(applying.ownerUserId, applying.approverUserId);
  if (!allowed)
    return settleFailure(
      applying,
      'authorization_changed',
      '当前来源、管理开关或审批资格已变化，请重新发起。',
    );
  if (applying.kind === 'mcp') {
    const payload = asRecord(applying.payload);
    const config = asRecord(payload?.['config']);
    if (
      !config ||
      !sessionMcpConfigSchema.safeParse(config).success ||
      resolveSessionMcpRuntimePolicyDenial({
        config,
        secretRef: readRequiredString(payload, 'secretRef'),
        sessionId: params.sessionId,
      })
    ) {
      return settleFailure(applying, 'runtime_policy_changed', 'MCP 当前运行策略不允许此配置。');
    }
  }
  const currentRevision = readSessionExtensionRevision(params.sessionId);
  // 摘要在执行前**重算**并与提案冻结值比对：任何对 payload 的篡改 / 损坏都会让
  // 摘要不匹配，从而拒绝执行（审批 A 不能执行 B）。
  const recomputedDigest = computeOperationPayloadDigest(applying);
  if (
    !isApprovedContentStillCurrent({
      approvedDigest: applying.configDigest,
      currentDigest: recomputedDigest,
      approvedRevision: applying.expectedRevision,
      currentRevision,
    })
  ) {
    const failed = settleSessionExtensionOperation({
      sessionId: params.sessionId,
      operationId: params.operationId,
      status: 'failed',
      errorCode: 'revision_conflict',
      errorMessage: '配置在确认后发生变化，请重新发起并确认。',
    });
    return failed
      ? { kind: 'failed', operation: failed, error: 'revision_conflict' }
      : { kind: 'skipped', reason: 'rev conflict', status: 'applying' };
  }

  if (applying.kind === 'skill') {
    return applySkillOperation(applying);
  }
  return applyMcpOperation(applying, params.ports);
}

function applySkillOperation(operation: SessionExtensionOperation): ApplyResult {
  const payload = asRecord(operation.payload);
  const skillId = readRequiredString(payload, 'skillId');
  if (!skillId) {
    return settleFailure(operation, 'invalid_payload', '提案缺少 skillId。');
  }
  const resourceRef = operation.resourceRef ?? buildSessionResourceRef('skill', skillId);

  const updated = upsertSessionSkill({
    sessionId: operation.sessionId,
    ownerUserId: operation.ownerUserId,
    resourceRef,
    skillId,
    sourceId: readRequiredString(payload, 'sourceId') ?? 'unknown',
    version: readRequiredString(payload, 'version'),
    manifest: payload?.['manifest'] ?? null,
    contentDigest: operation.configDigest ?? computeSessionExtensionDigest(payload),
    enabled: true,
    expectedRevision:
      operation.expectedRevision ?? readSessionExtensionRevision(operation.sessionId),
  });
  if (!updated) {
    return settleFailure(operation, 'revision_conflict', '写入时 revision 已变化，请重新发起。');
  }

  const settled = settleSessionExtensionOperation({
    sessionId: operation.sessionId,
    operationId: operation.id,
    status: 'succeeded',
    result: { skillId, resourceRef, effectiveFrom: 'next_turn' },
  });
  return settled
    ? { kind: 'succeeded', operation: settled }
    : { kind: 'skipped', reason: 'settle failed', status: 'applying' };
}

async function applyMcpOperation(
  operation: SessionExtensionOperation,
  ports?: SessionExtensionApplyPorts,
): Promise<ApplyResult> {
  const payload = asRecord(operation.payload);
  const displayId = readRequiredString(payload, 'displayId');
  const config = asRecord(payload?.['config']);
  if (!displayId || !config) {
    return settleFailure(operation, 'invalid_payload', '提案缺少 MCP 配置。');
  }
  const resourceRef = operation.resourceRef ?? buildSessionResourceRef('mcp', displayId);

  const updated = upsertSessionMcpServer({
    sessionId: operation.sessionId,
    ownerUserId: operation.ownerUserId,
    resourceRef,
    displayId,
    config,
    secretRef: readRequiredString(payload, 'secretRef'),
    enabled: true,
    expectedRevision:
      operation.expectedRevision ?? readSessionExtensionRevision(operation.sessionId),
  });
  if (!updated) {
    return settleFailure(operation, 'revision_conflict', '写入时 revision 已变化，请重新发起。');
  }

  // 默认就是真实探活；注入只用于测试。
  const probeMcpServer = ports?.probeMcpServer ?? probeSessionExtensionMcpServer;
  let probe: { ok: boolean; toolCount?: number; error?: string };
  try {
    probe = await probeMcpServer({
      sessionId: operation.sessionId,
      displayId,
      ownerUserId: operation.ownerUserId,
    });
  } catch (error) {
    probe = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  if (!probe.ok) {
    const settled = settleSessionExtensionOperation({
      sessionId: operation.sessionId,
      operationId: operation.id,
      status: 'configured_unavailable',
      result: { displayId, resourceRef, effectiveFrom: 'next_turn' },
      errorCode: 'probe_failed',
      errorMessage: probe.error ?? '连接失败。',
    });
    return settled
      ? { kind: 'configured_unavailable', operation: settled, error: probe.error ?? '连接失败。' }
      : { kind: 'skipped', reason: 'settle failed', status: 'applying' };
  }

  const settled = settleSessionExtensionOperation({
    sessionId: operation.sessionId,
    operationId: operation.id,
    status: 'succeeded',
    result: {
      displayId,
      resourceRef,
      toolCount: probe.toolCount ?? null,
      effectiveFrom: 'next_turn',
    },
  });
  return settled
    ? { kind: 'succeeded', operation: settled }
    : { kind: 'skipped', reason: 'settle failed', status: 'applying' };
}

function settleFailure(
  operation: SessionExtensionOperation,
  code: string,
  message: string,
): ApplyResult {
  const settled = settleSessionExtensionOperation({
    sessionId: operation.sessionId,
    operationId: operation.id,
    status: 'failed',
    errorCode: code,
    errorMessage: message,
  });
  return settled
    ? { kind: 'failed', operation: settled, error: message }
    : { kind: 'skipped', reason: 'settle failed', status: 'applying' };
}

// ---------------------------------------------------------------------------
// 安全预览（回给用户 / 审批页，绝不回显密钥）
// ---------------------------------------------------------------------------

function buildSkillPreview(proposal: SessionSkillProposal): Record<string, unknown> {
  return {
    kind: 'skill',
    skillId: proposal.skillId,
    sourceId: proposal.sourceId,
    version: proposal.version,
    displayName: proposal.displayName,
    description: proposal.description,
    declaredPermissions: proposal.declaredPermissions,
    hasMcp: proposal.hasMcp,
    requiresLocalFiles: proposal.requiresLocalFiles,
    warnings: proposal.warnings,
    scope: 'session',
    effectiveFrom: 'next_turn',
  };
}

function buildMcpPreview(
  config: Record<string, unknown>,
  secretRef: string | null,
): Record<string, unknown> {
  const transport = readRequiredString(config, 'transport');
  const url = readRequiredString(config, 'url');
  return {
    kind: 'mcp',
    displayId: readRequiredString(config, 'id') ?? readRequiredString(config, 'name'),
    transport,
    // URL 只给主机名，避免 query 里的令牌回流到会话历史。
    endpointHost: url ? resolveEndpointHost(url) : null,
    command: transport === 'stdio' ? readRequiredString(config, 'command') : null,
    hasSecret: secretRef !== null,
    scope: 'session',
    effectiveFrom: 'next_turn',
  };
}

/**
 * 从 URL 里取出可展示的端点标识：**只到主机**（含端口），路径与查询串一律不进预览。
 *
 * 两个预览（提案预览 `buildMcpPreview`、操作详情预览 `buildSafePayloadPreview`）必须
 * 用**同一个口径**——同一个字段名在两处给出不同值，用户对照两页会以为端点变了。
 */
export function resolveEndpointHost(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.host;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function requireOrigin(origin: SessionExtensionOrigin | null): SessionExtensionOrigin {
  if (!origin) {
    throw new Error('当前会话不存在或无法解析。');
  }
  return origin;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * 从操作 payload 重算摘要（执行前的一致性复核）。
 *
 * 与建立提案时的算法必须**逐字一致**，否则每次执行都会误判为「内容已变化」。
 */
function computeOperationPayloadDigest(operation: SessionExtensionOperation): string | null {
  const payload = asRecord(operation.payload);
  if (!payload) return null;
  if (operation.kind === 'skill') {
    return computeSessionExtensionDigest(payload['manifest'] ?? null);
  }
  return computeSessionExtensionDigest({
    config: payload['config'] ?? null,
    secretRef: readRequiredString(payload, 'secretRef'),
  });
}

function readRequiredString(
  record: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = record?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

// ---------------------------------------------------------------------------
// 其他动作（禁用 / 移除 / 启停）——直接写会话表，仍走来源授权
// ---------------------------------------------------------------------------

export async function invalidateSessionExtensionConnections(
  ownerUserId: string,
  sessionId: string,
): Promise<void> {
  const marker = buildSessionMcpKeyMarker({ ownerUserId, sessionId });
  clearCatalogSnapshotsMatching((key) => key.endsWith(marker));
  for (const pool of new Set([skillMcpPool, mcpConnectionPool])) {
    try {
      await pool.disconnectMatching((key) => key.endsWith(marker));
    } catch (error: unknown) {
      // 回收失败不改判撤权结果——授权屏障已经在库里生效，连接只是资源；
      // 但它必须留痕，否则「撤了但没释放」会静默存在。
      logGatewayWarn('会话扩展连接回收失败', error);
    }
  }
}

export type MutateResult =
  { kind: 'ok'; revision: number } | { kind: 'denied'; reason: string } | { kind: 'not_found' };

/**
 * 禁用 / 移除会话技能（立即生效的撤权动作，不需要管理员二次确认）。
 *
 * `async` 是因为要**等连接回收真的做完**：撤权返回即代表该会话的连接与子进程
 * 已经释放，调用方（HTTP、模型工具）可以据此断言「已经停了」，而不是「正在停」。
 */
export async function revokeSessionSkill(params: {
  sessionId: string;
  resourceRef: string;
  remove: boolean;
}): Promise<MutateResult> {
  const origin = resolveSessionExtensionOrigin(params.sessionId);
  const decision: SessionExtensionProposalDecision = resolveSessionExtensionProposalDecision({
    origin: requireOrigin(origin),
    requestedScope: 'session',
  });
  if (!decision.allowed) {
    return { kind: 'denied', reason: decision.denialReason ?? '不允许变更扩展。' };
  }
  const owner = requireOrigin(origin);
  const revision = readSessionExtensionRevision(params.sessionId);

  const updated = params.remove
    ? removeSessionSkill({
        sessionId: params.sessionId,
        ownerUserId: owner.ownerUserId,
        resourceRef: params.resourceRef,
        expectedRevision: revision,
      })
    : setSessionSkillFlags({
        sessionId: params.sessionId,
        ownerUserId: owner.ownerUserId,
        resourceRef: params.resourceRef,
        enabled: false,
        expectedRevision: revision,
      });
  if (!updated) return { kind: 'not_found' };
  await invalidateSessionExtensionConnections(owner.ownerUserId, params.sessionId);
  return { kind: 'ok', revision: updated.revision };
}

/** 禁用 / 移除会话 MCP；等待连接回收完成（语义同 {@link revokeSessionSkill}）。 */
export async function revokeSessionMcp(params: {
  sessionId: string;
  resourceRef: string;
  remove: boolean;
}): Promise<MutateResult> {
  const origin = resolveSessionExtensionOrigin(params.sessionId);
  const decision = resolveSessionExtensionProposalDecision({
    origin: requireOrigin(origin),
    requestedScope: 'session',
  });
  if (!decision.allowed) {
    return { kind: 'denied', reason: decision.denialReason ?? '不允许变更扩展。' };
  }
  const owner = requireOrigin(origin);
  const revision = readSessionExtensionRevision(params.sessionId);

  const updated = params.remove
    ? removeSessionMcpServer({
        sessionId: params.sessionId,
        ownerUserId: owner.ownerUserId,
        resourceRef: params.resourceRef,
        expectedRevision: revision,
      })
    : setSessionMcpEnabled({
        sessionId: params.sessionId,
        ownerUserId: owner.ownerUserId,
        resourceRef: params.resourceRef,
        enabled: false,
        expectedRevision: revision,
      });
  if (!updated) return { kind: 'not_found' };
  await invalidateSessionExtensionConnections(owner.ownerUserId, params.sessionId);
  return { kind: 'ok', revision: updated.revision };
}
