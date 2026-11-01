/**
 * 会话扩展路由的支撑函数。
 *
 * 路由文件只做「鉴权 + 归属校验 + 出参整形」，业务动作与脱敏预览都放在这里，
 * 便于单测与复用（Web 确认页 / 桌面端走同一批函数）。
 */

import {
  cancelSessionExtensionOperation,
  getSessionExtensionOperation,
} from './session-extension-operation-store.js';
import {
  confirmAndApplySessionExtensionOperation,
  listPendingSessionExtensionOperations,
  proposeSessionScopeMcpUpsert,
  proposeSessionScopeSkillInstall,
} from './session-extension-tools.js';
import {
  resolveEndpointHost,
  revokeSessionMcp,
  revokeSessionSkill,
  type MutateResult,
} from './session-extension-service.js';

export { proposeSessionScopeMcpUpsert, proposeSessionScopeSkillInstall };

/**
 * 禁用 / 移除一条会话扩展条目。
 *
 * 只提供**收窄**方向（disable / remove）：重新启用等于扩大会话能力，必须重新走
 * 提案 → 确认，不能由面板一键放行。这条边界与「撤权立即生效、扩权需审批」一致。
 */
export async function revokeSessionExtensionEntry(params: {
  sessionId: string;
  kind: 'skill' | 'mcp';
  resourceRef: string;
  remove: boolean;
}): Promise<MutateResult> {
  return params.kind === 'skill'
    ? await revokeSessionSkill({
        sessionId: params.sessionId,
        resourceRef: params.resourceRef,
        remove: params.remove,
      })
    : await revokeSessionMcp({
        sessionId: params.sessionId,
        resourceRef: params.resourceRef,
        remove: params.remove,
      });
}

/** 确认（并执行）一条操作；返回体同时带 `decision` 供路由判状态码。 */
export async function confirmAndApplySessionExtensionOperations(params: {
  sessionId: string;
  operationId: string;
  approverUserId: string;
  nonce: string;
  approve: boolean;
  reason?: string;
}): Promise<Record<string, unknown>> {
  // 不再注入探活端口：服务层缺省就是真实探活（`session-extension-probe`）。
  // 此前这里传一份、服务层缺省另一份，正是「漏传就静默降级成假失败」的来源。
  const result = await confirmAndApplySessionExtensionOperation(params);
  // `decideSessionExtensionOperation` 用 `kind`，这里统一成 `decision` 供路由判断。
  const decision = (result['decision'] ?? result['kind']) as string | undefined;
  return { ...result, decision };
}

export { listPendingSessionExtensionOperations };

/** 取一条操作的**安全**详情（脱敏预览 + 状态 + 结果）。 */
export function getSessionExtensionOperationDetail(
  sessionId: string,
  operationId: string,
): Record<string, unknown> | null {
  const operation = getSessionExtensionOperation(sessionId, operationId);
  if (!operation) return null;
  return {
    ok: true,
    operation: {
      operationId: operation.id,
      ...(operation.status === 'pending_approval' && operation.expiresAt > Date.now()
        ? { nonce: operation.nonce }
        : {}),
      kind: operation.kind,
      action: operation.action,
      status: operation.status,
      resourceRef: operation.resourceRef,
      configDigest: operation.configDigest,
      expectedRevision: operation.expectedRevision,
      requestedAt: operation.createdAt,
      expiresAt: operation.expiresAt,
      decisionAt: operation.decisionAt,
      appliedAt: operation.appliedAt,
      approverUserId: operation.approverUserId,
      requesterActorId: operation.requesterActorId,
      channelId: operation.channelId,
      chatId: operation.chatId,
      errorCode: operation.errorCode,
      errorMessage: operation.errorMessage,
      result: operation.result,
      preview: buildSafePayloadPreview(operation.kind, operation.payload),
    },
  };
}

/**
 * payload 预览：**只**暴露普通用户需要判断的字段。
 *
 * `env` / `headers` / `token` 等一律不出现在这里——密钥在提案阶段就已被剥离，
 * 但预览是最后一层防线，必须再显式白名单一次。
 */
function buildSafePayloadPreview(kind: string, payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  const record = payload as Record<string, unknown>;
  if (kind === 'skill') {
    return {
      skillId: record['skillId'] ?? null,
      sourceId: record['sourceId'] ?? null,
      version: record['version'] ?? null,
      displayName: record['displayName'] ?? null,
      declaredPermissions: record['declaredPermissions'] ?? [],
      hasMcp: record['hasMcp'] ?? false,
      warnings: record['warnings'] ?? [],
    };
  }
  const config = record['config'];
  const configRecord =
    config && typeof config === 'object' && !Array.isArray(config)
      ? (config as Record<string, unknown>)
      : {};
  return {
    displayId: record['displayId'] ?? null,
    transport: record['transport'] ?? configRecord['transport'] ?? null,
    command: configRecord['command'] ?? null,
    // 只给主机名：确认页要让人看清「这次请求会发到哪里」，但完整 URL 的路径与查询串
    // 属于实现细节，也可能夹带凭据（schema 已拒绝，这里再取一次 host 是纵深防御）。
    endpointHost: readEndpointHost(configRecord),
    hasSecret: typeof record['secretRef'] === 'string',
  };
}

/**
 * 从配置里取出脱敏后的主机名；取不到（无 url / 非法 URL）返回 null。
 *
 * 口径统一在 `resolveEndpointHost`：提案预览与操作详情预览必须给出**同一个值**，
 * 否则用户对照两页会以为端点变了。
 */
function readEndpointHost(config: Record<string, unknown>): string | null {
  const url = config['url'];
  if (typeof url !== 'string' || url.length === 0) return null;
  return resolveEndpointHost(url);
}

export function cancelOperationForRoute(
  sessionId: string,
  operationId: string,
): Record<string, unknown> | null {
  const cancelled = cancelSessionExtensionOperation({ sessionId, operationId });
  if (!cancelled) return null;
  return {
    operationId: cancelled.id,
    status: cancelled.status,
  };
}
