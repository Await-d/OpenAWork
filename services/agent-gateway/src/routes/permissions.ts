import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  mapPermissionRequestRow,
  parseApprovedPermissionResumePayload,
  parsePermissionRequestClientRequestId,
  type PermissionDecision,
  type PermissionRequestStatus,
  type PermissionRiskLevel,
} from '../permission/permission-contract.js';
import type { JwtPayload } from '../infra/auth.js';
import { requireAuth } from '../infra/auth.js';
import { ApiError } from '../infra/error-response.js';
import { parseBody } from '../infra/parse-request.js';
import { clearInternalTeamResumeRequest } from '../team/team-resume-context.js';
import {
  sqliteAll,
  sqliteGet,
  sqliteRun,
  sqliteRunWithChanges,
  sqliteTransaction,
} from '../infra/db.js';
import {
  createPermissionAskedEvent,
  createPermissionRepliedEvent,
} from '../session/session-permission-events.js';
import { publishSessionRunEvent } from '../session/session-run-events.js';
import { markPermissionNotificationsActedByRequestIds } from '../session/notification-store.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import { setPersistedSessionStateStatus } from './stream.js';
import {
  resumeApprovedPermissionRequest,
  resumeRejectedPermissionRequest,
} from './stream-runtime.js';
import {
  notifyChannelAfterApprovedResume,
  notifyChannelPermissionDecision,
  notifyChannelPermissionExpired,
  notifyChannelPermissionResumeFailure,
} from '../channels/channel-session-notice.js';
import { persistWorkspacePermanentPermission } from '../workspace/workspace-safety.js';
import {
  appendPermissionDecisionLog,
  listPermissionDecisionLogs,
  PERMISSION_DECISION_REASONS,
} from '../session/permission-decision-log-store.js';
import { upsertPermissionGrant } from '../permission/permission-grants-store.js';
import {
  cascadeApproveCoveredPendingPermissions,
  resolveAlwaysPatterns,
  resolvePermissionReplyCategory,
} from '../permission/permission-reply-always.js';

const permissionRouteRiskLevelSchema = z.enum(['low', 'medium', 'high']);
const permissionRouteDecisionSchema = z.enum(['once', 'session', 'permanent', 'reject']);

const createPermissionRequestSchema = z.object({
  toolName: z.string().min(1),
  scope: z.string().min(1),
  reason: z.string().min(1),
  riskLevel: permissionRouteRiskLevelSchema,
  previewAction: z.string().optional(),
  clientRequestId: z.string().min(1).max(128).optional(),
  always: z.array(z.string().min(1)).optional(),
});

const replyPermissionSchema = z.object({
  requestId: z.string().min(1),
  decision: permissionRouteDecisionSchema,
  feedback: z.string().max(2000).optional(),
  alwaysOverride: z.array(z.string().min(1)).optional(),
});

interface SessionOwnershipRow {
  id: string;
  user_id: string;
}

interface PermissionRequestRow {
  id: string;
  session_id: string;
  tool_name: string;
  scope: string;
  reason: string;
  risk_level: PermissionRiskLevel;
  preview_action: string | null;
  status: PermissionRequestStatus | 'consumed';
  decision: PermissionDecision | null;
  request_payload_json: string | null;
  expires_at: number | null;
  always_json: string | null;
  created_at: string;
}

/**
 * 把已到期的 pending 权限请求置为终态（rejected）。返回**真正被置终态**的条数。
 *
 * 调用面很窄，值得记住：本函数只在「共享会话读取」路径被调用
 * （`routes/session-shared-read-routes.ts`）。`GET /permissions/pending` 刻意不调它
 * —— 那个接口被前端以 2.5s 轮询，在这里写库等于把写事务挂到高频轮询上。
 * 因此「到期」是**软**约束：没人读共享会话时，过期的行会一直留在 pending，
 * 甚至连批准都仍然可以（reply 路由只看 `status === 'pending'`）。挂在这里的渠道
 * 提示因此也是尽力而为，不承诺必达。
 *
 * 逐条用 `changes` 判定而不是相信 SELECT 结果：两端同时读取共享会话时会各自
 * 查到同一批行，只有真正把行改掉的那一次才算「我让它失效的」，否则两边都会
 * 重复发布 `permission_replied` 事件、各推一条「授权已超时」。
 */
