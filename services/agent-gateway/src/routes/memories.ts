import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { JwtPayload } from '../infra/auth.js';
import { parseBody, parseQuery } from '../infra/parse-request.js';
import { requireAuth } from '../infra/auth.js';
import {
  createMemorySchema,
  updateMemorySchema,
  memoryListQuerySchema,
  memorySettingsSchema,
  extractMemoriesFromText,
} from '@openAwork/agent-core';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import {
  getMemoryById,
  getMemoryStats,
  listMemories,
  readMemorySettings,
  writeMemorySettings,
} from '../memory/memory-store.js';
import { applyManualMemoryChange } from '../memory/governance/memory-commit-service.js';
import { upsertExtractedMemories } from '../memory/memory-extraction-store.js';
import { resolveProposalScopeForSession } from '../memory/governance/memory-scope-resolver.js';
import { readLatestChannelProvenance } from '../memory/governance/memory-provenance-store.js';
import { memoriesProposalsRoutes } from './memories-proposals.js';
import { memoriesRulesRoutes } from './memories-rules.js';
import { sqliteGet } from '../infra/db.js';
import { buildMemoryExtractionTextForSession } from '../memory/memory-runtime.js';
import { scanMemoryWriteContent } from '../memory/memory-security-scanner.js';
import { z } from 'zod';

interface SessionSelectionRow {
  id: string;
  metadata_json: string;
}

type MemoriesRouteErrorCode =
  | 'memory_not_found'
  | 'memory_write_blocked'
  | 'memory_extract_session_not_found'
  | 'memory_revision_conflict';

const MEMORIES_ROUTE_ERROR_MESSAGES: Record<MemoriesRouteErrorCode, string> = {
  memory_not_found: '目标记忆不存在。',
  memory_write_blocked: '记忆内容未通过安全校验。',
  memory_extract_session_not_found: '没有可用于抽取记忆的会话。',
  memory_revision_conflict: '记忆已被修改，请刷新后重试。',
};

/** 从请求体 / 查询里读可选 `expectedRevision`（乐观并发）。 */
function readExpectedRevision(body: unknown, query: unknown): number | null {
  const fromBody =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)['expectedRevision']
      : undefined;
  const fromQuery =
    query && typeof query === 'object' && !Array.isArray(query)
      ? (query as Record<string, unknown>)['expectedRevision']
      : undefined;
  const value = fromBody ?? fromQuery;
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

function memoriesRouteErrorPayload(
  code: MemoriesRouteErrorCode,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    code,
    error: MEMORIES_ROUTE_ERROR_MESSAGES[code],
    ...(extra ?? {}),
  };
}

function readWorkspaceRootFromSessionMetadata(
  metadataJson: string | null | undefined,
): string | null {
  if (!metadataJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(metadataJson) as Record<string, unknown>;
    return typeof parsed['workingDirectory'] === 'string' ? parsed['workingDirectory'] : null;
  } catch {
    return null;
  }
}

