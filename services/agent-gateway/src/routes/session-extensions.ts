/**
 * 会话扩展（Skill / MCP）的 HTTP 管理路由（261031）。
 *
 * 所有路由都需要 JWT + **会话归属校验**（`sessions.user_id === jwt.sub`）；
 * 确认动作额外要求调用者是 owner 或 owner 授权的管理员。
 *
 * 设计要点（方案 §渠道确认与操作状态机）：
 *   - 提案与执行分离：`POST .../extension-operations` 只创建待确认项；
 *     写入发生在 `.../decision` 确认之后；
 *   - 确认不接受 `session` / `permanent` / `alwaysOverride` 这类普通授权参数——
 *     一次确认只对**这一条操作**有效（状态机层已是单次消费）；
 *   - 预览与详情一律不回显 env / headers / token。
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { JwtPayload } from '../infra/auth.js';
import { requireAuth } from '../infra/auth.js';
import { sqliteGet } from '../infra/db.js';
import { parseBody } from '../infra/parse-request.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import {
  getSessionExtensionSettings,
  isSessionExtensionApprover,
  listSessionExtensionAdmins,
  listSessionMcpServers,
  listSessionSkills,
  addSessionExtensionAdmin,
  removeSessionExtensionAdmin,
  readSessionExtensionRevision,
  resolveSessionExtensionInheritance,
  setSessionExtensionInheritance,
} from '../session-extension/session-extension-store.js';
import { resolveSessionExtensionOrigin } from '../session-extension/session-extension-origin.js';
import {
  deleteSessionExtensionSecret,
  isValidSessionExtensionSecretName,
  listSessionExtensionSecretMetas,
  setSessionExtensionSecret,
} from '../session-extension/session-extension-secret-store.js';
import {
  cancelOperationForRoute,
  listPendingSessionExtensionOperations,
  proposeSessionScopeMcpUpsert,
  proposeSessionScopeSkillInstall,
  confirmAndApplySessionExtensionOperations,
  getSessionExtensionOperationDetail,
  revokeSessionExtensionEntry,
} from '../session-extension/session-extension-route-support.js';
import { notifyChannelSessionExtensionOutcome } from '../session-extension/session-extension-channel-notice.js';

interface SessionOwnershipRow {
  user_id: string;
  metadata_json: string;
}

const patchExtensionsSchema = z.object({
  inheritance: z.enum(['inherit', 'explicit']),
  expectedRevision: z.number().int().nonnegative(),
});

const createOperationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('skill'),
    skillId: z.string().trim().min(1).max(300),
    sourceId: z.string().trim().min(1).max(200).optional(),
    idempotencyKey: z.string().trim().min(1).max(200).optional(),
  }),
  z.object({
    kind: z.literal('mcp'),
    config: z.record(z.string(), z.unknown()),
    secretRef: z.string().trim().min(1).max(300).optional(),
    idempotencyKey: z.string().trim().min(1).max(200).optional(),
  }),
]);

const decisionSchema = z.object({
  nonce: z.string().uuid(),
  decision: z.enum(['approve', 'reject']),
  reason: z.string().max(500).optional(),
});

const adminSchema = z.object({
  adminUserId: z.string().trim().min(1).max(100),
});

/**
 * 会话凭据只接受**明文一次性提交**：写库即加密，响应永不回显（连长度都不回）。
 *
 * 上限 8000 字符：MCP 的 token / key 都在这个量级内，设上限是为了避免把整份
 * 证书链或私钥塞进来（那类东西该走 SSH 凭据或环境变量，不是这里）。
 */
const secretSchema = z.object({
  value: z.string().min(1).max(8000),
});

const revokeSchema = z.object({
  kind: z.enum(['skill', 'mcp']),
  resourceRef: z.string().trim().min(1).max(300),
  /** `true` = 移除条目；`false` = 仅禁用（保留配置，可重新提案启用）。 */
  remove: z.boolean(),
});

