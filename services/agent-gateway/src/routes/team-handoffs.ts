/**
 * 260515-team-phase-b · T-03 路由层
 *
 * Handoff 只读 REST 端点。Phase B 此处只暴露查询能力，让 UI 能渲染
 * Session 树 / 任务列表；写入操作（create / cancel）会在 T-09 / T-10
 * 重构 interaction-agent / team-leader 时一并暴露。
 *
 * 这样切分的好处：Phase B 提交 T-01..T-05 + T-07 只读路径时，**不会动到
 * 现有 interaction-agent / team-leader 任何对外接口**，可以安全合入。
 *
 * 端点：
 *   - GET /team/handoffs/:handoffId           查询单条
 *   - GET /team/sessions/:sessionId/handoffs  查询某 session 的 handoff 链
 *   - POST /team/handoffs/:handoffId/cancel   主动取消（Phase B 唯一的写端点，
 *                                              用于让用户在 UI 上中止派发）
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { JwtPayload } from '../infra/auth.js';
import { requireAuth } from '../infra/auth.js';
import { sqliteAll, sqliteGet, sqliteRun } from '../infra/db.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import {
  cancelHandoff,
  createHandoff,
  getHandoff,
  getReviewDispositionFromPayload,
  isHandledReviewFailurePayload,
  listHandoffsBySession,
  mergeReviewDispositionIntoPayload,
  pauseHandoff,
  retryRunningHandoffById,
  resumeHandoff,
  type HandoffRecord,
  type HandoffRoleLayer,
} from '../handoff/store/handoff-store.js';
import { publishHandoffEvent, publishTeamEvent } from '../handoff/bus/team-events-bus.js';
import {
  createTeamSession,
  validateTeamParentSession,
} from '../handoff/bus/team-session-create.js';
import { submitInboundMessage } from '../handoff/store/inbound-store.js';
import { setSubstate } from '../handoff/store/substate-store.js';
import { parseBody, parseParams } from '../infra/parse-request.js';
import { logTeamAudit } from '../team/team-audit-store.js';
import {
  cancelTeamRuntimeTree,
  pauseTeamRuntimeTree,
  resumeTeamRuntimeTree,
  type TeamRuntimeControlScope,
} from '../team/team-runtime-control-store.js';
import {
  getAnyInFlightStreamRequestForSession,
  stopAllInFlightStreamRequestsForSession,
} from './stream-cancellation.js';
import { buildTeamResumeBackgroundRequestData } from '../team/team-resume-context.js';
import {
  assessTeamResumeMode,
  resolveBackgroundRerunTarget,
} from '../team/team-resume-context.js';
import { preResumeConsistencyCheck } from '../team/team-resume-consistency-check.js';
import { runSessionInBackground } from './stream-runtime.js';

const TEAM_ROLE_LAYERS = ['user', 'reception', 'pm1', 'pm2', 'executor', 'reviewer'] as const;

type RuntimeScopeTruncationFields = Pick<
  TeamRuntimeControlScope,
  | 'depthLimitReached'
  | 'limitReached'
  | 'omittedSessionCount'
  | 'sessionLimit'
  | 'sessionMaxDepth'
  | 'truncated'
>;

const createTeamSessionSchema = z.object({
  roleLayer: z.enum(TEAM_ROLE_LAYERS),
  teamParentSessionId: z.string().min(1).max(200).optional(),
  title: z.string().min(1).max(200).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const createHandoffSchema = z.object({
  fromSessionId: z.string().min(1).max(200),
  fromRoleLayer: z.enum(TEAM_ROLE_LAYERS),
  toRoleLayer: z.enum(TEAM_ROLE_LAYERS),
  payload: z.unknown().optional(),
});

const pauseHandoffSchema = z.object({
  reason: z.string().trim().min(1).max(500).optional(),
});

const reviewActionSchema = z.enum(['redispatch', 'return-to-c', 'escalate-to-user']);
const reviewActionParamsSchema = z.object({
  action: reviewActionSchema,
  handoffId: z.string().min(1).max(200),
});

type TeamHandoffRouteErrorCode =
  | 'team_parent_session_not_found'
  | 'team_handoff_source_session_not_found'
  | 'team_handoff_not_found'
  | 'team_session_not_found'
  | 'team_handoff_review_requires_pm2'
  | 'team_handoff_cannot_redispatch'
  | 'team_handoff_cannot_return_to_pm1'
  | 'team_handoff_cannot_cancel'
  | 'team_handoff_cannot_pause'
  | 'team_handoff_cannot_resume'
  | 'team_handoff_invalid_limit';

const TEAM_HANDOFF_ROUTE_ERROR_MESSAGES: Record<TeamHandoffRouteErrorCode, string> = {
  team_parent_session_not_found: '目标团队父会话不存在。',
  team_handoff_source_session_not_found: '源团队会话不存在。',
  team_handoff_not_found: '目标 handoff 不存在。',
  team_session_not_found: '目标团队会话不存在。',
  team_handoff_review_requires_pm2: '只有 PM2 handoff 支持该评审动作。',
  team_handoff_cannot_redispatch: '当前 handoff 无法重派，可能已被其他流程接管。',
  team_handoff_cannot_return_to_pm1: '当前 handoff 无法退回 PM1，可能缺少可回放的上游规划。',
  team_handoff_cannot_cancel: '当前状态不允许取消该 handoff。',
  team_handoff_cannot_pause: '当前状态不允许暂停该 handoff。',
  team_handoff_cannot_resume: '当前状态不允许恢复该 handoff。',
  team_handoff_invalid_limit: '请求参数 limit 非法（应为 1..500 的正整数）。',
};

function teamHandoffRouteErrorPayload(
  code: TeamHandoffRouteErrorCode,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    code,
    error: TEAM_HANDOFF_ROUTE_ERROR_MESSAGES[code],
    ...(extra ?? {}),
  };
}

function runtimeScopeTruncationFields(
  input: RuntimeScopeTruncationFields,
): RuntimeScopeTruncationFields {
  return {
    depthLimitReached: input.depthLimitReached,
    limitReached: input.limitReached,
    omittedSessionCount: input.omittedSessionCount,
    sessionLimit: input.sessionLimit,
    sessionMaxDepth: input.sessionMaxDepth,
    truncated: input.truncated,
  };
}

function hasInFlightTeamRuntime(input: { sessionIds: string[]; userId: string }): boolean {
  return input.sessionIds.some((sessionId) =>
    getAnyInFlightStreamRequestForSession({ sessionId, userId: input.userId }),
  );
}

function triggerTeamResumeBackgroundRun(input: {
  rootSessionId: string;
  sessionIds: string[];
  userId: string;
}): void {
  if (input.sessionIds.length === 0 || hasInFlightTeamRuntime(input)) {
    return;
  }

  void runSessionInBackground({
    requestData: buildTeamResumeBackgroundRequestData({ rootSessionId: input.rootSessionId }),
    sessionId: input.rootSessionId,
    teamResumeRootSessionId: input.rootSessionId,
    userId: input.userId,
  }).catch((error: unknown) => {
    console.warn(
      `[team-handoffs] resume-all 后台恢复续跑失败（不阻塞 HTTP 回复）：${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  });
}

type HandoffControlAction = 'cancel' | 'pause' | 'resume';
type HandoffControlSignal = 'cancel_signal' | 'pause_signal' | 'resume_signal';

function logHandoffControl(input: {
  action: HandoffControlAction;
  actorEmail?: string;
  actorUserId: string;
  record: HandoffRecord;
  reason?: string | null;
}): void {
  try {
    logTeamAudit({
      action: 'handoff_control',
      actorEmail: input.actorEmail,
      actorUserId: input.actorUserId,
      detail: JSON.stringify({
        action: input.action,
        handoffId: input.record.id,
        fromRoleLayer: input.record.fromRoleLayer,
        toRoleLayer: input.record.toRoleLayer,
        fromSessionId: input.record.fromSessionId,
        toSessionId: input.record.toSessionId,
        state: input.record.state,
        paused: input.record.paused,
        reason: input.reason ?? null,
      }),
      entityId: input.record.id,
      entityType: 'handoff',
      sessionId: input.record.toSessionId ?? input.record.fromSessionId,
      summary: `handoff ${input.action}: ${input.record.id.slice(0, 8)} ${input.record.fromRoleLayer}→${input.record.toRoleLayer}`,
      userId: input.record.userId,
    });
  } catch (err) {
    console.warn(
      `[team-handoffs] audit(${input.action}) 失败：${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function injectControlSignal(input: {
  action: HandoffControlAction;
  messageType: HandoffControlSignal;
  reason?: string | null;
  record: HandoffRecord;
}): void {
  if (!input.record.toSessionId) return;
  try {
    submitInboundMessage({
      userId: input.record.userId,
      toSessionId: input.record.toSessionId,
      fromRoleLayer: 'system',
      messageType: input.messageType,
      payload: {
        reason: input.reason ?? null,
        handoffId: input.record.id,
        action: input.action,
      },
    });
  } catch (err) {
    console.warn(
      `[team-handoffs] ${input.messageType} 注入失败：${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function publishSchedulerControlEvent(input: {
  type: 'scheduler.task-paused' | 'scheduler.task-resumed';
  reason?: string | null;
  record: HandoffRecord;
}): void {
  publishTeamEvent({
    type: input.type,
    taskId: input.record.id,
    sessionId: input.record.toSessionId ?? input.record.fromSessionId,
    layer: input.record.toRoleLayer,
    timestamp: Date.now(),
    userId: input.record.userId,
    payload: {
      handoffId: input.record.id,
      fromRoleLayer: input.record.fromRoleLayer,
      toRoleLayer: input.record.toRoleLayer,
      state: input.record.state,
      paused: input.record.paused,
      reason: input.reason ?? input.record.pauseReason ?? null,
    },
  });
}

function publishSchedulerAllControlEvent(
  input: {
    handoffIds: string[];
    reason?: string | null;
    rootRoleLayer?: string | null;
    sessionIds: string[];
    staleSessionCount?: number;
    type: 'scheduler.all-paused' | 'scheduler.all-resumed';
    userId: string;
    rootSessionId: string;
  } & RuntimeScopeTruncationFields,
): void {
  publishTeamEvent({
    type: input.type,
    sessionId: input.rootSessionId,
    layer: input.rootRoleLayer ?? 'system',
    timestamp: Date.now(),
    userId: input.userId,
    payload: {
      handoffIds: input.handoffIds,
      rootSessionId: input.rootSessionId,
      sessionIds: input.sessionIds,
      reason: input.reason ?? null,
      staleSessionCount: input.staleSessionCount ?? 0,
      ...runtimeScopeTruncationFields(input),
    },
  });
}

function logSessionTreeControl(
  input: {
    action: 'pause-all' | 'resume-all';
    actorEmail?: string;
    actorUserId: string;
    handoffIds: string[];
    reason?: string | null;
    rootSessionId: string;
    sessionIds: string[];
    staleSessionCount?: number;
    userId: string;
  } & RuntimeScopeTruncationFields,
): void {
  try {
    logTeamAudit({
      action: 'handoff_control',
      actorEmail: input.actorEmail,
      actorUserId: input.actorUserId,
      detail: JSON.stringify({
        action: input.action,
        rootSessionId: input.rootSessionId,
        sessionIds: input.sessionIds,
        handoffIds: input.handoffIds,
        reason: input.reason ?? null,
        staleSessionCount: input.staleSessionCount ?? 0,
        ...runtimeScopeTruncationFields(input),
      }),
      entityId: input.rootSessionId,
      entityType: 'session',
      sessionId: input.rootSessionId,
      summary: `team ${input.action}: ${input.rootSessionId.slice(0, 8)} sessions=${input.sessionIds.length} handoffs=${input.handoffIds.length}`,
      userId: input.userId,
    });
  } catch (err) {
    console.warn(
      `[team-handoffs] audit(${input.action}) 失败：${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * 级联取消某个 session 子树下的所有未终止 handoff（跨层健壮性补强）。
 *
 * 单条 cancelHandoff 只翻自身状态；本函数沿 team_parent_session_id 递归取消整棵
 * 下游子树，并对每个下游 session：
 *   1. 注入 cancel_signal（team-stream-control gate 在下个 round 边界中止执行）。
 *   2. stopAllInFlightStreamRequestsForSession 立即 abort 正在跑的 LLM 流。
 *   3. setSubstate('cancelled') 让前端进度条立刻反映终态。
 *
 * 全程 best-effort：单个 session 的信号注入/停流失败不阻塞其余 session。
 */
