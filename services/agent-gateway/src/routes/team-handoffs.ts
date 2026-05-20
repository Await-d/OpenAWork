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
import { sqliteAll } from '../infra/db.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import {
  cancelHandoff,
  createHandoff,
  getHandoff,
  listHandoffsBySession,
  type HandoffRoleLayer,
} from '../handoff/store/handoff-store.js';
import { publishHandoffEvent } from '../handoff/bus/team-events-bus.js';
import {
  createTeamSession,
  validateTeamParentSession,
} from '../handoff/bus/team-session-create.js';
import { submitInboundMessage } from '../handoff/store/inbound-store.js';
import { setSubstate } from '../handoff/store/substate-store.js';
import { parseBody } from '../infra/parse-request.js';

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
          return reply.status(404).send({ error: 'team parent session not found' });
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
        return reply.status(404).send({ error: 'fromSessionId not found' });
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
        return reply.status(404).send({ error: 'Handoff not found' });
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

      const records = listHandoffsBySession({ userId: user.sub, sessionId });
      step.succeed(undefined, { sessionId, count: records.length });
      return reply.send({ handoffs: records });
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
        return reply.status(404).send({ error: 'Handoff not found' });
      }
      const ok = cancelHandoff({ userId: user.sub, handoffId });
      if (!ok) {
        step.fail(`cannot cancel from state ${before.state}`);
        return reply.status(409).send({
          error: 'cannot-cancel',
          state: before.state,
        });
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

          // 注入 cancel_signal 到 inbound queue，让正在跑的 runner（artifact-chain
          // / pm2-runner）能在下一轮检查时主动退出，而不是等到自然结束
          try {
            submitInboundMessage({
              userId: after.userId,
              toSessionId: after.toSessionId,
              fromRoleLayer: 'system',
              messageType: 'cancel_signal',
              payload: { reason: 'user-cancelled', handoffId: after.id },
            });
          } catch (e) {
            console.warn(
              `[team-handoffs] cancel_signal 注入失败：${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }
        publishHandoffEvent({ type: 'handoff.cancelled', record: after });
      }
      step.succeed(undefined, { handoffId });
      return reply.send({ handoff: after });
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
