/**
 * 260515-team-phase-a · T-04 / T-05 / T-09 路由
 *
 * 集中提供 Phase A 新增的所有 HTTP 端点：
 *   - GET/PUT /team/workspaces/:teamWorkspaceId/constitution
 *   - GET/PUT /team/personas/:roleLayer
 *   - GET     /team/personas               （列出全部 5 层）
 *   - GET/PUT /team/user-memory
 *   - GET     /team/instruction-stack/preview （调试用，预览团队运行时指令栈）
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
import {
  memorySourceSchema,
  memoryRoleLayerSchema,
  memoryTypeSchema,
  type MemoryEntry,
  type MemoryRoleLayer,
  type MemoryType,
} from '@openAwork/agent-core';
import type { JwtPayload } from '../infra/auth.js';
import { parseBody, parseQuery } from '../infra/parse-request.js';
import { requireAuth } from '../infra/auth.js';
import { sqliteGet } from '../infra/db.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import {
  scanMemoryWriteContent,
  type MemoryWriteScanResult,
} from '../memory/memory-security-scanner.js';
import {
  createMemory,
  findEnabledMemoryByTypeAndKey,
  listMemoriesForTeamWorkspaceKnowledge,
  updateMemory,
} from '../memory/memory-store.js';
import { getTeamConstitution, updateTeamConstitution } from '../team/team-constitution-store.js';
import {
  ensureDefaultPersonasForUser,
  getAgentPersona,
  isSoulRoleLayer,
  listAgentPersonas,
  resetAgentPersonaToDefault,
  resolveEffectiveSoul,
  upsertAgentPersona,
  VALID_SOUL_ROLE_LAYERS,
} from '../team/team-personas-store.js';
import { getUserMemory, updateUserMemory } from '../team/team-user-memory-store.js';
import { getForceApplyState, recordForceApply } from '../team/team-force-apply-store.js';
import { buildTeamInstructionStack } from '../team/team-instruction-stack.js';
import {
  buildLayerCapabilitySummaries,
  buildLayerCapabilitySummary,
} from '../team/team-layer-capability-summary.js';
import type { HandoffRoleLayer } from '../handoff/store/handoff-store.js';
import {
  CONSTITUTION_TEMPLATES,
  DEFAULT_SOULS,
  SOUL_ROLE_LAYER_ORDER,
} from '../team-phase-a-content/index.js';
import { parseSessionMetadataJson } from '../session/session-workspace-metadata.js';
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

const booleanQueryParamSchema = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') {
    return true;
  }
  if (normalized === 'false' || normalized === '0') {
    return false;
  }
  return value;
}, z.boolean().optional());

const WORKSPACE_KNOWLEDGE_LIST_LIMIT_MAX = 1200;

const teamWorkspaceKnowledgeListQuerySchema = z.object({
  type: memoryTypeSchema.optional(),
  roleLayer: memoryRoleLayerSchema.optional(),
  enabled: booleanQueryParamSchema,
  search: z.string().trim().max(200).optional(),
  limit: z
    .preprocess((value) => {
      if (typeof value === 'string') {
        return Number(value);
      }
      return value;
    }, z.number().int().min(1).max(WORKSPACE_KNOWLEDGE_LIST_LIMIT_MAX))
    .optional()
    .default(100),
  offset: z
    .preprocess((value) => {
      if (typeof value === 'string') {
        return Number(value);
      }
      return value;
    }, z.number().int().min(0))
    .optional()
    .default(0),
});

const teamWorkspaceKnowledgeUpsertSchema = z.object({
  type: memoryTypeSchema.default('project_context'),
  key: z.string().trim().min(1).max(200),
  value: z.string().trim().min(1).max(4000),
  source: memorySourceSchema.optional(),
  confidence: z.number().min(0).max(1).optional(),
  priority: z.number().int().min(0).max(100).optional(),
  roleLayers: z.array(memoryRoleLayerSchema).max(5).nullable().optional().default(null),
});

const PERSISTED_KNOWLEDGE_STATUS_LIMIT = WORKSPACE_KNOWLEDGE_LIST_LIMIT_MAX;
const PERSISTED_KNOWLEDGE_STATUS_FETCH_LIMIT = PERSISTED_KNOWLEDGE_STATUS_LIMIT + 1;

const personaQuerySchema = z.object({
  key: z.string().min(1).max(100).optional().default('default'),
});

const instructionStackPreviewQuerySchema = z.object({
  teamWorkspaceId: z.string().min(1).optional(),
  roleLayer: z.string().optional(),
  personaKey: z.string().min(1).optional(),
  /**
   * 可选：指定一个已有 session id，用于复用其 workspace 路径解析逻辑。
   * 不传则回退到 team workspace 的 default_working_root。
   */
  sessionId: z.string().min(1).optional(),
});

