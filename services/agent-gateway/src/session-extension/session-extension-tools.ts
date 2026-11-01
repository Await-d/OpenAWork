/**
 * 会话级扩展管理的**动作实现**（供 `skill_manage` / `mcp_manage_servers` 的
 * `scope: 'session'` 分支复用）。
 *
 * 为什么单独一个模块：两个既有工具文件都已经很长，把「会话级」这套新语义塞进去
 * 会让守卫、权限、动作三层混在一起。这里只做动作，授权与状态机全部委托给
 * `session-extension-service.ts`（单一真相源）。
 *
 * 关键约定：**`install` / `add` / `update` 不直接生效**，只创建待确认提案。
 * 真正的写入发生在管理员确认之后（`applyApprovedSessionExtensionOperation`）。
 * 这保证「模型说装好了」永远不等于「已经装好了」。
 */

import {
  applyApprovedSessionExtensionOperation,
  decideSessionExtensionOperation,
  proposeSessionMcpUpsert,
  proposeSessionSkillInstall,
  revokeSessionMcp,
  revokeSessionSkill,
  type SessionExtensionApplyPorts,
} from './session-extension-service.js';
import { listSessionExtensionOperations } from './session-extension-operation-store.js';
import { listSessionMcpServers, listSessionSkills } from './session-extension-store.js';
import { searchSessionSkills } from './session-skill-source.js';
import { resolveSessionExtensionOrigin } from './session-extension-origin.js';
import { buildSessionExtensionConfirmationText } from './session-extension-confirmation.js';

export interface SessionScopeToolContext {
  sessionId: string;
  /** 本轮发言者（渠道群会话下用于审计与结果回传）。 */
  actorId?: string | null;
  idempotencyKey?: string | null;
  ports?: SessionExtensionApplyPorts;
}

function json(payload: Record<string, unknown>): string {
  return JSON.stringify(payload, null, 2);
}

