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
  createMemory,
  deleteMemory,
  getMemoryById,
  getMemoryStats,
  listMemories,
  readMemorySettings,
  updateMemory,
  upsertExtractedMemories,
  writeMemorySettings,
} from '../memory/memory-store.js';
import { sqliteGet } from '../infra/db.js';
import { buildMemoryExtractionTextForSession } from '../memory/memory-runtime.js';
import { scanMemoryWriteContent } from '../memory/memory-security-scanner.js';
import { z } from 'zod';

interface SessionSelectionRow {
  id: string;
  metadata_json: string;
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
          step.fail('memory-write-blocked');
          return reply.status(400).send({
            error: 'memory-write-blocked',
            field,
            threat: scan.threat,
            reason: scan.reason,
            sample: scan.sample,
          });
        }
      }

      const memory = createMemory(user.sub, parsed);
      step.succeed(undefined, { memoryId: memory.id });
      return reply.status(201).send({ memory });
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
        step.fail('not found');
        return reply.status(404).send({ error: 'Memory not found' });
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
          step.fail('memory-write-blocked');
          return reply.status(400).send({
            error: 'memory-write-blocked',
            field,
            threat: scan.threat,
            reason: scan.reason,
            sample: scan.sample,
          });
        }
      }

      const memory = updateMemory(user.sub, memoryId, parsed);
      if (!memory) {
        step.fail('not found');
        return reply.status(404).send({ error: 'Memory not found' });
      }

      step.succeed(undefined, { memoryId });
      return reply.send({ memory });
    },
  );

  app.delete(
    '/memories/:memoryId',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'memories.delete');
      const user = request.user as JwtPayload;
      const { memoryId } = request.params as { memoryId: string };

      const deleted = deleteMemory(user.sub, memoryId);
      if (!deleted) {
        step.fail('not found');
        return reply.status(404).send({ error: 'Memory not found' });
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
          step.fail('session not found');
          return reply.status(404).send({ error: 'No session available for extraction' });
        }

        extractionText = buildMemoryExtractionTextForSession({
          sessionId: session.id,
          userId: user.sub,
        });
        extractedFromSessionId = session.id;
      }

      const candidates = extractMemoriesFromText(extractionText);
      const workspaceRoot = session?.metadata_json
        ? ((JSON.parse(session.metadata_json) as Record<string, unknown>)['workingDirectory'] ??
          null)
        : null;
      const workspaceRootStr = typeof workspaceRoot === 'string' ? workspaceRoot : null;
      const result = upsertExtractedMemories(user.sub, candidates, workspaceRootStr);
      step.succeed(undefined, { ...result, candidates: candidates.length });
      return reply.send({
        candidates: candidates.length,
        extracted: result.created + result.updated,
        extractedFromSessionId,
        ...result,
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
}