/** 校验会话存在且属于当前用户；失败时直接回 404（不泄露存在性）。 */
function requireOwnedSession(
  request: FastifyRequest,
  reply: FastifyReply,
  allowApprover = false,
): { sessionId: string; userId: string } | null {
  const user = request.user as JwtPayload;
  const { sessionId } = request.params as { sessionId: string };
  const session = sqliteGet<SessionOwnershipRow>(
    'SELECT user_id, metadata_json FROM sessions WHERE id = ? LIMIT 1',
    [sessionId],
  );
  if (
    !session ||
    (session.user_id !== user.sub &&
      !(allowApprover && isSessionExtensionApprover(session.user_id, user.sub)))
  ) {
    void reply.status(404).send({ error: '目标会话不存在。' });
    return null;
  }
  return { sessionId, userId: user.sub };
}

function describeExtensionState(sessionId: string): Record<string, unknown> {
  const origin = resolveSessionExtensionOrigin(sessionId);
  const skills = listSessionSkills(sessionId);
  const servers = listSessionMcpServers(sessionId);
  const settings = getSessionExtensionSettings(sessionId);
  return {
    sessionId,
    source: origin?.source ?? 'unknown',
    managementEnabled: origin?.managementEnabled ?? false,
    // 必须走 `resolveSessionExtensionInheritance` 而不是「设置行 ?? inherit」：
    // 渠道开启扩展管理后、尚未建行时会话的实际策略是 `explicit`（来源感知默认值），
    // 直接读设置行会把 `inherit` 报给界面，用户看到的策略与实际执行的相反。
    inheritance: resolveSessionExtensionInheritance(sessionId),
    configured: settings !== null,
    revision: readSessionExtensionRevision(sessionId),
    skills: skills.map((skill) => ({
      skillId: skill.skillId,
      resourceRef: skill.resourceRef,
      version: skill.version,
      enabled: skill.enabled,
      pinned: skill.pinned,
      contentDigest: skill.contentDigest,
    })),
    mcpServers: servers.map((server) => ({
      resourceRef: server.resourceRef,
      displayId: server.displayId,
      enabled: server.enabled,
      // 端点与密钥不回显；只给「是否已配置凭据」。
      hasSecret: server.secretRef !== null,
    })),
    // 凭据只回显名字与轮换时间，**绝不含明文**——面板据此显示「已录入哪些凭据」。
    secrets: listSessionExtensionSecretMetas(sessionId),
  };
}