async function cascadeCancelDownstream(input: {
  rootSessionId: string;
  userId: string;
  excludeHandoffId?: string;
}): Promise<void> {
  const result = cancelTeamRuntimeTree({
    rootSessionId: input.rootSessionId,
    userId: input.userId,
  });
  if (!result) return;

  // 对子树里每个 session 停流 + 置 substate。treeSessionIds 含 root 自身与所有后代。
  for (const sessionId of result.treeSessionIds) {
    try {
      submitInboundMessage({
        userId: input.userId,
        toSessionId: sessionId,
        fromRoleLayer: 'system',
        messageType: 'cancel_signal',
        payload: { reason: 'cascade-cancel', rootSessionId: input.rootSessionId },
      });
    } catch (err) {
      console.warn(
        `[team-handoffs] cascade cancel_signal 注入失败（${sessionId}）：${err instanceof Error ? err.message : String(err)}`,
      );
    }
    try {
      await stopAllInFlightStreamRequestsForSession({ sessionId, userId: input.userId });
    } catch (err) {
      console.warn(
        `[team-handoffs] cascade 停流失败（${sessionId}）：${err instanceof Error ? err.message : String(err)}`,
      );
    }
    try {
      setSubstate({ sessionId, substate: 'cancelled', userId: input.userId });
    } catch (err) {
      console.warn(
        `[team-handoffs] cascade setSubstate('cancelled') 失败（${sessionId}）：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  for (const cancelledHandoffId of result.cancelledHandoffIds) {
    if (cancelledHandoffId === input.excludeHandoffId) continue;
    const record = getHandoff({ userId: input.userId, handoffId: cancelledHandoffId });
    if (record) {
      publishHandoffEvent({ type: 'handoff.cancelled', record });
    }
  }

  // 审计：记录级联取消的范围（根 session、波及 session 数、取消 handoff 数），
  // 便于事后排查「取消了什么」。best-effort，不阻塞。
  try {
    logTeamAudit({
      action: 'handoff_control',
      actorUserId: input.userId,
      detail: JSON.stringify({
        action: 'cascade-cancel',
        rootSessionId: input.rootSessionId,
        excludeHandoffId: input.excludeHandoffId ?? null,
        treeSessionCount: result.treeSessionIds.length,
        cascadeCancelledHandoffIds: result.cancelledHandoffIds,
      }),
      entityId: input.rootSessionId,
      entityType: 'session',
      sessionId: input.rootSessionId,
      summary: `cascade cancel: root=${input.rootSessionId.slice(0, 8)} sessions=${result.treeSessionIds.length} handoffs=${result.cancelledHandoffIds.length}`,
      userId: input.userId,
    });
  } catch (err) {
    console.warn(
      `[team-handoffs] cascade 审计日志写入失败（不阻塞）：${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function teamHandoffsRoutes(app: FastifyInstance): Promise<void> {
  // ─── Team Sessions ──────────────────────────────────────────────────────

  app.post(
    '/team/sessions',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'team.sessions.create');
      const user = request.user as JwtPayload;

      const parseStep = child('parse-body');
      const body = parseBody(createTeamSessionSchema, request.body);
      parseStep.succeed();

      // 校验 parent 必须存在 + 同一用户
      if (body.teamParentSessionId) {
        const validateStep = child('validate-parent');
        const ok = validateTeamParentSession({
          userId: user.sub,
          teamParentSessionId: body.teamParentSessionId,
        });
        if (!ok) {
          validateStep.fail('parent not found');
          step.fail('parent not found');
          return reply
            .status(404)
            .send(teamHandoffRouteErrorPayload('team_parent_session_not_found'));
        }
        validateStep.succeed();
      }

      const metadataJson = body.metadata ? JSON.stringify(body.metadata) : '{}';

      const result = createTeamSession({
        userId: user.sub,
        roleLayer: body.roleLayer as HandoffRoleLayer,
        teamParentSessionId: body.teamParentSessionId ?? null,
        title: body.title ?? null,
        metadataJson,
      });

      step.succeed(undefined, {
        sessionId: result.sessionId,
        roleLayer: body.roleLayer,
      });
      return reply.status(201).send({ sessionId: result.sessionId });
    },
  );

  // ─── Handoffs CRUD ──────────────────────────────────────────────────────

  app.post(
    '/team/handoffs',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'team.handoffs.create');
      const user = request.user as JwtPayload;

      const parseStep = child('parse-body');
      const body = parseBody(createHandoffSchema, request.body);
      parseStep.succeed();

      // from_session_id 必须存在且属于同一用户
      const validateStep = child('validate-from-session');
      const ok = validateTeamParentSession({
        userId: user.sub,
        teamParentSessionId: body.fromSessionId,
      });
      if (!ok) {
        validateStep.fail('from session not found');
        step.fail('from session not found');
        return reply
          .status(404)
          .send(teamHandoffRouteErrorPayload('team_handoff_source_session_not_found'));
      }
      validateStep.succeed();

      const record = createHandoff({
        userId: user.sub,
        fromSessionId: body.fromSessionId,
        fromRoleLayer: body.fromRoleLayer as HandoffRoleLayer,
        toRoleLayer: body.toRoleLayer as HandoffRoleLayer,
        payload: body.payload,
      });
      publishHandoffEvent({ type: 'handoff.created', record });

      step.succeed(undefined, { handoffId: record.id });
      return reply.status(201).send({ handoff: record });
    },
  );

  app.get(
    '/team/handoffs/:handoffId',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'team.handoffs.get');
      const user = request.user as JwtPayload;
      const handoffId = (request.params as { handoffId: string }).handoffId;

      const record = getHandoff({ userId: user.sub, handoffId });
      if (!record) {
        step.fail('not found');
        return reply.status(404).send(teamHandoffRouteErrorPayload('team_handoff_not_found'));
      }
      step.succeed(undefined, { handoffId, state: record.state });
      return reply.send({ handoff: record });
    },
  );

  app.get(
    '/team/sessions/:sessionId/handoffs',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'team.handoffs.list-by-session');
      const user = request.user as JwtPayload;
      const sessionId = (request.params as { sessionId: string }).sessionId;

      if (!validateTeamParentSession({ userId: user.sub, teamParentSessionId: sessionId })) {
        step.fail('session not found');
        return reply.status(404).send(teamHandoffRouteErrorPayload('team_session_not_found'));
      }

      // §0.159: 默认上限 200，避免长寿团队会话(数千 handoff)在单次请求里
      // 把整张 SQLite 行集 + JSON 序列化吞进网关内存。客户端可显式 ?limit=N 在 1..500 区间内调整。
      const rawLimit = (request.query as { limit?: string } | undefined)?.limit;
      let limit = 200;
      if (typeof rawLimit === 'string' && rawLimit.length > 0) {
        const parsed = Number.parseInt(rawLimit, 10);
        if (!Number.isFinite(parsed) || parsed < 1 || parsed > 500) {
          step.fail('invalid limit');
          return reply.status(400).send(teamHandoffRouteErrorPayload('team_handoff_invalid_limit'));
        }
        limit = parsed;
      }
      const records = listHandoffsBySession({ userId: user.sub, sessionId, limit });
      step.succeed(undefined, { sessionId, count: records.length, limit });
      return reply.send({ handoffs: records, limit });
    },
  );

  app.post(
    '/team/handoffs/:handoffId/review-actions/:action',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'team.handoffs.review-action');
      const user = request.user as JwtPayload;
      const params = parseParams(reviewActionParamsSchema, request.params);
      const { action, handoffId } = params;

      const record = getHandoff({ userId: user.sub, handoffId });
      if (!record) {
        step.fail('not found');
        return reply.status(404).send(teamHandoffRouteErrorPayload('team_handoff_not_found'));
      }
      if (record.toRoleLayer !== 'pm2') {
        step.fail('not pm2 handoff');
        return reply
          .status(409)
          .send(teamHandoffRouteErrorPayload('team_handoff_review_requires_pm2'));
      }

      if (action === 'redispatch') {
        const didRetry =
          record.state === 'running'
            ? retryRunningHandoffById(record.id)
            : forceRetryFailedPm2Handoff({ handoffId: record.id, userId: user.sub });
        if (!didRetry) {
          step.fail('cannot redispatch');
          return reply
            .status(409)
            .send(teamHandoffRouteErrorPayload('team_handoff_cannot_redispatch'));
        }
        const updated = getHandoff({ userId: user.sub, handoffId });
        if (updated) {
          publishHandoffEvent({ type: 'handoff.reclaimed', record: updated });
        }
        logHandoffControl({
          action: 'resume',
          actorEmail: user.email,
          actorUserId: user.sub,
          reason: 'manual-review-redispatch',
          record,
        });
        step.succeed(undefined, { action, handoffId });
        return reply.send({
          action,
          handoffId,
          handoffs: updated ? [updated] : [],
        });
      }

      if (action === 'return-to-c') {
        const replay = replayPm1FromPm2Failure({ handoffId: record.id, userId: user.sub });
        if (!replay) {
          step.fail('cannot return to c');
          return reply
            .status(409)
            .send(teamHandoffRouteErrorPayload('team_handoff_cannot_return_to_pm1'));
        }
        markReviewDispositionHandled({
          action,
          handoffId: record.id,
          userId: user.sub,
        });
        publishHandoffEvent({ type: 'handoff.created', record: replay });
        const updated = getHandoff({ userId: user.sub, handoffId });
        if (updated) {
          publishHandoffEvent({
            type: 'handoff.failed',
            record: updated,
            payload: { reason: updated.failureReason },
          });
        }
        await appendPm2SystemMessage({
          sessionId: record.toSessionId,
          userId: user.sub,
          text: '↩️ 已根据用户决定重新派发 PM1，请基于更新后的规划继续推进。',
        });
        logHandoffControl({
          action: 'resume',
          actorEmail: user.email,
          actorUserId: user.sub,
          reason: 'manual-review-return-to-c',
          record,
        });
        step.succeed(undefined, { action, createdHandoffId: replay.id, handoffId });
        return reply.send({
          action,
          createdHandoffId: replay.id,
          handoffId,
          handoffs: [updated, replay].filter((entry) => entry !== undefined),
        });
      }

      markReviewDispositionHandled({
        action,
        handoffId: record.id,
        userId: user.sub,
      });
      const updated = getHandoff({ userId: user.sub, handoffId });
      if (updated) {
        publishHandoffEvent({
          type: 'handoff.failed',
          record: updated,
          payload: { reason: updated.failureReason },
        });
      }
      await appendPm2SystemMessage({
        sessionId: record.toSessionId,
        userId: user.sub,
        text: '🧑 用户已确认接管当前评审失败，请按新的指令或补充约束继续处理。',
      });
      logHandoffControl({
        action: 'resume',
        actorEmail: user.email,
        actorUserId: user.sub,
        reason: 'manual-review-escalate-to-user',
        record,
      });
      step.succeed(undefined, { action, handoffId });
      return reply.send({
        action,
        handoffId,
        handoffs: updated ? [updated] : [],
      });
    },
  );

  app.post(
    '/team/handoffs/:handoffId/cancel',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'team.handoffs.cancel');
      const user = request.user as JwtPayload;
      const handoffId = (request.params as { handoffId: string }).handoffId;

      const before = getHandoff({ userId: user.sub, handoffId });
      if (!before) {
        step.fail('not found');
        return reply.status(404).send(teamHandoffRouteErrorPayload('team_handoff_not_found'));
      }
      const ok = cancelHandoff({ userId: user.sub, handoffId });
      if (!ok) {
        step.fail(`cannot cancel from state ${before.state}`);
        return reply.status(409).send(
          teamHandoffRouteErrorPayload('team_handoff_cannot_cancel', {
            state: before.state,
          }),
        );
      }
      const after = getHandoff({ userId: user.sub, handoffId });
      if (after) {
        // 同时把 to_session 的 substate 推到 'cancelled'，让前端进度条立刻反映终态
        if (after.toSessionId) {
          try {
            setSubstate({
              sessionId: after.toSessionId,
              substate: 'cancelled',
              userId: after.userId,
              roleLayer: after.toRoleLayer,
            });
          } catch (e) {
            console.warn(
              `[team-handoffs] setSubstate('cancelled') 失败：${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }
        injectControlSignal({
          action: 'cancel',
          messageType: 'cancel_signal',
          reason: 'user-cancelled',
          record: after,
        });
        logHandoffControl({
          action: 'cancel',
          actorEmail: user.email,
          actorUserId: user.sub,
          reason: 'user-cancelled',
          record: after,
        });
        publishHandoffEvent({ type: 'handoff.cancelled', record: after });

        // 级联取消：取消本 handoff 派生出的整棵下游子树（rooted at toSessionId），
        // 否则取消上游后下游的 executor/reviewer 仍会继续跑、继续烧 token。对每个
        // 被取消的下游 handoff 注入 cancel_signal（team-stream-control gate 会在
        // 下个 round 边界中止），并 stop 其 in-flight 流让已在跑的 LLM 立即收尾。
        if (after.toSessionId) {
          try {
            await cascadeCancelDownstream({
              rootSessionId: after.toSessionId,
              userId: user.sub,
              excludeHandoffId: after.id,
            });
          } catch (e) {
            console.warn(
              `[team-handoffs] cancel 级联下游失败（不阻塞主流程）：${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }
      }
      step.succeed(undefined, { handoffId });
      return reply.send({ handoff: after });
    },
  );

  app.post(
    '/team/handoffs/:handoffId/pause',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'team.handoffs.pause');
      const user = request.user as JwtPayload;
      const handoffId = (request.params as { handoffId: string }).handoffId;

      const parseStep = child('parse-body');
      const body = parseBody(pauseHandoffSchema, request.body ?? {});
      parseStep.succeed();

      const before = getHandoff({ userId: user.sub, handoffId });
      if (!before) {
        step.fail('not found');
        return reply.status(404).send(teamHandoffRouteErrorPayload('team_handoff_not_found'));
      }

      const ok = pauseHandoff({
        userId: user.sub,
        handoffId,
        reason: body.reason ?? null,
      });
      if (!ok) {
        step.fail(`cannot pause from state ${before.state}`);
        return reply.status(409).send(
          teamHandoffRouteErrorPayload('team_handoff_cannot_pause', {
            state: before.state,
            paused: before.paused,
          }),
        );
      }

      const after = getHandoff({ userId: user.sub, handoffId });
      if (after) {
        injectControlSignal({
          action: 'pause',
          messageType: 'pause_signal',
          reason: body.reason ?? null,
          record: after,
        });
        publishSchedulerControlEvent({
          type: 'scheduler.task-paused',
          reason: body.reason ?? null,
          record: after,
        });
        logHandoffControl({
          action: 'pause',
          actorEmail: user.email,
          actorUserId: user.sub,
          reason: body.reason ?? null,
          record: after,
        });
      }

      step.succeed(undefined, { handoffId, paused: true });
      return reply.send({ handoff: after });
    },
  );

  app.post(
    '/team/handoffs/:handoffId/resume',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'team.handoffs.resume');
      const user = request.user as JwtPayload;
      const handoffId = (request.params as { handoffId: string }).handoffId;

      const before = getHandoff({ userId: user.sub, handoffId });
      if (!before) {
        step.fail('not found');
        return reply.status(404).send(teamHandoffRouteErrorPayload('team_handoff_not_found'));
      }

      const ok = resumeHandoff({ userId: user.sub, handoffId });
      if (!ok) {
        step.fail(`cannot resume from state ${before.state}`);
        return reply.status(409).send(
          teamHandoffRouteErrorPayload('team_handoff_cannot_resume', {
            state: before.state,
            paused: before.paused,
          }),
        );
      }

      const after = getHandoff({ userId: user.sub, handoffId });
      if (after) {
        injectControlSignal({
          action: 'resume',
          messageType: 'resume_signal',
          record: after,
        });
        publishSchedulerControlEvent({
          type: 'scheduler.task-resumed',
          record: after,
        });
        logHandoffControl({
          action: 'resume',
          actorEmail: user.email,
          actorUserId: user.sub,
          record: after,
        });
      }

      step.succeed(undefined, { handoffId, paused: false });
      return reply.send({ handoff: after });
    },
  );

  app.post(
    '/team/sessions/:sessionId/pause-all',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'team.sessions.pause-all');
      const user = request.user as JwtPayload;
      const sessionId = (request.params as { sessionId: string }).sessionId;

      const parseStep = child('parse-body');
      const body = parseBody(pauseHandoffSchema, request.body ?? {});
      parseStep.succeed();

      const result = pauseTeamRuntimeTree({
        reason: body.reason ?? null,
        rootSessionId: sessionId,
        userId: user.sub,
      });
      if (!result) {
        step.fail('root session not found');
        return reply.status(404).send(teamHandoffRouteErrorPayload('team_session_not_found'));
      }

      for (const handoffId of result.pausedHandoffIds) {
        // Per-handoff resilience: the tree state was already committed
        // atomically by pauseTeamRuntimeTree above; this loop only fans out
        // control signals + scheduler events. A throw on one handoff (e.g.
        // getHandoff SQLite error) must not abort the loop and skip the
        // aggregate all-paused event + audit log + HTTP reply below — that
        // would 500 a pause that already took effect and leave the UI without
        // the terminal notification. Isolate per handoff + warn.
        try {
          const after = getHandoff({ userId: user.sub, handoffId });
          if (!after) {
            continue;
          }
          injectControlSignal({
            action: 'pause',
            messageType: 'pause_signal',
            reason: body.reason ?? null,
            record: after,
          });
          publishSchedulerControlEvent({
            type: 'scheduler.task-paused',
            reason: body.reason ?? null,
            record: after,
          });
        } catch (err) {
          console.warn(
            `[team-handoffs] pause-all 派发 handoff ${handoffId} 控制信号失败，跳过继续：${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }

      publishSchedulerAllControlEvent({
        handoffIds: result.pausedHandoffIds,
        reason: body.reason ?? null,
        rootRoleLayer: result.rootRoleLayer,
        rootSessionId: result.rootSessionId,
        sessionIds: result.pausedSessionIds,
        type: 'scheduler.all-paused',
        userId: user.sub,
        ...runtimeScopeTruncationFields(result),
      });
      logSessionTreeControl({
        action: 'pause-all',
        actorEmail: user.email,
        actorUserId: user.sub,
        handoffIds: result.pausedHandoffIds,
        reason: body.reason ?? null,
        rootSessionId: result.rootSessionId,
        sessionIds: result.pausedSessionIds,
        userId: user.sub,
        ...runtimeScopeTruncationFields(result),
      });

      step.succeed(undefined, {
        pausedHandoffCount: result.pausedHandoffIds.length,
        pausedSessionCount: result.pausedSessionIds.length,
        sessionId,
        ...runtimeScopeTruncationFields(result),
      });
      return reply.send({
        handoffIds: result.pausedHandoffIds,
        pausedHandoffCount: result.pausedHandoffIds.length,
        pausedSessionCount: result.pausedSessionIds.length,
        sessionIds: result.pausedSessionIds,
        sessionId: result.rootSessionId,
        ...runtimeScopeTruncationFields(result),
      });
    },
  );

  app.post(
    '/team/sessions/:sessionId/resume-all',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'team.sessions.resume-all');
      const user = request.user as JwtPayload;
      const sessionId = (request.params as { sessionId: string }).sessionId;

      // ── 阶段 1：恢复前一致性校验 ────────────────────────────────────
      // 修复 orphan session、zombie handoff、duplicate handoff、stale heartbeat、stuck running
      let consistencyReport: ReturnType<typeof preResumeConsistencyCheck> | null = null;
      try {
        consistencyReport = preResumeConsistencyCheck({
          rootSessionId: sessionId,
          userId: user.sub,
        });
      } catch (err) {
        console.warn(
          `[team-handoffs] resume-all 一致性校验失败（不阻塞恢复）：${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }

      // ── 阶段 2：分层恢复（按 substate 决定恢复动作） ────────────────
      const result = resumeTeamRuntimeTree({
        rootSessionId: sessionId,
        userId: user.sub,
      });
      if (!result) {
        step.fail('root session not found');
        return reply.status(404).send(teamHandoffRouteErrorPayload('team_session_not_found'));
      }

      // ── 阶段 3a：自底向上注入 resume_signal ──────────────────────────
      // 按 role_layer 深度降序排列（executor/reviewer 先恢复，reception 最后）
      const layerOrder: Record<string, number> = {
        executor: 0,
        reviewer: 1,
        pm2: 2,
        pm1: 3,
        reception: 4,
      };
      const sortedHandoffIds = [...result.resumedHandoffIds].sort((a, b) => {
        const ha = getHandoff({ userId: user.sub, handoffId: a });
        const hb = getHandoff({ userId: user.sub, handoffId: b });
        const layerA = ha?.toRoleLayer ?? 'unknown';
        const layerB = hb?.toRoleLayer ?? 'unknown';
        return (layerOrder[layerA] ?? 99) - (layerOrder[layerB] ?? 99);
      });

      for (const handoffId of sortedHandoffIds) {
        // Per-handoff resilience: the resume tree state is already committed;
        // one handoff's control-signal fan-out throwing must not abort the
        // aggregate all-resumed event + audit + reply.
        try {
          const after = getHandoff({ userId: user.sub, handoffId });
          if (!after) {
            continue;
          }
          injectControlSignal({
            action: 'resume',
            messageType: 'resume_signal',
            record: after,
          });
          publishSchedulerControlEvent({
            type: 'scheduler.task-resumed',
            record: after,
          });
        } catch (err) {
          console.warn(
            `[team-handoffs] resume-all 派发 handoff ${handoffId} 控制信号失败，跳过继续：${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }

      // ── 阶段 3b：对用户阻塞态 session 的提示消息已在 resumeTeamRuntimeTree 中写入 ──

      publishSchedulerAllControlEvent({
        handoffIds: result.resumedHandoffIds,
        rootRoleLayer: result.rootRoleLayer,
        rootSessionId: result.rootSessionId,
        sessionIds: result.resumedSessionIds,
        staleSessionCount: result.staleSessionCount,
        type: 'scheduler.all-resumed',
        userId: user.sub,
        ...runtimeScopeTruncationFields(result),
      });
      logSessionTreeControl({
        action: 'resume-all',
        actorEmail: user.email,
        actorUserId: user.sub,
        handoffIds: result.resumedHandoffIds,
        rootSessionId: result.rootSessionId,
        sessionIds: result.resumedSessionIds,
        staleSessionCount: result.staleSessionCount,
        userId: user.sub,
        ...runtimeScopeTruncationFields(result),
      });

      // ── 阶段 4：评估恢复模式 + 精准后台续跑 ──────────────────────────
      // 不再只续跑根 session，而是根据恢复模式精准定位到需要续跑的层
      let resumeMode: string = 'signal-only';
      let backgroundRerunTarget: { sessionId: string; roleLayer: string | null } | null = null;

      if (result.resumedHandoffIds.length > 0 || result.resumedSessionIds.length > 0) {
        // 收集子树中各 session 的 role_layer 映射
        const sessionRoleLayers = new Map<string, string | null>();
        if (result.treeSessionIds.length > 0) {
          try {
            const roleRows = sqliteAll<{ id: string; role_layer: string | null }>(
              `SELECT id, role_layer FROM sessions WHERE id IN (${result.treeSessionIds.map(() => '?').join(', ')}) AND user_id = ?`,
              [...result.treeSessionIds, user.sub],
            );
            for (const row of roleRows) {
              sessionRoleLayers.set(row.id, row.role_layer);
            }
          } catch {
            // best-effort
          }
        }

        // 收集有 in-flight 流的 session
        const inFlightSessionIds = new Set<string>();
        for (const sid of result.treeSessionIds) {
          if (getAnyInFlightStreamRequestForSession({ sessionId: sid, userId: user.sub })) {
            inFlightSessionIds.add(sid);
          }
        }

        const assessment = assessTeamResumeMode({
          rootSessionId: result.rootSessionId,
          userId: user.sub,
          consistencyFixCount: consistencyReport?.totalFixes ?? 0,
          inFlightSessionIds,
          nonTerminalPausedSessionIds: result.resumedSessionIds,
        });

        resumeMode = assessment.mode;

        backgroundRerunTarget = resolveBackgroundRerunTarget({
          assessment,
          rootSessionId: result.rootSessionId,
          sessionRoleLayers,
        });

        if (backgroundRerunTarget) {
          // 精准续跑目标层，而非根 session
          const hasInFlight = hasInFlightTeamRuntime({
            sessionIds: [backgroundRerunTarget.sessionId],
            userId: user.sub,
          });
          if (!hasInFlight) {
            void runSessionInBackground({
              requestData: buildTeamResumeBackgroundRequestData({
                rootSessionId: result.rootSessionId,
              }),
              sessionId: backgroundRerunTarget.sessionId,
              teamResumeRootSessionId: result.rootSessionId,
              userId: user.sub,
            }).catch((error: unknown) => {
              console.warn(
                `[team-handoffs] resume-all 精准后台续跑失败（${backgroundRerunTarget!.roleLayer}）：${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            });
          }
        } else if (result.resumedHandoffIds.length > 0 || result.resumedSessionIds.length > 0) {
          // 兜底：如果精准续跑未定位到目标，但确实有恢复的 handoff/session，
          // 回退到原来的全树续跑逻辑
          triggerTeamResumeBackgroundRun({
            rootSessionId: result.rootSessionId,
            sessionIds: result.treeSessionIds,
            userId: user.sub,
          });
        }
      }

      step.succeed(undefined, {
        resumedHandoffCount: result.resumedHandoffIds.length,
        resumedSessionCount: result.resumedSessionIds.length,
        sessionId,
        staleSessionCount: result.staleSessionCount,
        consistencyFixCount: consistencyReport?.totalFixes ?? 0,
        resumeMode,
        ...runtimeScopeTruncationFields(result),
      });
      return reply.send({
        resumedHandoffCount: result.resumedHandoffIds.length,
        resumedSessionCount: result.resumedSessionIds.length,
        sessionId: result.rootSessionId,
        sessionIds: result.resumedSessionIds,
        staleSessionCount: result.staleSessionCount,
        handoffIds: result.resumedHandoffIds,
        // 新增字段：分层恢复信息
        skippedSessionCount: result.skippedSessionIds.length,
        userBlockedSessionCount: result.userBlockedSessionIds.length,
        userBlockedSessionIds: result.userBlockedSessionIds,
        skippedSessionIds: result.skippedSessionIds,
        layerResumeDetails: result.layerResumeDetails,
        // 新增字段：一致性校验报告
        consistencyFixCount: consistencyReport?.totalFixes ?? 0,
        consistencyFixes: consistencyReport?.fixes ?? [],
        // 新增字段：恢复模式
        resumeMode,
        backgroundRerunTarget: backgroundRerunTarget
          ? {
              sessionId: backgroundRerunTarget.sessionId,
              roleLayer: backgroundRerunTarget.roleLayer,
            }
          : null,
        ...runtimeScopeTruncationFields(result),
      });
    },
  );

  // ─── Artifact Chain 查询（Phase C） ─────────────────────────────────────

  app.get(
    '/team/artifacts',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'team.artifacts.list');
      const user = request.user as JwtPayload;
      const query = request.query as Record<string, string | undefined>;
      const phase = query['phase'] ?? null;
      const teamWorkspaceId = query['teamWorkspaceId'] ?? null;
      const sessionId = query['sessionId'] ?? null;

      const conditions: string[] = ['user_id = ?'];
      const params: Array<string | null> = [user.sub];

      if (phase) {
        conditions.push('phase = ?');
        params.push(phase);
      }
      if (teamWorkspaceId) {
        conditions.push('team_workspace_id = ?');
        params.push(teamWorkspaceId);
      }
      if (sessionId) {
        conditions.push('session_id = ?');
        params.push(sessionId);
      }

      const rows = sqliteAll<{
        id: string;
        session_id: string;
        type: string;
        title: string;
        content: string;
        version: number;
        phase: string | null;
        team_workspace_id: string | null;
        parent_artifact_id: string | null;
        created_at: string;
        updated_at: string;
      }>(
        `SELECT id, session_id, type, title, content, version, phase,
                team_workspace_id, parent_artifact_id, created_at, updated_at
         FROM artifacts
         WHERE ${conditions.join(' AND ')}
         ORDER BY created_at DESC
         LIMIT 50`,
        params,
      );

      const artifacts = rows.map((row) => ({
        id: row.id,
        sessionId: row.session_id,
        type: row.type,
        title: row.title,
        content: row.content,
        version: row.version,
        phase: row.phase,
        teamWorkspaceId: row.team_workspace_id,
        parentArtifactId: row.parent_artifact_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));

      step.succeed(undefined, { count: artifacts.length });
      return reply.send({ artifacts });
    },
  );
}