interface SessionWorkspaceRow {
  id: string;
  metadata_json: string;
}

interface TeamWorkspaceKnowledgeScopeRow {
  id: string;
  name: string;
  default_working_root: string | null;
}

interface TeamWorkspaceKnowledgeRecord {
  confidence: number;
  createdAt: string;
  enabled: boolean;
  id: string;
  key: string;
  priority: number;
  source: MemoryEntry['source'];
  teamWorkspaceId: string | null;
  roleLayers: MemoryRoleLayer[] | null;
  type: MemoryType;
  updatedAt: string;
  value: string;
  workspaceRoot: string | null;
}

const TEAM_PHASE_A_ERROR_MESSAGES = {
  constitutionVersionConflict: '团队宪法版本已变化，请刷新后重试。',
  knowledgeKeyConflict: '该知识 key 已被其它工作区占用。',
  invalidRoleLayer: '角色层级无效。',
  memoryWriteBlocked: '安全扫描阻止了此次写入。',
  rateLimited: 'ForceApply 触发过于频繁，请稍后重试。',
  workspaceNotFound: '目标工作区不存在。',
} as const;

function failOnSecurity(
  reply: FastifyReply,
  result: MemoryWriteScanResult,
  field: string,
): FastifyReply {
  return reply.status(400).send({
    error: 'memory-write-blocked',
    message: TEAM_PHASE_A_ERROR_MESSAGES.memoryWriteBlocked,
    field,
    threat: result.threat,
    reason: result.reason,
    sample: result.sample,
  });
}

function getTeamWorkspaceKnowledgeScope(
  userId: string,
  teamWorkspaceId: string,
): TeamWorkspaceKnowledgeScopeRow | undefined {
  return sqliteGet<TeamWorkspaceKnowledgeScopeRow>(
    `SELECT id, name, default_working_root
     FROM team_workspaces
     WHERE id = ? AND user_id = ?
     LIMIT 1`,
    [teamWorkspaceId, userId],
  );
}

function toTeamWorkspaceKnowledgeRecord(memory: MemoryEntry): TeamWorkspaceKnowledgeRecord {
  return {
    confidence: memory.confidence,
    createdAt: memory.createdAt,
    enabled: memory.enabled,
    id: memory.id,
    key: memory.key,
    priority: memory.priority,
    source: memory.source,
    teamWorkspaceId: memory.teamWorkspaceId,
    roleLayers: memory.roleLayers,
    type: memory.type,
    updatedAt: memory.updatedAt,
    value: memory.value,
    workspaceRoot: memory.workspaceRoot,
  };
}

