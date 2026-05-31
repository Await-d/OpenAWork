/**
 * team-init routes · 团队会话「初始化阶段」控制端点
 *
 * 配套 team/init/* 模块：
 *   - GET    /team/sessions/:sessionId/init                 读取初始化标记
 *   - POST   /team/sessions/:sessionId/init/steps/:stepKey/confirm  确认并执行某步
 *   - POST   /team/sessions/:sessionId/init/steps/:stepKey/skip     跳过某步
 *   - POST   /team/sessions/:sessionId/init/skip            跳过整个初始化阶段
 *
 * 执行后通过 team-events WS 推送 'session.init.changed'，前端据此 reload。
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { TEAM_INIT_STEP_ORDER, type TeamInitStepKey } from '@openAwork/shared';
import type { JwtPayload } from '../infra/auth.js';
import { requireAuth } from '../infra/auth.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import { publishTeamEvent } from '../handoff/bus/team-events-bus.js';
import {
  loadTeamInitSessionContext,
  markTeamInitSkipped,
  updateTeamInitStep,
} from '../team/init/team-init-store.js';
import { runTeamInitStep } from '../team/init/team-init-runner.js';

type TeamInitRouteErrorCode =
  | 'team_session_not_found'
  | 'team_init_not_found'
  | 'team_init_step_not_found'
  | 'team_init_step_failed';

const TEAM_INIT_ROUTE_ERROR_MESSAGES: Record<TeamInitRouteErrorCode, string> = {
  team_session_not_found: '目标团队会话不存在。',
  team_init_not_found: '该会话没有初始化清单。',
  team_init_step_not_found: '目标初始化步骤不存在。',
  team_init_step_failed: '初始化步骤执行失败。',
};

function teamInitRouteErrorPayload(
  code: TeamInitRouteErrorCode,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return { code, error: TEAM_INIT_ROUTE_ERROR_MESSAGES[code], ...(extra ?? {}) };
}

function isValidStepKey(value: string): value is TeamInitStepKey {
  return (TEAM_INIT_STEP_ORDER as string[]).includes(value);
}

export async function teamInitRoutes(app: FastifyInstance): Promise<void> {
  // ─── 读取初始化标记 ───────────────────────────────────────────────────────
  app.get(
    '/team/sessions/:sessionId/init',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const sessionId = (request.params as { sessionId: string }).sessionId;
      const user = request.user as JwtPayload;
      const ctx = loadTeamInitSessionContext(sessionId, user.sub);
      if (!ctx) {
        return reply.status(404).send(teamInitRouteErrorPayload('team_session_not_found'));
      }
      return reply.status(200).send({ teamInit: ctx.teamInit });
    },
  );

  // ─── 确认并执行某步 ───────────────────────────────────────────────────────
  app.post(
    '/team/sessions/:sessionId/init/steps/:stepKey/confirm',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { sessionId, stepKey } = request.params as { sessionId: string; stepKey: string };
      const { step } = startRequestWorkflow(request, 'team.session.init.confirm', undefined, {
        sessionId,
        stepKey,
      });
      const user = request.user as JwtPayload;

      if (!isValidStepKey(stepKey)) {
        step.fail('invalid step key');
        return reply.status(404).send(teamInitRouteErrorPayload('team_init_step_not_found'));
      }

      const ctx = loadTeamInitSessionContext(sessionId, user.sub);
      if (!ctx) {
        step.fail('session not found');
        return reply.status(404).send(teamInitRouteErrorPayload('team_session_not_found'));
      }
      if (!ctx.teamInit) {
        step.fail('init not found');
        return reply.status(404).send(teamInitRouteErrorPayload('team_init_not_found'));
      }
      if (!ctx.teamInit.steps.some((s) => s.key === stepKey)) {
        step.fail('step not found');
        return reply.status(404).send(teamInitRouteErrorPayload('team_init_step_not_found'));
      }

      const result = await runTeamInitStep({ sessionId, userId: user.sub, stepKey });
      if (!result.ok) {
        step.fail(result.reason ?? 'step failed');
        // 即便执行失败，state 也已写回（status=failed），让前端能展示错误并重试。
        publishInitChanged(user.sub, sessionId, stepKey);
        return reply.status(500).send(
          teamInitRouteErrorPayload('team_init_step_failed', {
            reason: result.reason,
            teamInit: result.state ?? ctx.teamInit,
          }),
        );
      }

      step.succeed(undefined, { sessionId, stepKey });
      publishInitChanged(user.sub, sessionId, stepKey);
      return reply.status(200).send({ teamInit: result.state });
    },
  );

  // ─── 跳过某步 ─────────────────────────────────────────────────────────────
  app.post(
    '/team/sessions/:sessionId/init/steps/:stepKey/skip',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { sessionId, stepKey } = request.params as { sessionId: string; stepKey: string };
      const user = request.user as JwtPayload;

      if (!isValidStepKey(stepKey)) {
        return reply.status(404).send(teamInitRouteErrorPayload('team_init_step_not_found'));
      }
      const ctx = loadTeamInitSessionContext(sessionId, user.sub);
      if (!ctx) {
        return reply.status(404).send(teamInitRouteErrorPayload('team_session_not_found'));
      }
      if (!ctx.teamInit) {
        return reply.status(404).send(teamInitRouteErrorPayload('team_init_not_found'));
      }

      const state = updateTeamInitStep(sessionId, user.sub, stepKey, (s) => ({
        ...s,
        status: 'skipped',
        completedAt: new Date().toISOString(),
      }));
      if (!state) {
        return reply.status(404).send(teamInitRouteErrorPayload('team_init_step_not_found'));
      }
      publishInitChanged(user.sub, sessionId, stepKey);
      return reply.status(200).send({ teamInit: state });
    },
  );

  // ─── 跳过整个初始化阶段 ────────────────────────────────────────────────────
  app.post(
    '/team/sessions/:sessionId/init/skip',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const sessionId = (request.params as { sessionId: string }).sessionId;
      const user = request.user as JwtPayload;

      const ctx = loadTeamInitSessionContext(sessionId, user.sub);
      if (!ctx) {
        return reply.status(404).send(teamInitRouteErrorPayload('team_session_not_found'));
      }
      if (!ctx.teamInit) {
        return reply.status(404).send(teamInitRouteErrorPayload('team_init_not_found'));
      }
      const state = markTeamInitSkipped(sessionId, user.sub);
      publishInitChanged(user.sub, sessionId, null);
      return reply.status(200).send({ teamInit: state });
    },
  );
}

function publishInitChanged(
  userId: string,
  sessionId: string,
  stepKey: TeamInitStepKey | null,
): void {
  try {
    publishTeamEvent({
      type: 'session.init.changed',
      sessionId,
      layer: 'reception',
      timestamp: Date.now(),
      payload: stepKey ? { stepKey } : {},
      userId,
    });
  } catch (err) {
    console.warn(
      `[team.session.init] publish event failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