export async function sessionExtensionsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/sessions/:sessionId/extensions',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'session.extensions.get');
      const owned = requireOwnedSession(request, reply);
      if (!owned) {
        step.fail('session not found or not owned');
        return reply;
      }
      return reply.send(describeExtensionState(owned.sessionId));
    },
  );

  app.patch(
    '/sessions/:sessionId/extensions',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'session.extensions.patch');
      const owned = requireOwnedSession(request, reply);
      if (!owned) {
        step.fail('session not found or not owned');
        return reply;
      }
      const parsed = parseBody(patchExtensionsSchema, request.body);
      const origin = resolveSessionExtensionOrigin(owned.sessionId);
      if (
        !origin ||
        !origin.managementEnabled ||
        origin.sessionId !== origin.originSessionId ||
        origin.source === 'team' ||
        origin.source === 'cron' ||
        (origin.source === 'channel' && parsed.inheritance === 'inherit')
      ) {
        return reply
          .status(403)
          .send({ error: '当前来源不允许此策略变更；渠道不能通过 PATCH 扩大用户资源继承范围。' });
      }
      const updated = setSessionExtensionInheritance({
        sessionId: owned.sessionId,
        ownerUserId: owned.userId,
        inheritance: parsed.inheritance,
        expectedRevision: parsed.expectedRevision,
      });
      if (!updated) {
        step.fail('revision conflict');
        return reply.status(409).send({ error: '配置已被其他端修改，请刷新后重试。' });
      }
      return reply.send(describeExtensionState(owned.sessionId));
    },
  );

  /**
   * 会话凭据的录入 / 轮换。
   *
   * **仅 owner**（不是「owner 或管理员」）：管理员被授权决策提案，不等于可以把
   * 自己的密钥写进别人的会话。渠道里的模型也拿不到这条路由——它只接受 JWT。
   */
  app.put(
    '/sessions/:sessionId/extension-secrets/:name',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'session.extensions.secrets.put');
      const owned = requireOwnedSession(request, reply);
      if (!owned) {
        step.fail('session not found or not owned');
        return reply;
      }
      const { name } = request.params as { sessionId: string; name: string };
      if (!isValidSessionExtensionSecretName(name)) {
        return reply
          .status(400)
          .send({ error: '凭据名不合法（仅允许字母、数字与 . _ -，最长 64）。' });
      }
      const parsed = parseBody(secretSchema, request.body);
      if (!setSessionExtensionSecret({ sessionId: owned.sessionId, name, value: parsed.value })) {
        step.fail('secret write failed');
        return reply.status(500).send({ error: '凭据写入失败。' });
      }
      step.succeed('secret stored');
      // 响应里**不出现**明文，也不出现长度：只回事实与最新清单。
      return reply.send({
        ok: true,
        name,
        secrets: listSessionExtensionSecretMetas(owned.sessionId),
      });
    },
  );

  app.delete(
    '/sessions/:sessionId/extension-secrets/:name',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'session.extensions.secrets.delete');
      const owned = requireOwnedSession(request, reply);
      if (!owned) {
        step.fail('session not found or not owned');
        return reply;
      }
      const { name } = request.params as { sessionId: string; name: string };
      const removed = deleteSessionExtensionSecret(owned.sessionId, name);
      step.succeed(removed ? 'secret removed' : 'secret absent');
      return reply.send({
        ok: removed,
        name,
        secrets: listSessionExtensionSecretMetas(owned.sessionId),
      });
    },
  );

  /**
   * 禁用 / 移除一条会话扩展条目。
   *
   * 用**一个**带 body 的路由而不是 REST 风格的两条路径：`resourceRef` 形如
   * `skill:session:demo`，塞进 path 参数要双方都记得转义，错一次就是 404 排查半天。
   * 只开放收窄方向（disable / remove），重新启用仍需重新走提案确认。
   */
  app.post(
    '/sessions/:sessionId/extensions/revoke',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'session.extensions.revoke');
      const owned = requireOwnedSession(request, reply);
      if (!owned) {
        step.fail('session not found or not owned');
        return reply;
      }
      const parsed = parseBody(revokeSchema, request.body);
      const result = await revokeSessionExtensionEntry({
        sessionId: owned.sessionId,
        kind: parsed.kind,
        resourceRef: parsed.resourceRef,
        remove: parsed.remove,
      });
      if (result.kind === 'denied') {
        step.fail('revoke denied');
        return reply.status(403).send({ error: result.reason });
      }
      if (result.kind === 'not_found') {
        step.fail('entry not found');
        return reply.status(404).send({ error: '目标条目不存在。' });
      }
      step.succeed(parsed.remove ? 'entry removed' : 'entry disabled');
      return reply.send({ ok: true, ...describeExtensionState(owned.sessionId) });
    },
  );

  app.get(
    '/sessions/:sessionId/extension-operations',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'session.extensions.operations.list');
      const owned = requireOwnedSession(request, reply);
      if (!owned) {
        step.fail('session not found or not owned');
        return reply;
      }
      return reply.send(listPendingSessionExtensionOperations(owned.sessionId));
    },
  );

  app.post(
    '/sessions/:sessionId/extension-operations',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'session.extensions.operations.create');
      const owned = requireOwnedSession(request, reply);
      if (!owned) {
        step.fail('session not found or not owned');
        return reply;
      }
      const parsed = parseBody(createOperationSchema, request.body);

      if (parsed.kind === 'skill') {
        const raw = await proposeSessionScopeSkillInstall({
          sessionId: owned.sessionId,
          skillId: parsed.skillId,
          sourceId: parsed.sourceId,
          idempotencyKey: parsed.idempotencyKey,
        });
        const body = JSON.parse(raw) as Record<string, unknown>;
        if (body['ok'] !== true) {
          step.fail('proposal denied');
          return reply.status(403).send(body);
        }
        return reply.status(201).send(body);
      }

      const raw = proposeSessionScopeMcpUpsert({
        sessionId: owned.sessionId,
        config: parsed.config,
        secretRef: parsed.secretRef ?? null,
        idempotencyKey: parsed.idempotencyKey,
      });
      const body = JSON.parse(raw) as Record<string, unknown>;
      if (body['ok'] !== true) {
        step.fail('proposal denied');
        return reply.status(403).send(body);
      }
      return reply.status(201).send(body);
    },
  );

  app.get(
    '/sessions/:sessionId/extension-operations/:operationId',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'session.extensions.operations.get');
      reply.header('Cache-Control', 'no-store');
      const owned = requireOwnedSession(request, reply, true);
      if (!owned) {
        step.fail('session not found or not owned');
        return reply;
      }
      const { operationId } = request.params as { sessionId: string; operationId: string };
      const detail = getSessionExtensionOperationDetail(owned.sessionId, operationId);
      if (!detail) {
        step.fail('operation not found');
        return reply.status(404).send({ error: '操作不存在。' });
      }
      return reply.send(detail);
    },
  );

  app.post(
    '/sessions/:sessionId/extension-operations/:operationId/decision',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'session.extensions.operations.decide');
      const owned = requireOwnedSession(request, reply, true);
      if (!owned) {
        step.fail('session not found or not owned');
        return reply;
      }
      const { operationId } = request.params as { sessionId: string; operationId: string };
      const parsed = parseBody(decisionSchema, request.body);

      const result = await confirmAndApplySessionExtensionOperations({
        sessionId: owned.sessionId,
        operationId,
        approverUserId: owned.userId,
        nonce: parsed.nonce,
        approve: parsed.decision === 'approve',
        reason: parsed.reason,
      });

      // 决策此刻已经落库：把结果（批准并安装 / 不可用 / 拒绝 / 过期）排进渠道回推
      // 队列。提案是在渠道里发起的，之前只有「已创建待确认提案」那一半有回执，
      // 确认后成没成功、为什么失败，渠道里完全看不到。是否回推由**操作自身状态**
      // 决定——无效 nonce / 越权等分支根本没产生终态，因此什么都不会入队。
      notifyChannelSessionExtensionOutcome({ sessionId: owned.sessionId, operationId });

      if (result['decision'] === 'invalid_nonce') {
        step.fail('invalid confirmation nonce');
        return reply.status(403).send({ error: '确认凭证无效，请刷新提案详情。', ...result });
      }
      if (result['decision'] === 'forbidden') {
        step.fail('not an authorized approver');
        return reply.status(403).send(result);
      }
      if (result['decision'] === 'not_found') {
        step.fail('operation not found');
        return reply.status(404).send(result);
      }
      if (result['decision'] === 'expired') {
        step.fail('operation expired');
        return reply.status(410).send(result);
      }
      if (result['decision'] === 'not_pending') {
        step.fail('operation is not pending');
        return reply.status(409).send(result);
      }
      return reply.send(result);
    },
  );

  app.post(
    '/sessions/:sessionId/extension-operations/:operationId/cancel',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'session.extensions.operations.cancel');
      const owned = requireOwnedSession(request, reply);
      if (!owned) {
        step.fail('session not found or not owned');
        return reply;
      }
      const { operationId } = request.params as { sessionId: string; operationId: string };
      const cancelled = cancelOperationForRoute(owned.sessionId, operationId);
      if (!cancelled) {
        step.fail('operation not cancellable');
        return reply.status(409).send({ error: '操作无法取消（可能已结束或正在执行）。' });
      }
      // 取消同样是渠道关心的终态：用户先从渠道里看到提案，再回来把它撤掉。
      notifyChannelSessionExtensionOutcome({ sessionId: owned.sessionId, operationId });
      return reply.send({ ok: true, operation: cancelled });
    },
  );

  // ── 管理员清单（owner 维护）──
  app.get(
    '/settings/session-extension-admins',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      return reply.send({ ok: true, admins: listSessionExtensionAdmins(user.sub) });
    },
  );

  app.post(
    '/settings/session-extension-admins',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const parsed = parseBody(adminSchema, request.body);
      if (parsed.adminUserId === user.sub) {
        return reply.status(400).send({ error: '会话所有者默认就是管理员，无需重复添加。' });
      }
      addSessionExtensionAdmin(user.sub, parsed.adminUserId);
      return reply.status(201).send({ ok: true, admins: listSessionExtensionAdmins(user.sub) });
    },
  );

  app.delete(
    '/settings/session-extension-admins/:adminUserId',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { adminUserId } = request.params as { adminUserId: string };
      const removed = removeSessionExtensionAdmin(user.sub, adminUserId);
      if (!removed) {
        return reply.status(404).send({ error: '该管理员不在清单中。' });
      }
      return reply.send({ ok: true, admins: listSessionExtensionAdmins(user.sub) });
    },
  );
}