function sessionMatchesTeamWorkspace(
  metadataJson: string,
  teamWorkspaceId: string | undefined,
): boolean {
  if (!teamWorkspaceId) {
    return true;
  }
  const metadata = parseSessionMetadataJson(metadataJson);
  const sessionTeamWorkspaceId = metadata['teamWorkspaceId'];
  return typeof sessionTeamWorkspaceId !== 'string' || sessionTeamWorkspaceId === teamWorkspaceId;
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
        return reply.status(404).send({ error: TEAM_PHASE_A_ERROR_MESSAGES.workspaceNotFound });
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
      const body = parseBody(constitutionUpdateSchema, request.body);
      parseStep.succeed();

      const scanStep = child('security-scan');
      const scan = scanMemoryWriteContent(body.body);
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
        body: body.body,
        expectedVersion: body.expectedVersion,
      });
      if (!result.ok) {
        updateStep.fail(result.reason);
        step.fail(result.reason);
        if (result.reason === 'not-found') {
          return reply.status(404).send({ error: TEAM_PHASE_A_ERROR_MESSAGES.workspaceNotFound });
        }
        return reply.status(409).send({
          error: 'version-conflict',
          message: TEAM_PHASE_A_ERROR_MESSAGES.constitutionVersionConflict,
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
          code: 'invalid-role-layer',
          error: TEAM_PHASE_A_ERROR_MESSAGES.invalidRoleLayer,
          allowed: Array.from(VALID_SOUL_ROLE_LAYERS),
        });
      }

      const query = parseQuery(personaQuerySchema, request.query);

      const persona = getAgentPersona({
        userId: user.sub,
        roleLayer,
        key: query.key,
      });
      const effective = resolveEffectiveSoul({
        userId: user.sub,
        roleLayer,
        key: query.key,
      });

      step.succeed(undefined, {
        roleLayer,
        hasOverride: persona !== undefined,
      });

      return reply.send({
        roleLayer,
        key: query.key,
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
          code: 'invalid-role-layer',
          error: TEAM_PHASE_A_ERROR_MESSAGES.invalidRoleLayer,
          allowed: Array.from(VALID_SOUL_ROLE_LAYERS),
        });
      }

      const parseStep = child('parse-body');
      const body = parseBody(personaUpdateSchema, request.body);
      parseStep.succeed();

      const scanStep = child('security-scan');
      const scan = scanMemoryWriteContent(body.soulMd);
      if (!scan.ok) {
        scanStep.fail(scan.reason ?? 'blocked');
        step.fail('security-scan-blocked');
        return failOnSecurity(reply, scan, 'soulMd');
      }
      scanStep.succeed();

      const persona = upsertAgentPersona({
        userId: user.sub,
        roleLayer,
        key: body.key,
        soulMd: body.soulMd,
      });
      step.succeed(undefined, { roleLayer, key: body.key });
      return reply.send({ persona });
    },
  );

  app.post(
    '/team/personas/:roleLayer/reset',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'team.personas.reset');
      const user = request.user as JwtPayload;
      const roleLayer = (request.params as { roleLayer: string }).roleLayer;

      if (!isSoulRoleLayer(roleLayer)) {
        step.fail('invalid role layer');
        return reply.status(400).send({
          code: 'invalid-role-layer',
          error: TEAM_PHASE_A_ERROR_MESSAGES.invalidRoleLayer,
          allowed: Array.from(VALID_SOUL_ROLE_LAYERS),
        });
      }

      const query = parseQuery(personaQuerySchema, request.query);
      const persona = resetAgentPersonaToDefault({
        userId: user.sub,
        roleLayer,
        key: query.key,
      });
      const effective = resolveEffectiveSoul({ userId: user.sub, roleLayer, key: query.key });

      step.succeed(undefined, { roleLayer, key: query.key });
      return reply.send({
        roleLayer,
        key: query.key,
        persona: persona ?? null,
        effective: {
          soulMd: effective.soulMd,
          isDefault: effective.isDefault,
        },
      });
    },
  );

  app.get(
    '/team/soul-defaults',
    { onRequest: [requireAuth] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.send({ souls: DEFAULT_SOULS });
    },
  );

  // ─── Layer Capabilities（每层工具/产物/指令能力摘要，只读）──────────────

  app.get(
    '/team/layer-capabilities',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'team.layer-capabilities.list');
      const query = request.query as { layer?: string };

      if (query.layer) {
        const summary = buildLayerCapabilitySummary(query.layer as HandoffRoleLayer);
        if (!summary) {
          step.fail('invalid or unsupported layer');
          return reply.status(404).send({
            code: 'layer-not-supported',
            error: `层级 ${query.layer} 不绑定独立角色能力（仅 reception / pm1 / pm2 / executor / reviewer）。`,
          });
        }
        step.succeed();
        return reply.send({ layers: [summary] });
      }

      const layers = buildLayerCapabilitySummaries();
      step.succeed(undefined, { count: layers.length });
      return reply.send({ layers });
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
      const body = parseBody(userMemoryUpdateSchema, request.body);
      parseStep.succeed();

      const scanStep = child('security-scan');
      const scan = scanMemoryWriteContent(body.body);
      if (!scan.ok) {
        scanStep.fail(scan.reason ?? 'blocked');
        step.fail('security-scan-blocked');
        return failOnSecurity(reply, scan, 'body');
      }
      scanStep.succeed();

      const record = updateUserMemory({ userId: user.sub, body: body.body });
      step.succeed();
      return reply.send(record);
    },
  );

  // ─── Workspace Knowledge（查询 / 入库）──────────────────────────────────

  app.get(
    '/team/workspaces/:teamWorkspaceId/knowledge',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'team.workspace-knowledge.list');
      const user = request.user as JwtPayload;
      const teamWorkspaceId = (request.params as { teamWorkspaceId: string }).teamWorkspaceId;

      const workspace = getTeamWorkspaceKnowledgeScope(user.sub, teamWorkspaceId);
      if (!workspace) {
        step.fail('workspace not found');
        return reply.status(404).send({ error: TEAM_PHASE_A_ERROR_MESSAGES.workspaceNotFound });
      }

      const query = parseQuery(teamWorkspaceKnowledgeListQuerySchema, request.query);
      const knowledge = listMemoriesForTeamWorkspaceKnowledge(user.sub, {
        enabled: query.enabled,
        limit: query.limit,
        offset: query.offset,
        roleLayer: query.roleLayer,
        search: query.search,
        teamWorkspaceId,
        type: query.type,
        workspaceRoot: workspace.default_working_root,
      }).map(toTeamWorkspaceKnowledgeRecord);
      const persistedKnowledgeRows = listMemoriesForTeamWorkspaceKnowledge(user.sub, {
        enabled: query.enabled,
        limit: PERSISTED_KNOWLEDGE_STATUS_FETCH_LIMIT,
        offset: 0,
        teamWorkspaceId,
        type: query.type,
        workspaceRoot: workspace.default_working_root,
      });
      const persistedKnowledgeTruncated =
        persistedKnowledgeRows.length > PERSISTED_KNOWLEDGE_STATUS_LIMIT;
      const persistedKnowledge = persistedKnowledgeRows
        .slice(0, PERSISTED_KNOWLEDGE_STATUS_LIMIT)
        .map(toTeamWorkspaceKnowledgeRecord);

      step.succeed(undefined, {
        count: knowledge.length,
        persistedCount: persistedKnowledge.length,
        persistedKnowledgeTruncated,
        teamWorkspaceId,
      });
      return reply.send({
        knowledge,
        persistedKnowledge,
        persistedKnowledgeTruncated,
        workspace: {
          id: workspace.id,
          name: workspace.name,
          workspaceRoot: workspace.default_working_root,
        },
      });
    },
  );

  app.post(
    '/team/workspaces/:teamWorkspaceId/knowledge',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'team.workspace-knowledge.upsert');
      const user = request.user as JwtPayload;
      const teamWorkspaceId = (request.params as { teamWorkspaceId: string }).teamWorkspaceId;

      const workspace = getTeamWorkspaceKnowledgeScope(user.sub, teamWorkspaceId);
      if (!workspace) {
        step.fail('workspace not found');
        return reply.status(404).send({ error: TEAM_PHASE_A_ERROR_MESSAGES.workspaceNotFound });
      }

      const parseStep = child('parse-body');
      const body = parseBody(teamWorkspaceKnowledgeUpsertSchema, request.body);
      parseStep.succeed();

      const scanStep = child('security-scan');
      for (const [field, value] of [
        ['key', body.key],
        ['value', body.value],
      ] as const) {
        const scan = scanMemoryWriteContent(value);
        if (!scan.ok) {
          scanStep.fail(scan.reason ?? 'blocked');
          step.fail('security-scan-blocked');
          return failOnSecurity(reply, scan, field);
        }
      }
      scanStep.succeed();

      const workspaceRoot = workspace.default_working_root;
      const existing = findEnabledMemoryByTypeAndKey(user.sub, body.type, body.key);
      const canUpdateExisting =
        existing?.teamWorkspaceId === teamWorkspaceId ||
        (existing?.teamWorkspaceId === null &&
          existing.workspaceRoot !== null &&
          workspaceRoot !== null &&
          existing.workspaceRoot === workspaceRoot);
      if (existing && !canUpdateExisting) {
        step.fail('knowledge-key-conflict');
        return reply.status(409).send({
          error: 'knowledge-key-conflict',
          message: TEAM_PHASE_A_ERROR_MESSAGES.knowledgeKeyConflict,
        });
      }

      if (existing) {
        const updated = updateMemory(user.sub, existing.id, {
          confidence: body.confidence,
          enabled: true,
          priority: body.priority,
          roleLayers: body.roleLayers,
          source: body.source,
          teamWorkspaceId,
          value: body.value,
          workspaceRoot,
        });
        if (updated) {
          step.succeed(undefined, { created: false, knowledgeId: updated.id, teamWorkspaceId });
          return reply.send({
            created: false,
            knowledge: toTeamWorkspaceKnowledgeRecord(updated),
          });
        }
      }

      const created = createMemory(user.sub, {
        confidence: body.confidence,
        key: body.key,
        priority: body.priority,
        roleLayers: body.roleLayers,
        source: body.source,
        teamWorkspaceId,
        type: body.type,
        value: body.value,
        workspaceRoot,
      });
      step.succeed(undefined, { created: true, knowledgeId: created.id, teamWorkspaceId });
      return reply.status(201).send({
        created: true,
        knowledge: toTeamWorkspaceKnowledgeRecord(created),
      });
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
          message: TEAM_PHASE_A_ERROR_MESSAGES.rateLimited,
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

      const query = parseQuery(instructionStackPreviewQuerySchema, request.query);

      let workspace: TeamWorkspaceKnowledgeScopeRow | undefined;
      if (query.teamWorkspaceId) {
        workspace = getTeamWorkspaceKnowledgeScope(user.sub, query.teamWorkspaceId);
        if (!workspace) {
          step.fail('workspace not found');
          return reply.status(404).send({ error: TEAM_PHASE_A_ERROR_MESSAGES.workspaceNotFound });
        }
      }

      let workspaceRoot: string | null = null;
      if (query.sessionId) {
        const sessionRow = sqliteGet<SessionWorkspaceRow>(
          `SELECT id, COALESCE(metadata_json, '{}') as metadata_json
           FROM sessions
           WHERE id = ? AND user_id = ?
           LIMIT 1`,
          [query.sessionId, user.sub],
        );
        if (
          sessionRow &&
          sessionMatchesTeamWorkspace(sessionRow.metadata_json, query.teamWorkspaceId)
        ) {
          workspaceRoot = resolveSessionWorkspacePath({
            metadataJson: sessionRow.metadata_json,
            sessionId: sessionRow.id,
            userId: user.sub,
          });
        }
      }
      if (!workspaceRoot && workspace) {
        workspaceRoot = workspace.default_working_root;
      }

      const roleLayer = query.roleLayer;
      const validRoleLayer = roleLayer && isSoulRoleLayer(roleLayer) ? roleLayer : null;

      const result = await buildTeamInstructionStack({
        userId: user.sub,
        workspaceRoot,
        teamWorkspaceId: query.teamWorkspaceId ?? null,
        roleLayer: validRoleLayer,
        personaKey: query.personaKey,
      });

      step.succeed(undefined, {
        estimatedTokens: result.estimatedTokens,
        oversize: result.oversize,
      });
      return reply.send(result);
    },
  );

  // ─── Converge — 代码库与 spec/plan/tasks 一致性评估 ──────────────────────

  app.post(
    '/team/sessions/:sessionId/converge',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'team.converge');
      const user = request.user as JwtPayload;
      const sessionId = (request.params as { sessionId: string }).sessionId;

      // 从 session 元数据中获取 teamWorkspaceId 和 workspaceRoot
      const sessionRow = sqliteGet<{
        team_workspace_id: string | null;
        team_parent_session_id: string | null;
        metadata_json: string | null;
      }>(
        `SELECT team_workspace_id, team_parent_session_id, metadata_json FROM sessions WHERE id = ? LIMIT 1`,
        [sessionId],
      );
      if (!sessionRow) {
        step.fail('session not found');
        return reply.status(404).send({ error: 'Session not found' });
      }

      // 解析工作区路径
      const workspaceRoot = resolveSessionWorkspacePath({
        metadataJson: sessionRow.metadata_json ?? '{}',
        sessionId,
        userId: user.sub,
      });
      const teamWorkspaceId = sessionRow.team_workspace_id;

      if (!teamWorkspaceId || !workspaceRoot) {
        step.fail('missing team context');
        return reply.status(400).send({
          error: 'Session is not associated with a team workspace or workspace root',
        });
      }

      const { executeConverge, recordConvergeResult } = await import('../team/team-converge.js');

      const result = await executeConverge({
        userId: user.sub,
        teamWorkspaceId,
        sessionId,
        workspaceRoot,
      });

      recordConvergeResult(teamWorkspaceId, sessionId, result);

      step.succeed(undefined, {
        deviations: result.deviations.length,
        hasCritical: result.hasCriticalDeviations,
        durationMs: result.durationMs,
      });

      return reply.send(result);
    },
  );
}