export function expirePendingPermissionRequests(input: {
  nowMs?: number;
  sessionId: string;
}): number {
  const nowMs = input.nowMs ?? Date.now();
  const requests = sqliteAll<PermissionRequestRow>(
    `SELECT id, session_id, tool_name, scope, reason, risk_level, preview_action, status, decision, request_payload_json, expires_at, created_at
     FROM permission_requests
     WHERE session_id = ? AND status = 'pending' AND expires_at IS NOT NULL AND expires_at <= ?
     ORDER BY created_at ASC`,
    [input.sessionId, nowMs],
  );

  const expiredToolNames: string[] = [];
  for (const request of requests) {
    const changes = sqliteRunWithChanges(
      `UPDATE permission_requests
       SET status = 'rejected', decision = 'reject', updated_at = datetime('now')
       WHERE id = ? AND session_id = ? AND status = 'pending'`,
      [request.id, input.sessionId],
    );
    if (changes === 0) {
      continue;
    }
    expiredToolNames.push(request.tool_name);
    const requestClientRequestId = parsePermissionRequestClientRequestId(
      request.request_payload_json,
    );
    publishSessionRunEvent(
      input.sessionId,
      createPermissionRepliedEvent({ requestId: request.id, decision: 'reject' }),
      requestClientRequestId ? { clientRequestId: requestClientRequestId } : undefined,
    );
  }

  if (expiredToolNames.length > 0) {
    // 超时既不是拒绝也不是批准：用户什么都没做，本轮就作废了。渠道里那句
    // 「等待授权」如果不说一声，会一直像是还有人在等它批准。
    notifyChannelPermissionExpired({
      sessionId: input.sessionId,
      toolNames: expiredToolNames,
    });
  }

  return expiredToolNames.length;
}

/**
 * 按回合键把 pending 权限请求置为终态（rejected）——回合回退专用原语。
 *
 * 与 `expirePendingPermissionRequests` 的区别（因此不可复用）：
 *   - 只匹配 `request_payload_json.clientRequestId === clientRequestId` 的行，
 *     不会误伤同会话其它回合的 pending 请求；
 *   - 不依赖 `expires_at`，回退发生时立即置终态；
 *   - 不做 session 全量级联（回退语义是「只作废被回退回合」）。
 *
 * 返回被置终态的请求数；无匹配行时返回 0（重复调用幂等）。
 */
export function cancelPendingPermissionRequestsByClientRequest(input: {
  sessionId: string;
  userId: string;
  clientRequestId: string;
}): number {
  if (!ownsSession(input.sessionId, input.userId)) {
    return 0;
  }

  const requests = sqliteAll<PermissionRequestRow>(
    `SELECT id, session_id, tool_name, scope, reason, risk_level, preview_action, status, decision, request_payload_json, expires_at, always_json, created_at
     FROM permission_requests
     WHERE session_id = ? AND status = 'pending'
     ORDER BY created_at ASC`,
    [input.sessionId],
  ).filter(
    (request) =>
      parsePermissionRequestClientRequestId(request.request_payload_json) === input.clientRequestId,
  );

  let transitionedCount = 0;
  for (const request of requests) {
    // 同 `expirePendingPermissionRequests`：并发调用（停止与回退撞在一起）时，
    // 只有真正改了行的那一次才发布事件、才算作废条数。
    const changes = sqliteRunWithChanges(
      `UPDATE permission_requests
       SET status = 'rejected', decision = 'reject', updated_at = datetime('now')
       WHERE id = ? AND session_id = ? AND status = 'pending'`,
      [request.id, input.sessionId],
    );
    if (changes === 0) {
      continue;
    }
    transitionedCount += changes;
    publishSessionRunEvent(
      input.sessionId,
      createPermissionRepliedEvent({ requestId: request.id, decision: 'reject' }),
      { clientRequestId: input.clientRequestId },
    );
  }

  if (transitionedCount > 0) {
    // 该回合已作废：清掉可能存在的 team resume 注册，避免后续 approve 续跑已删回合。
    clearInternalTeamResumeRequest(input.clientRequestId);
  }

  return transitionedCount;
}