export async function memoriesRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/memories',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'memories.list');
      const user = request.user as JwtPayload;

      const parsed = parseQuery(memoryListQuerySchema, request.query);

      const memories = listMemories(user.sub, parsed);
      step.succeed(undefined, { count: memories.length });
      return reply.send({ memories });
    },
  );

  app.post(
    '/memories',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'memories.create');
      const user = request.user as JwtPayload;

      const parsed = parseBody(createMemorySchema, request.body);

      // 260515-team-phase-a · T-07：拒绝包含注入载荷 / Unicode 异常 / 超大记忆
      for (const [field, content] of [
        ['key', parsed.key],
        ['value', parsed.value],
      ] as const) {
        const scan = scanMemoryWriteContent(content);
        if (!scan.ok) {
          step.fail('memory_write_blocked');
          return reply.status(400).send(
            memoriesRouteErrorPayload('memory_write_blocked', {
              field,
              threat: scan.threat,
              reason: scan.reason,
              sample: scan.sample,
            }),
          );
        }
      }

      // 人工显式保存：仍直接生效（不弹二次确认），由提交器落库并记录
      // confirmationKind='manual' + 递增 revision。
      const result = applyManualMemoryChange({
        userId: user.sub,
        actorId: user.sub,
        action: 'create',
        payload: parsed,
      });
      if (!result.ok || !result.memory) {
        step.fail('memory_write_blocked');
        return reply.status(400).send(
          memoriesRouteErrorPayload('memory_write_blocked', {
            detail: result.error,
          }),
        );
      }

      step.succeed(undefined, { memoryId: result.memory.id });
      return reply.status(201).send({ memory: result.memory });
    },
  );

  app.get(
    '/memories/stats',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'memories.stats');
      const user = request.user as JwtPayload;

      const stats = getMemoryStats(user.sub);
      step.succeed(undefined, { total: stats.total });
      return reply.send({ stats });
    },
  );

  app.get(
    '/memories/:memoryId',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'memories.get');
      const user = request.user as JwtPayload;
      const { memoryId } = request.params as { memoryId: string };

      const memory = getMemoryById(user.sub, memoryId);
      if (!memory) {
        step.fail('memory_not_found');
        return reply.status(404).send(memoriesRouteErrorPayload('memory_not_found'));
      }

      step.succeed(undefined, { memoryId });
      return reply.send({ memory });
    },
  );

  app.put(
    '/memories/:memoryId',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'memories.update');
      const user = request.user as JwtPayload;
      const { memoryId } = request.params as { memoryId: string };

      const parsed = parseBody(updateMemorySchema, request.body);

      // 260515-team-phase-a · T-07：用户更新 memory 时同样跑一遍安全扫描
      for (const [field, content] of [
        ['key', parsed.key],
        ['value', parsed.value],
      ] as const) {
        if (typeof content !== 'string') continue;
        const scan = scanMemoryWriteContent(content);
        if (!scan.ok) {
          step.fail('memory_write_blocked');
          return reply.status(400).send(
            memoriesRouteErrorPayload('memory_write_blocked', {
              field,
              threat: scan.threat,
              reason: scan.reason,
              sample: scan.sample,
            }),
          );
        }
      }

      // 人工显式保存：直接生效；支持可选 expectedRevision 乐观并发（不匹配 → 409）。
      const result = applyManualMemoryChange({
        userId: user.sub,
        actorId: user.sub,
        action: 'update',
        memoryId,
        payload: parsed,
        expectedRevision: readExpectedRevision(request.body, request.query),
      });
      if (!result.ok) {
        if (result.error?.includes('不存在')) {
          step.fail('memory_not_found');
          return reply.status(404).send(memoriesRouteErrorPayload('memory_not_found'));
        }
        step.fail('memory_revision_conflict');
        return reply
          .status(409)
          .send(memoriesRouteErrorPayload('memory_revision_conflict', { detail: result.error }));
      }

      step.succeed(undefined, { memoryId });
      return reply.send({ memory: result.memory });
    },
  );

  app.delete(
    '/memories/:memoryId',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'memories.delete');
      const user = request.user as JwtPayload;
      const { memoryId } = request.params as { memoryId: string };

      // 人工显式删除：直接生效（同 PUT，支持可选 expectedRevision）。
      const result = applyManualMemoryChange({
        userId: user.sub,
        actorId: user.sub,
        action: 'delete',
        memoryId,
        expectedRevision: readExpectedRevision(request.body, request.query),
      });
      if (!result.ok) {
        if (result.error?.includes('不存在')) {
          step.fail('memory_not_found');
          return reply.status(404).send(memoriesRouteErrorPayload('memory_not_found'));
        }
        step.fail('memory_revision_conflict');
        return reply
          .status(409)
          .send(memoriesRouteErrorPayload('memory_revision_conflict', { detail: result.error }));
      }

      step.succeed(undefined, { memoryId });
      return reply.send({ ok: true });
    },
  );

  app.post(
    '/memories/extract',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'memories.extract');
      const user = request.user as JwtPayload;

      const bodySchema = z.object({
        sessionId: z.string().trim().min(1).max(200).optional(),
        text: z.string().trim().min(1).max(32768).optional(),
      });
      const parsed = parseBody(bodySchema, request.body);

      let extractionText = parsed.text ?? null;
      let extractedFromSessionId: string | null = null;
      let session: SessionSelectionRow | undefined;

      if (!extractionText) {
        session = parsed.sessionId
          ? sqliteGet<SessionSelectionRow>(
              'SELECT id, metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
              [parsed.sessionId, user.sub],
            )
          : sqliteGet<SessionSelectionRow>(
              'SELECT id, metadata_json FROM sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1',
              [user.sub],
            );

        if (!session) {
          step.fail('memory_extract_session_not_found');
          return reply
            .status(404)
            .send(memoriesRouteErrorPayload('memory_extract_session_not_found'));
        }

        extractionText = buildMemoryExtractionTextForSession({
          sessionId: session.id,
          userId: user.sub,
        });
        extractedFromSessionId = session.id;
      }

      const candidates = extractMemoriesFromText(extractionText);
      const metadataJson = session?.metadata_json ?? '{}';
      const workspaceRoot = readWorkspaceRootFromSessionMetadata(session?.metadata_json);
      const settings = readMemorySettings(user.sub);
      // 用户显式点了「立即抽取」：forceAsk，且来源标记为 manual_extract。
      const provenance = extractedFromSessionId
        ? (readLatestChannelProvenance(extractedFromSessionId) ?? null)
        : null;
      const scope = resolveProposalScopeForSession({
        userId: user.sub,
        metadataJson,
        provenance,
      });
      const result = upsertExtractedMemories(user.sub, candidates, workspaceRoot, settings, {
        scope,
        origin: 'manual_extract',
        provenance,
        forceAsk: true,
      });
      // 兼容旧字段名：`created` / `updated` 现在表示「已提交待确认的提议数」，
      // 不再代表已写入；新增 `proposed` 明确语义。
      const extractionSummary = {
        blocked: result.blocked,
        candidates: candidates.length,
        created: result.created,
        duplicates: result.duplicates,
        proposed: result.proposed,
        rejected: result.rejected,
        reviewed: result.reviewed,
        suppressed: result.suppressed,
        transient: result.transient,
        updated: result.updated,
      };

      step.succeed(undefined, extractionSummary);
      return reply.send({
        extracted: result.proposed,
        extractedFromSessionId,
        ...extractionSummary,
      });
    },
  );

  app.get(
    '/memories/settings',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'memories.settings.get');
      const user = request.user as JwtPayload;

      const settings = readMemorySettings(user.sub);
      step.succeed(undefined, { enabled: settings.enabled });
      return reply.send({ settings });
    },
  );

  app.put(
    '/memories/settings',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'memories.settings.put');
      const user = request.user as JwtPayload;

      const parsed = parseBody(memorySettingsSchema, request.body);

      writeMemorySettings(user.sub, parsed);
      step.succeed(undefined, { enabled: parsed.enabled });
      return reply.send({ settings: parsed });
    },
  );

  // 提议确认路由（唯一正式写入门）。注册顺序在 `:memoryId` 之后不影响——这些
  // 路由带 `/proposals` / `/revisions` 前缀，交由独立插件按自身顺序注册。
  await app.register(memoriesProposalsRoutes);
  // 结构化规则路由：新增/改内容走提议确认，停用/删除直接收窄生效。
  await app.register(memoriesRulesRoutes);
}
