/**
 * 260515-team-phase-a · T-04 / T-05 / T-09 路由
 *
 * 集中提供 Phase A 新增的所有 HTTP 端点：
 *   - GET/PUT /team/workspaces/:teamWorkspaceId/constitution
 *   - GET/PUT /team/personas/:roleLayer
 *   - GET     /team/personas               （列出全部 5 层）
 *   - GET/PUT /team/user-memory
 *   - GET     /team/instruction-stack/preview （调试用，预览 7 层注入结果）
 *   - POST    /team/force-apply
 *   - GET     /team/force-apply/state
 *   - GET     /team/constitution-templates
 *   - GET     /team/soul-defaults
 *
 * 所有写入端点都强制经过 `scanMemoryWriteContent` 安全扫描；命中威胁
 * 模式时返回 400 + 详细 reason，便于前端 toast。
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { JwtPayload } from '../auth.js';
import { requireAuth } from '../auth.js';
import { sqliteGet } from '../db.js';
import { startRequestWorkflow } from '../request-workflow.js';
import { scanMemoryWriteContent, type MemoryWriteScanResult } from '../memory/memory-security-scanner.js';
import { getTeamConstitution, updateTeamConstitution } from '../team/team-constitution-store.js';
import {
  ensureDefaultPersonasForUser,
  getAgentPersona,
  isSoulRoleLayer,
  listAgentPersonas,
  resolveEffectiveSoul,
  upsertAgentPersona,
  VALID_SOUL_ROLE_LAYERS,
} from '../team/team-personas-store.js';
import { getUserMemory, updateUserMemory } from '../team/team-user-memory-store.js';
import { getForceApplyState, recordForceApply } from '../team/team-force-apply-store.js';
import { buildTeamInstructionStack } from '../team/team-instruction-stack.js';
import {
  CONSTITUTION_TEMPLATES,
  DEFAULT_SOULS,
  SOUL_ROLE_LAYER_ORDER,
} from '../team-phase-a-content/index.js';
import { resolveSessionWorkspacePath } from '../session/session-workspace-resolution.js';

const constitutionUpdateSchema = z.object({
  body: z.string().max(64 * 1024),
  expectedVersion: z.number().int().min(0),
});

const personaUpdateSchema = z.object({
  soulMd: z.string().max(64 * 1024),
  key: z.string().min(1).max(100).optional().default('default'),
});

const userMemoryUpdateSchema = z.object({
  body: z.string().max(64 * 1024),
});

const personaQuerySchema = z.object({
  key: z.string().min(1).max(100).optional().default('default'),
});

const instructionStackPreviewQuerySchema = z.object({
  teamWorkspaceId: z.string().min(1).optional(),
  roleLayer: z.string().optional(),
  personaKey: z.string().min(1).optional(),
  /**
   * 可选：指定一个已有 session id，用于复用其 workspace 路径解析逻辑。
   * 不传则不读取 git 文件层（AGENTS / architecture / project-memory / lessons-learned）。
   */
  sessionId: z.string().min(1).optional(),
});

interface SessionWorkspaceRow {
  id: string;
  metadata_json: string;
}

function failOnSecurity(
  reply: FastifyReply,
  result: MemoryWriteScanResult,
  field: string,
): FastifyReply {
  return reply.status(400).send({
    error: 'memory-write-blocked',
    field,
    threat: result.threat,
    reason: result.reason,
    sample: result.sample,
  });
}