/**
 * 按会话把 pending/deciding 权限请求置为终态（rejected）——快速停止子代理专用原语。
 *
 * 与 `cancelPendingPermissionRequestsByClientRequest` 的区别（因此不可复用）：
 *   - 不做回合筛选，直接清扫该会话全部待处理权限请求；
 *   - `deciding`（父代理自动决策进行中）也必须一并作废，否则被停止的子会话会永远停在 paused；
 *   - 不触碰 team resume 注册（停止子代理不等价于回退回合）。
 *
 * 返回被置终态的请求数；无匹配行时返回 0（重复调用幂等）。
 */
export function cancelPendingPermissionRequestsForSession(input: {
  sessionId: string;
  userId: string;
}): number {
  if (!ownsSession(input.sessionId, input.userId)) {
    return 0;
  }

  const requests = sqliteAll<PermissionRequestRow>(
    `SELECT id, session_id, tool_name, scope, reason, risk_level, preview_action, status, decision, request_payload_json, expires_at, always_json, created_at
     FROM permission_requests
     WHERE session_id = ? AND status IN ('pending', 'deciding')
     ORDER BY created_at ASC`,
    [input.sessionId],
  );

  let transitionedCount = 0;
  for (const request of requests) {
    const changes = sqliteRunWithChanges(
      `UPDATE permission_requests
       SET status = 'rejected', decision = 'reject', updated_at = datetime('now')
       WHERE id = ? AND session_id = ? AND status IN ('pending', 'deciding')`,
      [request.id, input.sessionId],
    );
    if (changes === 0) {
      continue;
    }

    transitionedCount += changes;
    const requestClientRequestId = parsePermissionRequestClientRequestId(
      request.request_payload_json,
    );
    publishSessionRunEvent(
      input.sessionId,
      createPermissionRepliedEvent({ requestId: request.id, decision: 'reject' }),
      requestClientRequestId ? { clientRequestId: requestClientRequestId } : undefined,
    );
  }

  return transitionedCount;
}