async function appendPm2SystemMessage(input: {
  sessionId: string | null;
  text: string;
  userId: string;
}): Promise<void> {
  if (!input.sessionId) {
    return;
  }
  try {
    const { appendSessionMessageV2 } = await import('../message/message-v2-adapter.js');
    appendSessionMessageV2({
      sessionId: input.sessionId,
      userId: input.userId,
      role: 'assistant',
      agentId: 'zeus',
      content: [{ type: 'text', text: input.text }],
    });
  } catch (err) {
    console.warn(
      `[team-handoffs] append pm2 system message failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function forceRetryFailedPm2Handoff(input: { handoffId: string; userId: string }): boolean {
  const row = sqliteGet<{ payload_json: string; state: string; to_role_layer: string }>(
    `SELECT state, to_role_layer, payload_json FROM handoff_records WHERE id = ? AND user_id = ? LIMIT 1`,
    [input.handoffId, input.userId],
  );
  if (!row || row.state !== 'failed' || row.to_role_layer !== 'pm2') {
    return false;
  }
  const payload = (() => {
    try {
      const parsed = JSON.parse(row.payload_json) as unknown;
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const record = { ...(parsed as Record<string, unknown>) };
        delete record['reviewDispositionHandledAction'];
        delete record['reviewDispositionHandledAt'];
        return record;
      }
    } catch {
      // ignore malformed payload and fall back to empty object
    }
    return {};
  })();
  sqliteRun(
    `UPDATE handoff_records
       SET state = 'pending',
           failure_reason = NULL,
           claim_token = NULL,
           claimed_at = NULL,
           started_at = NULL,
           completed_at = NULL,
           to_session_id = NULL,
           payload_json = ?,
           retry_count = retry_count + 1,
           updated_at = datetime('now')
     WHERE id = ? AND user_id = ? AND state = 'failed'`,
    [JSON.stringify(payload), input.handoffId, input.userId],
  );
  return true;
}

function replayPm1FromPm2Failure(input: {
  handoffId: string;
  userId: string;
}): HandoffRecord | null {
  const pm2Row = sqliteGet<{
    from_session_id: string;
  }>(
    `SELECT from_session_id
       FROM handoff_records
      WHERE id = ? AND user_id = ? AND to_role_layer = 'pm2'
      LIMIT 1`,
    [input.handoffId, input.userId],
  );
  if (!pm2Row) {
    return null;
  }

  const upstream = sqliteGet<{
    from_role_layer: string;
    from_session_id: string;
    payload_json: string;
  }>(
    `SELECT from_role_layer, from_session_id, payload_json
       FROM handoff_records
      WHERE user_id = ?
        AND to_role_layer = 'pm1'
        AND to_session_id = ?
      ORDER BY created_at DESC
      LIMIT 1`,
    [input.userId, pm2Row.from_session_id],
  );
  if (!upstream) {
    return null;
  }

  const payload = (() => {
    try {
      return JSON.parse(upstream.payload_json) as unknown;
    } catch {
      return {};
    }
  })();

  return createHandoff({
    userId: input.userId,
    fromSessionId: upstream.from_session_id,
    fromRoleLayer: upstream.from_role_layer as HandoffRoleLayer,
    toRoleLayer: 'pm1',
    payload,
  });
}

function markReviewDispositionHandled(input: {
  action: 'return-to-c' | 'escalate-to-user';
  handoffId: string;
  userId: string;
}): void {
  const row = sqliteGet<{ payload_json: string }>(
    `SELECT payload_json FROM handoff_records WHERE id = ? AND user_id = ? LIMIT 1`,
    [input.handoffId, input.userId],
  );
  const payload = (() => {
    try {
      const parsed = row?.payload_json ? JSON.parse(row.payload_json) : {};
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  })();
  if (isHandledReviewFailurePayload(payload)) {
    return;
  }
  sqliteRun(
    `UPDATE handoff_records
        SET payload_json = ?,
            updated_at = datetime('now')
      WHERE id = ? AND user_id = ?`,
    [
      JSON.stringify({
        ...mergeReviewDispositionIntoPayload(payload, {
          action:
            getReviewDispositionFromPayload(payload)?.action ??
            (input.action === 'return-to-c' ? 'return-to-c' : 'escalate-to-user'),
          reason:
            getReviewDispositionFromPayload(payload)?.reason ??
            (input.action === 'return-to-c' ? '用户确认退回 PM1 重规划' : '用户确认自行接管'),
          status: 'handled',
          updatedAtMs: Date.now(),
        }),
        reviewDispositionHandledAction: input.action,
        reviewDispositionHandledAt: Date.now(),
      }),
      input.handoffId,
      input.userId,
    ],
  );
}