export async function teamPhaseARoutes(app: FastifyInstance): Promise<void> {
  // ─── Constitution ───────────────────────────────────────────────────────

  app.get(
    '/team/workspaces/:teamWorkspaceId/constitution',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'team.constitution.get');
      const user = request.user as JwtPayload;
      const teamWorkspaceId = (request.params as { teamWorkspaceId: string }).teamWorkspaceId;

      const record = getTeamConstitution({ userId: user.sub, teamWorkspaceId });
      if (!record) {
        step.fail('workspace not found');
        return reply.status(404).send({ error: 'Workspace not found' });
      }
      step.succeed(undefined, { teamWorkspaceId, version: record.version });
      return reply.send(record);
    },
  );

  app.put(
    '/team/workspaces/:teamWorkspaceId/constitution',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'team.constitution.update');
      const user = request.user as JwtPayload;
      const teamWorkspaceId = (request.params as { teamWorkspaceId: string }).teamWorkspaceId;

      const parseStep = child('parse-body');
      const body = constitutionUpdateSchema.safeParse(request.body);
      if (!body.success) {
        parseStep.fail('invalid input');
        step.fail('invalid input');
        return reply.status(400).send({ error: 'Invalid input', issues: body.error.issues });
      }
      parseStep.succeed();

      const scanStep = child('security-scan');
      const scan = scanMemoryWriteContent(body.data.body);
      if (!scan.ok) {
        scanStep.fail(scan.reason ?? 'blocked');
        step.fail('security-scan-blocked');
        return failOnSecurity(reply, scan, 'body');
      }
      scanStep.succeed();

      const updateStep = child('update');
      const result = updateTeamConstitution({
        userId: user.sub,
        teamWorkspaceId,
        body: body.data.body,
        expectedVersion: body.data.expectedVersion,
      });
      if (!result.ok) {
        updateStep.fail(result.reason);
        step.fail(result.reason);
        if (result.reason === 'not-found') {
          return reply.status(404).send({ error: 'Workspace not found' });
        }
        return reply.status(409).send({
          error: 'version-conflict',
          currentVersion: result.currentVersion ?? null,
        });
      }
      updateStep.succeed();
      step.succeed(undefined, {
        teamWorkspaceId,
        version: result.record.version,
      });
      return reply.send(result.record);
    },
  );

  app.get(
    '/team/constitution-templates',
    { onRequest: [requireAuth] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.send({ templates: CONSTITUTION_TEMPLATES });
    },
  );

  // ─── Personas (SOUL) ────────────────────────────────────────────────────

  app.get(
    '/team/personas',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'team.personas.list');
      const user = request.user as JwtPayload;
      // 一次性确保默认 SOUL 已落库（幂等）
      ensureDefaultPersonasForUser(user.sub);

      const allPersonas = SOUL_ROLE_LAYER_ORDER.flatMap((roleLayer) =>
        listAgentPersonas({ userId: user.sub, roleLayer }),
      );
      step.succeed(undefined, { count: allPersonas.length });
      return reply.send({ personas: allPersonas });
    },
  );

  app.get(
    '/team/personas/:roleLayer',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'team.personas.get');
      const user = request.user as JwtPayload;
      const roleLayer = (request.params as { roleLayer: string }).roleLayer;

      if (!isSoulRoleLayer(roleLayer)) {
        step.fail('invalid role layer');
        return reply.status(400).send({
          error: 'invalid-role-layer',
          allowed: Array.from(VALID_SOUL_ROLE_LAYERS),
        });
      }

      const query = personaQuerySchema.safeParse(request.query ?? {});
      if (!query.success) {
        step.fail('invalid query');
        return reply.status(400).send({ error: 'Invalid query', issues: query.error.issues });
      }

      const persona = getAgentPersona({
        userId: user.sub,
        roleLayer,
        key: query.data.key,
      });
      const effective = resolveEffectiveSoul({
        userId: user.sub,
        roleLayer,
        key: query.data.key,
      });

      step.succeed(undefined, {
        roleLayer,
        hasOverride: persona !== undefined,
      });

      return reply.send({
        roleLayer,
        key: query.data.key,
        persona: persona ?? null,
        effective: {
          soulMd: effective.soulMd,
          isDefault: effective.isDefault,
        },
      });
    },
  );

  app.put(
    '/team/personas/:roleLayer',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'team.personas.update');
      const user = request.user as JwtPayload;
      const roleLayer = (request.params as { roleLayer: string }).roleLayer;

      if (!isSoulRoleLayer(roleLayer)) {
        step.fail('invalid role layer');
        return reply.status(400).send({
          error: 'invalid-role-layer',
          allowed: Array.from(VALID_SOUL_ROLE_LAYERS),
        });
      }

      const parseStep = child('parse-body');
      const body = personaUpdateSchema.safeParse(request.body);
      if (!body.success) {
        parseStep.fail('invalid input');
        step.fail('invalid input');
        return reply.status(400).send({ error: 'Invalid input', issues: body.error.issues });
      }
      parseStep.succeed();

      const scanStep = child('security-scan');
      const scan = scanMemoryWriteContent(body.data.soulMd);
      if (!scan.ok) {
        scanStep.fail(scan.reason ?? 'blocked');
        step.fail('security-scan-blocked');
        return failOnSecurity(reply, scan, 'soulMd');
      }
      scanStep.succeed();

      const persona = upsertAgentPersona({
        userId: user.sub,
        roleLayer,
        key: body.data.key,
        soulMd: body.data.soulMd,
      });
      step.succeed(undefined, { roleLayer, key: body.data.key });
      return reply.send({ persona });
    },
  );

  app.get(
    '/team/soul-defaults',
    { onRequest: [requireAuth] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.send({ souls: DEFAULT_SOULS });
    },
  );

  // ─── User Memory ────────────────────────────────────────────────────────

  app.get(
    '/team/user-memory',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'team.user-memory.get');
      const user = request.user as JwtPayload;
      const record = getUserMemory(user.sub);
      step.succeed();
      return reply.send({ body: record?.body ?? '' });
    },
  );

  app.put(
    '/team/user-memory',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'team.user-memory.update');
      const user = request.user as JwtPayload;

      const parseStep = child('parse-body');
      const body = userMemoryUpdateSchema.safeParse(request.body);
      if (!body.success) {
        parseStep.fail('invalid input');
        step.fail('invalid input');
        return reply.status(400).send({ error: 'Invalid input', issues: body.error.issues });
      }
      parseStep.succeed();

      const scanStep = child('security-scan');
      const scan = scanMemoryWriteContent(body.data.body);
      if (!scan.ok) {
        scanStep.fail(scan.reason ?? 'blocked');
        step.fail('security-scan-blocked');
        return failOnSecurity(reply, scan, 'body');
      }
      scanStep.succeed();

      const record = updateUserMemory({ userId: user.sub, body: body.data.body });
      step.succeed();
      return reply.send(record);
    },
  );

  // ─── ForceApply ─────────────────────────────────────────────────────────

  app.get(
    '/team/force-apply/state',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      return reply.send(getForceApplyState(user.sub));
    },
  );

  app.post(
    '/team/force-apply',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'team.force-apply');
      const user = request.user as JwtPayload;
      const result = recordForceApply(user.sub);
      if (!result.ok) {
        step.fail(result.reason);
        return reply.status(429).send({
          error: 'rate-limited',
          state: result.state,
          retryHintHours: 24,
        });
      }
      step.succeed(undefined, { usedInWindow: result.state.usedInWindow });
      return reply.send({ ok: true, state: result.state });
    },
  );

  // ─── Instruction Stack Preview (调试用) ─────────────────────────────────

  app.get(
    '/team/instruction-stack/preview',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'team.instruction-stack.preview');
      const user = request.user as JwtPayload;

      const query = instructionStackPreviewQuerySchema.safeParse(request.query ?? {});
      if (!query.success) {
        step.fail('invalid query');
        return reply.status(400).send({ error: 'Invalid query', issues: query.error.issues });
      }

      let workspaceRoot: string | null = null;
      if (query.data.sessionId) {
        const sessionRow = sqliteGet<SessionWorkspaceRow>(
          `SELECT id, COALESCE(metadata_json, '{}') as metadata_json
           FROM sessions
           WHERE id = ? AND user_id = ?
           LIMIT 1`,
          [query.data.sessionId, user.sub],
        );
        if (sessionRow) {
          workspaceRoot = resolveSessionWorkspacePath({
            metadataJson: sessionRow.metadata_json,
            sessionId: sessionRow.id,
            userId: user.sub,
          });
        }
      }

      const roleLayer = query.data.roleLayer;
      const validRoleLayer = roleLayer && isSoulRoleLayer(roleLayer) ? roleLayer : null;

      const result = await buildTeamInstructionStack({
        userId: user.sub,
        workspaceRoot,
        teamWorkspaceId: query.data.teamWorkspaceId ?? null,
        roleLayer: validRoleLayer,
        personaKey: query.data.personaKey,
      });

      step.succeed(undefined, {
        estimatedTokens: result.estimatedTokens,
        oversize: result.oversize,
      });
      return reply.send(result);
    },
  );
}