export async function permissionsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/sessions/:sessionId/permissions/pending',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = request.params as { sessionId: string };
      const { step } = startRequestWorkflow(request, 'permission.pending.list', undefined, {
        sessionId,
      });

      if (!ownsSession(sessionId, user.sub)) {
        step.fail('session not found');
        return reply.status(404).send({ error: '目标会话不存在。' });
      }

      // 这里**刻意不**回收僵尸 `deciding`（父代理 claim 后崩掉的那些），尽管本接口的
      // SQL 只认 `status = 'pending'`、不回收就看不到它们。原因是调用频率：
      // `use-sub-session-detail` 以 2.5s 轮询本接口（N 个子会话面板 = N 倍），在这里
      // 写库等于把写事务挂到高频轮询上。
      //
      // 覆盖由三处低频入口承担，缺一不可但都远比 2.5s 轮询稀疏：
      //   - `GET /sessions/:sessionId` 内部的 reconcile（同一轮面板刷新里已经跑）
      //   - `GET /sessions` 列表 / `GET /status` 入口的按用户批量释放
      //   - 删除、启动对账、remediation 路径的 `reconcileSessionStateStatus`
      const requests = sqliteAll<PermissionRequestRow>(
        `SELECT id, session_id, tool_name, scope, reason, risk_level, preview_action, status, decision, request_payload_json, expires_at, always_json, created_at
         FROM permission_requests
         WHERE session_id = ? AND status = 'pending'
         ORDER BY created_at ASC`,
        [sessionId],
      ).flatMap((row) => {
        const mapped = mapPermissionRequestRow(row);
        return mapped ? [mapped] : [];
      });

      step.succeed(undefined, { count: requests.length });
      return reply.send({ requests });
    },
  );

  app.get(
    '/sessions/:sessionId/permissions/decisions',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = request.params as { sessionId: string };
      const { step } = startRequestWorkflow(request, 'permission.decisions.list', undefined, {
        sessionId,
      });

      if (!ownsSession(sessionId, user.sub)) {
        // Same wording as the sibling endpoints: a non-owner learns nothing about
        // whether the session exists, and never sees any of its rows.
        step.fail('session not found');
        return reply.status(404).send({ error: '目标会话不存在。' });
      }

      const query = (request.query ?? {}) as { limit?: unknown; beforeId?: unknown };
      const limit = parsePermissionsDecisionsLimit(query.limit);
      const beforeId = parsePermissionsDecisionsBeforeId(query.beforeId);

      const rows = listPermissionDecisionLogs({ sessionId, limit, beforeId });
      const decisions = rows.map((row) => ({
        id: row.id,
        requestId: row.request_id,
        sessionId: row.session_id,
        toolName: row.tool_name,
        scope: row.scope,
        decision: row.decision,
        reason: row.reason,
        workspaceRoot: row.workspace_root,
        createdAt: row.created_at,
      }));

      step.succeed(undefined, { count: decisions.length });
      return reply.send({ decisions });
    },
  );

  app.post(
    '/sessions/:sessionId/permissions/requests',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = request.params as { sessionId: string };
      const { step } = startRequestWorkflow(request, 'permission.request.create', undefined, {
        sessionId,
      });
      const body = parseBody(createPermissionRequestSchema, request.body);

      if (!ownsSession(sessionId, user.sub)) {
        throw ApiError.notFound('目标会话不存在。');
      }

      const requestId = randomUUID();
      const clientRequestId = body.clientRequestId ?? `permission:${requestId}`;
      const alwaysPatterns = body.always && body.always.length > 0 ? body.always : null;
      sqliteRun(
        `INSERT INTO permission_requests
         (id, session_id, tool_name, scope, reason, risk_level, preview_action, request_payload_json, expires_at, always_json, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [
          requestId,
          sessionId,
          body.toolName,
          body.scope,
          body.reason,
          body.riskLevel,
          body.previewAction ?? null,
          JSON.stringify({ clientRequestId }),
          null,
          alwaysPatterns ? JSON.stringify(alwaysPatterns) : null,
        ],
      );

      publishSessionRunEvent(
        sessionId,
        createPermissionAskedEvent({
          requestId,
          toolName: body.toolName,
          scope: body.scope,
          reason: body.reason,
          riskLevel: body.riskLevel,
          previewAction: body.previewAction,
          ...(alwaysPatterns ? { always: alwaysPatterns } : {}),
        }),
        { clientRequestId },
      );

      const createdRequest = sqliteGet<PermissionRequestRow>(
        `SELECT id, session_id, tool_name, scope, reason, risk_level, preview_action, status, decision, request_payload_json, expires_at, always_json, created_at
         FROM permission_requests
         WHERE id = ? AND session_id = ?
         LIMIT 1`,
        [requestId, sessionId],
      );

      const fallback = {
        requestId,
        sessionId,
        toolName: body.toolName,
        scope: body.scope,
        reason: body.reason,
        riskLevel: body.riskLevel,
        previewAction: body.previewAction,
        ...(alwaysPatterns ? { always: alwaysPatterns } : {}),
        status: 'pending' as const,
        createdAt: new Date().toISOString(),
      };

      step.succeed(undefined, { requestId });
      return reply.status(201).send({
        request: createdRequest ? (mapPermissionRequestRow(createdRequest) ?? fallback) : fallback,
      });
    },
  );

  app.post(
    '/sessions/:sessionId/permissions/reply',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = request.params as { sessionId: string };
      const { step } = startRequestWorkflow(request, 'permission.request.reply', undefined, {
        sessionId,
      });
      const body = parseBody(replyPermissionSchema, request.body);

      if (!ownsSession(sessionId, user.sub)) {
        throw ApiError.notFound('目标会话不存在。');
      }

      const permissionRequest = sqliteGet<PermissionRequestRow>(
        `SELECT id, session_id, tool_name, scope, reason, risk_level, preview_action, status, decision, request_payload_json, expires_at, always_json, created_at
         FROM permission_requests
         WHERE id = ? AND session_id = ?
         LIMIT 1`,
        [body.requestId, sessionId],
      );
      if (!permissionRequest) {
        throw ApiError.notFound('目标权限请求不存在。');
      }
      if (permissionRequest.status !== 'pending') {
        // 幂等收口：重复提交时仍把对应通知标为已读，避免前端通知中心残留
        // 可点击的已处理权限项。
        markPermissionNotificationsActedByRequestIds({
          requestIds: [body.requestId],
          sessionId,
          userId: user.sub,
        });
        step.fail('permission request already resolved');
        return reply.status(409).send({ error: '权限请求已处理，无法重复提交。' });
      }

      sqliteTransaction(() => {
        const changes = sqliteRunWithChanges(
          `UPDATE permission_requests
         SET status = ?, decision = ?, updated_at = datetime('now')
         WHERE id = ? AND session_id = ? AND status = 'pending'`,
          [
            body.decision === 'reject' ? 'rejected' : 'approved',
            body.decision,
            body.requestId,
            sessionId,
          ],
        );

        if (changes === 0) {
          throw ApiError.conflict('权限请求已处理，无法重复提交。');
        }

        appendPermissionDecisionLog({
          requestId: body.requestId,
          sessionId,
          toolName: permissionRequest.tool_name,
          scope: permissionRequest.scope,
          decision: body.decision,
          reason:
            body.decision === 'reject'
              ? PERMISSION_DECISION_REASONS.USER_REJECTED
              : PERMISSION_DECISION_REASONS.USER_APPROVED,
        });

        if (body.decision === 'permanent') {
          // Use always patterns (from opencode ctx.ask always) for broad approval.
          // e.g. approving edit with always:["*"] → write rule { permission: "edit", pattern: "*" }
          // Legacy rows without an `always_json` (column added later) fall back
          // to the original request scope so we never silently broaden a
          // permanent grant to "*" just because the column was missing.
          // If the client provides `alwaysOverride`, use that instead — this
          // allows the UI to let users pick a narrower or broader scope.
          const category = resolvePermissionReplyCategory(permissionRequest.tool_name);
          const alwaysPatterns = resolveAlwaysPatterns(permissionRequest, body.alwaysOverride);
          for (const pattern of alwaysPatterns) {
            // Durable, user-scoped grant first: this is the source of truth for
            // cross-session permanent approval and must not depend on the
            // (best-effort) workspace config file write below.
            upsertPermissionGrant({ userId: user.sub, toolName: category, scope: pattern });
          }
        } else if (body.decision === 'session') {
          // Mirror opencode's `permission.ask reply='always'` semantics: when
          // the user picks 本会话允许, push every `always` pattern into the set
          // of approved scopes for this session so subsequent requests in the
          // same category whose scope matches one of those patterns auto-resolve
          // without re-prompting (e.g. approving `ls -la` covers `ls /tmp`,
          // `ls -a` etc. via the arity pattern `ls *`).
          //
          // We persist as synthetic `permission_requests` rows (status='approved',
          // decision='session', scope=<pattern>) — `findApprovedPermission` then
          // matches via wildcard. Synthetic rows are keyed by (tool_name, scope)
          // to stay idempotent if the same broad approval is granted twice.
          // If the client provides `alwaysOverride`, use that instead.
          const category = resolvePermissionReplyCategory(permissionRequest.tool_name);
          const alwaysPatterns = resolveAlwaysPatterns(permissionRequest, body.alwaysOverride);
          for (const pattern of alwaysPatterns) {
            const existing = sqliteGet<{ id: string }>(
              `SELECT id FROM permission_requests
             WHERE session_id = ? AND tool_name = ? AND scope = ?
               AND status = 'approved' AND decision = 'session'
             LIMIT 1`,
              [sessionId, category, pattern],
            );
            if (existing) continue;
            // Avoid clashing with the original row that has scope = literal command.
            if (category === permissionRequest.tool_name && pattern === permissionRequest.scope) {
              continue;
            }
            sqliteRun(
              `INSERT INTO permission_requests
             (id, session_id, tool_name, scope, reason, risk_level, preview_action, request_payload_json, expires_at, always_json, status, decision)
             VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 'approved', 'session')`,
              [
                randomUUID(),
                sessionId,
                category,
                pattern,
                permissionRequest.reason,
                permissionRequest.risk_level,
                permissionRequest.preview_action,
                JSON.stringify([pattern]),
              ],
            );
          }
        }
      });

      // 工作区文件仅为镜像；数据库授权已提交，镜像失败不能中断通知和恢复。
      if (body.decision === 'permanent') {
        const category = resolvePermissionReplyCategory(permissionRequest.tool_name);
        for (const pattern of resolveAlwaysPatterns(permissionRequest, body.alwaysOverride)) {
          try {
            persistWorkspacePermanentPermission({ sessionId, toolName: category, scope: pattern });
          } catch {
            request.log.warn(
              { requestId: body.requestId, sessionId },
              'failed to mirror committed permanent permission to workspace',
            );
          }
        }
      }

      const requestClientRequestId = parsePermissionRequestClientRequestId(
        permissionRequest.request_payload_json,
      );
      const resumePayload = parseApprovedPermissionResumePayload(
        permissionRequest.request_payload_json,
      );

      // Cascade approve（对齐 opencode 的 always 回溯放行，permission.ts:250-283）：
      // 授予「本会话允许 / 永久允许」后，同会话同类别中已被新规则覆盖的其它 pending
      // 请求一并自动放行，避免用户对同一批调用逐个点击。
      //
      // 有意不自动 resume：每次 resume 都会启动一次完整 LLM 续跑，并发续跑同一会话
      // 不安全；已作答请求的 resume 会驱动本回合，而被放行的请求是持久审批行，后续
      // 重试会直接命中。范围限定同会话——跨会话 pending 属罕见场景，且其它会话的新
      // 请求已由 user 级 grant 自动放行。
      const cascadedRequestIds: string[] = [];
      if (body.decision === 'permanent' || body.decision === 'session') {
        cascadedRequestIds.push(
          ...cascadeApproveCoveredPendingPermissions({
            sessionId,
            excludeRequestId: body.requestId,
            category: resolvePermissionReplyCategory(permissionRequest.tool_name),
            patterns: resolveAlwaysPatterns(permissionRequest, body.alwaysOverride),
            decision: body.decision,
          }),
        );
      }

      // Continue-on-deny: when enabled, feed the rejection as a tool error and
      // resume the LLM loop so it can try a different approach.
      const continueOnDeny =
        body.decision === 'reject' &&
        resumePayload &&
        process.env['OPENAWORK_CONTINUE_ON_DENY'] === 'true';

      // Cascade reject: when rejecting, also reject all other pending requests in the same session.
      // This mirrors opencode's behavior where rejecting one permission cascades to all pending.
      if (body.decision === 'reject') {
        const otherPending = sqliteAll<PermissionRequestRow>(
          `SELECT id, session_id, tool_name, scope, reason, risk_level, preview_action, status, decision, request_payload_json, expires_at, created_at
           FROM permission_requests
           WHERE session_id = ? AND status = 'pending' AND id != ?
           ORDER BY created_at ASC`,
          [sessionId, body.requestId],
        );
        for (const pending of otherPending) {
          const changes = sqliteRunWithChanges(
            `UPDATE permission_requests
             SET status = 'rejected', decision = 'reject', updated_at = datetime('now')
             WHERE id = ? AND session_id = ? AND status = 'pending'`,
            [pending.id, sessionId],
          );
          // Idempotency gate: only rows that actually transitioned from pending
          // get an audit row / event, so a replayed reject cannot double-log.
          // Mirrors the approve cascade in `permission-reply-always.ts`.
          if (changes === 0) {
            continue;
          }
          appendPermissionDecisionLog({
            requestId: pending.id,
            sessionId,
            toolName: pending.tool_name,
            scope: pending.scope,
            decision: 'reject',
            reason: PERMISSION_DECISION_REASONS.USER_REJECTED,
          });
          const pendingClientRequestId = parsePermissionRequestClientRequestId(
            pending.request_payload_json,
          );
          const shouldKeepResumeRegistration =
            continueOnDeny &&
            pendingClientRequestId !== null &&
            pendingClientRequestId === requestClientRequestId;
          if (pendingClientRequestId && !shouldKeepResumeRegistration) {
            clearInternalTeamResumeRequest(pendingClientRequestId);
          }
          publishSessionRunEvent(
            sessionId,
            createPermissionRepliedEvent({ requestId: pending.id, decision: 'reject' }),
            pendingClientRequestId ? { clientRequestId: pendingClientRequestId } : undefined,
          );
          cascadedRequestIds.push(pending.id);
        }
      }
      publishSessionRunEvent(
        sessionId,
        createPermissionRepliedEvent({
          requestId: body.requestId,
          decision: body.decision,
          ...(body.decision === 'reject' && body.feedback ? { feedback: body.feedback } : {}),
        }),
        requestClientRequestId ? { clientRequestId: requestClientRequestId } : undefined,
      );
      markPermissionNotificationsActedByRequestIds({
        requestIds: [body.requestId, ...cascadedRequestIds],
        sessionId,
        userId: user.sub,
      });

      // 决定此刻已经落库：渠道会话看不到 Web 端的权限卡片，必须回推一条，
      // 否则渠道用户只会看到「一直没动静」。best-effort —— 审批已生效，
      // 推送失败绝不能把响应变成 500 诱导用户重复提交。
      notifyChannelPermissionDecision({
        sessionId,
        toolName: permissionRequest.tool_name,
        decision: body.decision,
        resumed: body.decision !== 'reject' && resumePayload !== null,
      });

      if (body.decision === 'reject' && !continueOnDeny && requestClientRequestId) {
        clearInternalTeamResumeRequest(requestClientRequestId);
      }

      setPersistedSessionStateStatus({
        sessionId,
        status: body.decision === 'reject' && !continueOnDeny ? 'idle' : 'running',
        userId: user.sub,
      });

      if (body.decision !== 'reject' && resumePayload) {
        // 收窄在闭包里会丢失，提取成局部常量。
        const approvedResumePayload = resumePayload;
        void resumeApprovedPermissionRequest({
          payload: {
            ...approvedResumePayload,
            toolName: permissionRequest.tool_name,
          },
          sessionId,
          userId: user.sub,
        })
          .then(() =>
            // 续跑发生在没有打开的 SSE / WS 的路径上，渠道侧拿不到任何输出；
            // 批准后不再回一条（结果、或「又停下来等下一次授权」），盲区只是
            // 从审批前挪到了审批后。
            notifyChannelAfterApprovedResume({
              sessionId,
              clientRequestId: approvedResumePayload.clientRequestId,
            }),
          )
          .catch((error) => {
            request.log.error(
              { err: error, requestId: body.requestId, sessionId },
              'failed to auto-resume approved permission request',
            );
            // 续跑炸掉时渠道里不能只留下「已批准」的沉默——那比等审批更难排查。
            notifyChannelPermissionResumeFailure({
              sessionId,
              detail: error instanceof Error ? error.message : String(error),
            });
          });
      } else if (continueOnDeny && resumePayload) {
        void resumeRejectedPermissionRequest({
          payload: {
            ...resumePayload,
            toolName: permissionRequest.tool_name,
          },
          feedback: body.feedback,
          sessionId,
          userId: user.sub,
        }).catch((error) => {
          request.log.error(
            { err: error, requestId: body.requestId, sessionId },
            'failed to resume after rejected permission (continue-on-deny)',
          );
        });
      }

      step.succeed(undefined, {
        requestId: body.requestId,
        decision: body.decision,
        ...(cascadedRequestIds.length > 0 ? { cascadedCount: cascadedRequestIds.length } : {}),
      });
      return reply.send({ ok: true });
    },
  );
}

/** Default / hard cap for `GET /sessions/:sessionId/permissions/decisions`. */
export const PERMISSION_DECISIONS_DEFAULT_LIMIT = 50;
export const PERMISSION_DECISIONS_MAX_LIMIT = 200;

/**
 * Parse the `limit` query param. Missing/blank → default. Non-numeric or
 * non-finite → default (never a full-table scan, never interpolated into SQL).
 * Values above the cap are CLAMPED to the cap rather than rejected: a client
 * asking for "more" simply gets the maximum page size, which keeps the endpoint
 * forgiving without ever widening the result set unexpectedly.
 */
function parsePermissionsDecisionsLimit(raw: unknown): number {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return PERMISSION_DECISIONS_DEFAULT_LIMIT;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return PERMISSION_DECISIONS_DEFAULT_LIMIT;
  }
  return Math.min(Math.floor(parsed), PERMISSION_DECISIONS_MAX_LIMIT);
}

/**
 * Parse the `beforeId` keyset cursor. Missing/blank/invalid → `undefined`
 * (first page). Returned as a number so it is always bound as a parameter.
 */
function parsePermissionsDecisionsBeforeId(raw: unknown): number | undefined {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return Math.floor(parsed);
}

function ownsSession(sessionId: string, userId: string): boolean {
  const session = sqliteGet<SessionOwnershipRow>(
    'SELECT id, user_id FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
    [sessionId, userId],
  );
  return session !== undefined;
}