/** 只把真正的字符串当作展示名；其他类型（对象/数组）一律视为缺失。 */
function readLabel(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/** 会话级技能：list。 */
export function listSessionScopeSkills(context: SessionScopeToolContext): string {
  const origin = resolveSessionExtensionOrigin(context.sessionId);
  const skills = listSessionSkills(context.sessionId);
  return json({
    ok: true,
    scope: 'session',
    sessionId: context.sessionId,
    managementEnabled: origin?.managementEnabled ?? false,
    count: skills.length,
    skills: skills.map((skill) => ({
      skillId: skill.skillId,
      resourceRef: skill.resourceRef,
      version: skill.version,
      enabled: skill.enabled,
      pinned: skill.pinned,
      contentDigest: skill.contentDigest,
    })),
    hint: '会话级技能只影响当前会话；其他会话与用户级安装不受影响。',
  });
}

/** 会话级技能：search。 */
export async function searchSessionScopeSkills(
  context: SessionScopeToolContext & { query?: string; limit?: number },
): Promise<string> {
  const origin = resolveSessionExtensionOrigin(context.sessionId);
  if (!origin) {
    return json({ ok: false, error: '当前会话不存在或无法解析。' });
  }
  const hits = await searchSessionSkills({
    userId: origin.ownerUserId,
    query: context.query,
    limit: context.limit,
  });
  return json({ ok: true, scope: 'session', count: hits.length, results: hits });
}

/** 会话级技能：install（创建提案，不生效）。 */
export async function proposeSessionScopeSkillInstall(
  context: SessionScopeToolContext & { skillId: string; sourceId?: string },
): Promise<string> {
  const result = await proposeSessionSkillInstall({
    sessionId: context.sessionId,
    skillId: context.skillId,
    sourceId: context.sourceId,
    idempotencyKey: context.idempotencyKey ?? undefined,
    requesterActorId: context.actorId ?? null,
  });
  if (result.kind === 'denied') {
    return json({ ok: false, scope: 'session', error: result.reason });
  }
  const preview = result.preview as Record<string, unknown>;
  const warnings = Array.isArray(preview['warnings'])
    ? preview['warnings'].filter((entry): entry is string => typeof entry === 'string')
    : [];
  return json({
    ok: true,
    scope: 'session',
    status: 'pending_approval',
    operationId: result.operation.id,
    expiresAt: result.operation.expiresAt,
    preview,
    // 渠道里直接给用户可读的回执（含确认链接 / 降级指引），模型只需原样转述。
    confirmationText: buildSessionExtensionConfirmationText({
      sessionId: context.sessionId,
      input: {
        operationId: result.operation.id,
        kind: 'skill',
        targetLabel:
          readLabel(preview['displayName']) ?? readLabel(preview['skillId']) ?? context.skillId,
        expiresAt: result.operation.expiresAt,
        warnings,
      },
    }),
    hint: '已创建待确认提案，尚未安装。需要会话所有者或其授权的管理员确认后才生效（下一轮对话可用）。',
  });
}

/** 会话级技能：uninstall / disable（撤权，立即生效，无需二次确认）。 */
export async function revokeSessionScopeSkill(
  context: SessionScopeToolContext & { resourceRef?: string; skillId?: string; remove: boolean },
): Promise<string> {
  const resourceRef =
    context.resourceRef ??
    (context.skillId
      ? listSessionSkills(context.sessionId).find((skill) => skill.skillId === context.skillId)
          ?.resourceRef
      : undefined);
  if (!resourceRef) {
    return json({ ok: false, scope: 'session', error: '未找到对应的会话级技能，请先 list。' });
  }
  const result = await revokeSessionSkill({
    sessionId: context.sessionId,
    resourceRef,
    remove: context.remove,
  });
  if (result.kind === 'denied') {
    return json({ ok: false, scope: 'session', error: result.reason });
  }
  if (result.kind === 'not_found') {
    return json({ ok: false, scope: 'session', error: '会话级技能不存在。' });
  }
  return json({
    ok: true,
    scope: 'session',
    action: context.remove ? 'remove' : 'disable',
    resourceRef,
    revision: result.revision,
  });
}

/** 会话级 MCP：list。 */
export function listSessionScopeMcp(context: SessionScopeToolContext): string {
  const origin = resolveSessionExtensionOrigin(context.sessionId);
  const servers = listSessionMcpServers(context.sessionId);
  return json({
    ok: true,
    scope: 'session',
    sessionId: context.sessionId,
    managementEnabled: origin?.managementEnabled ?? false,
    count: servers.length,
    servers: servers.map((server) => ({
      resourceRef: server.resourceRef,
      displayId: server.displayId,
      enabled: server.enabled,
      disabledToolsCount: server.disabledTools.length,
      hasSecret: server.secretRef !== null,
    })),
    hint: '仅列出本会话配置的 MCP；密钥与完整端点不回显。',
  });
}

/** 会话级 MCP：add / update（创建提案，不生效）。 */
export function proposeSessionScopeMcpUpsert(
  context: SessionScopeToolContext & {
    config: Record<string, unknown>;
    secretRef?: string | null;
  },
): string {
  const result = proposeSessionMcpUpsert({
    sessionId: context.sessionId,
    config: context.config,
    secretRef: context.secretRef ?? null,
    idempotencyKey: context.idempotencyKey ?? undefined,
    requesterActorId: context.actorId ?? null,
  });
  if (result.kind === 'denied') {
    return json({ ok: false, scope: 'session', error: result.reason });
  }
  const preview = result.preview as Record<string, unknown>;
  return json({
    ok: true,
    scope: 'session',
    status: 'pending_approval',
    operationId: result.operation.id,
    expiresAt: result.operation.expiresAt,
    preview,
    confirmationText: buildSessionExtensionConfirmationText({
      sessionId: context.sessionId,
      input: {
        operationId: result.operation.id,
        kind: 'mcp',
        targetLabel: readLabel(preview['displayId']) ?? '未命名 MCP',
        expiresAt: result.operation.expiresAt,
        warnings: [
          'MCP 会以当前会话身份连接该服务；stdio 传输会在网关宿主上启动子进程。',
          '密钥请通过设置页安全填写，勿在对话中粘贴。',
        ],
      },
    }),
    hint: '已创建待确认提案，尚未连接。请勿在对话中粘贴密钥；密钥应通过设置页安全填写。',
  });
}

/** 会话级 MCP：remove / disable（立即生效）。 */
export async function revokeSessionScopeMcp(
  context: SessionScopeToolContext & { resourceRef: string; remove: boolean },
): Promise<string> {
  const result = await revokeSessionMcp({
    sessionId: context.sessionId,
    resourceRef: context.resourceRef,
    remove: context.remove,
  });
  if (result.kind === 'denied') {
    return json({ ok: false, scope: 'session', error: result.reason });
  }
  if (result.kind === 'not_found') {
    return json({ ok: false, scope: 'session', error: '会话级 MCP 配置不存在。' });
  }
  return json({
    ok: true,
    scope: 'session',
    action: context.remove ? 'remove' : 'disable',
    resourceRef: context.resourceRef,
    revision: result.revision,
  });
}

/**
 * 管理员确认 + 执行（供 Web 确认页 / 桌面端调用，**不暴露给模型**）。
 *
 * 模型永远拿不到这个入口：渠道里的一句「同意」不构成授权，确认必须由通过鉴权
 * 的 owner / 管理员在带 ownership 校验的端点上完成。
 */
export async function confirmAndApplySessionExtensionOperation(params: {
  sessionId: string;
  operationId: string;
  approverUserId: string;
  nonce: string;
  approve: boolean;
  reason?: string;
  ports?: SessionExtensionApplyPorts;
}): Promise<Record<string, unknown>> {
  const decided = decideSessionExtensionOperation({
    sessionId: params.sessionId,
    operationId: params.operationId,
    approverUserId: params.approverUserId,
    nonce: params.nonce,
    approve: params.approve,
    reason: params.reason,
  });

  if (decided.kind !== 'approved') {
    return { ok: decided.kind === 'rejected', decision: decided.kind };
  }

  const applied = await applyApprovedSessionExtensionOperation({
    sessionId: params.sessionId,
    operationId: params.operationId,
    ports: params.ports,
  });
  return {
    ok: applied.kind === 'succeeded',
    decision: 'approved',
    applied: {
      kind: applied.kind,
      ...('operation' in applied
        ? {
            operation: {
              operationId: applied.operation.id,
              status: applied.operation.status,
              errorCode: applied.operation.errorCode,
              result: applied.operation.result,
            },
          }
        : {}),
    },
  };
}

/** 待确认提案列表（供确认页 / 会话面板）。 */
export function listPendingSessionExtensionOperations(sessionId: string): Record<string, unknown> {
  const operations = listSessionExtensionOperations({
    sessionId,
    statuses: ['pending_approval', 'approved', 'applying'],
  });
  return {
    ok: true,
    count: operations.length,
    operations: operations.map((operation) => ({
      operationId: operation.id,
      kind: operation.kind,
      action: operation.action,
      status: operation.status,
      resourceRef: operation.resourceRef,
      configDigest: operation.configDigest,
      requestedAt: operation.createdAt,
      expiresAt: operation.expiresAt,
      requesterActorId: operation.requesterActorId,
      errorMessage: operation.errorMessage,
      result: operation.result,
    })),
  };
}
