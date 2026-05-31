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
import { pauseTeamRuntimeTree, resumeTeamRuntimeTree } from '../team/team-runtime-control-store.js';

const TEAM_ROLE_LAYERS = ['user', 'reception', 'pm1', 'pm2', 'executor', 'reviewer'] as const;

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

function publishSchedulerAllControlEvent(input: {
  handoffIds: string[];
  reason?: string | null;
  rootRoleLayer?: string | null;
  sessionIds: string[];
  staleSessionCount?: number;
  type: 'scheduler.all-paused' | 'scheduler.all-resumed';
  userId: string;
  rootSessionId: string;
}): void {
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
    },
  });
}

function logSessionTreeControl(input: {
  action: 'pause-all' | 'resume-all';
  actorEmail?: string;
  actorUserId: string;
  handoffIds: string[];
  reason?: string | null;
  rootSessionId: string;
  sessionIds: string[];
  staleSessionCount?: number;
  userId: string;
}): void {
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
      }),
      entityId: input.rootSessionId,
      entityType: 'session',
      summary: `team ${input.action}: ${input.rootSessionId.slice(0, 8)} sessions=${input.sessionIds.length} handoffs=${input.handoffIds.length}`,
      userId: input.userId,
    });
  } catch (err) {
    console.warn(
      `[team-handoffs] audit(${input.action}) 失败：${err instanceof Error ? err.message : String(err)}`,
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
      });

      step.succeed(undefined, {
        pausedHandoffCount: result.pausedHandoffIds.length,
        pausedSessionCount: result.pausedSessionIds.length,
        sessionId,
      });
      return reply.send({
        handoffIds: result.pausedHandoffIds,
        pausedHandoffCount: result.pausedHandoffIds.length,
        pausedSessionCount: result.pausedSessionIds.length,
        sessionIds: result.pausedSessionIds,
        sessionId: result.rootSessionId,
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

      const result = resumeTeamRuntimeTree({
        rootSessionId: sessionId,
        userId: user.sub,
      });
      if (!result) {
        step.fail('root session not found');
        return reply.status(404).send(teamHandoffRouteErrorPayload('team_session_not_found'));
      }

      for (const handoffId of result.resumedHandoffIds) {
        // Per-handoff resilience: see pause-all above. The resume tree state is
        // already committed; one handoff's control-signal fan-out throwing must
        // not abort the aggregate all-resumed event + audit + reply.
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

      publishSchedulerAllControlEvent({
        handoffIds: result.resumedHandoffIds,
        rootRoleLayer: result.rootRoleLayer,
        rootSessionId: result.rootSessionId,
        sessionIds: result.resumedSessionIds,
        staleSessionCount: result.staleSessionCount,
        type: 'scheduler.all-resumed',
        userId: user.sub,
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
      });

      step.succeed(undefined, {
        resumedHandoffCount: result.resumedHandoffIds.length,
        resumedSessionCount: result.resumedSessionIds.length,
        sessionId,
        staleSessionCount: result.staleSessionCount,
      });
      return reply.send({
        resumedHandoffCount: result.resumedHandoffIds.length,
        resumedSessionCount: result.resumedSessionIds.length,
        sessionId: result.rootSessionId,
        sessionIds: result.resumedSessionIds,
        staleSessionCount: result.staleSessionCount,
        handoffIds: result.resumedHandoffIds,
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
