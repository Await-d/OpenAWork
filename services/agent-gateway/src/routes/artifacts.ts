import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ArtifactManagerImpl } from '@openAwork/artifacts';
import type { ArtifactMetadata, ArtifactVersionActor } from '@openAwork/artifacts';
import type { JwtPayload } from '../auth.js';
import { requireAuth } from '../auth.js';
import { sqliteGet } from '../db.js';
import { resolveGatewayArtifactsDir, resolveGatewayArtifactsIndexPath } from '../storage-paths.js';
import {
  createArtifact,
  getArtifactById,
  listArtifactsBySession,
  listArtifactVersions,
  revertArtifactToVersion,
  updateArtifact,
} from '../artifact-content-store.js';

const ARTIFACTS_DIR = resolveGatewayArtifactsDir();
const ARTIFACTS_INDEX = resolveGatewayArtifactsIndexPath();

const artifactManager = new ArtifactManagerImpl({ indexFilePath: ARTIFACTS_INDEX });

const uploadSchema = z.object({
  name: z.string().min(1),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  contentBase64: z.string().min(1),
});

const artifactActorSchema = z.enum(['agent', 'user', 'system']);
const artifactMetadataSchema = z.record(z.unknown()).default({});
const createArtifactSchema = z.object({
  sessionId: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(200),
  content: z.string().max(500_000),
  type: z
    .enum(['code', 'html', 'react', 'svg', 'mermaid', 'markdown', 'csv', 'image', 'document'])
    .optional(),
  fileName: z.string().trim().min(1).max(255).optional(),
  mimeType: z.string().trim().min(1).max(255).optional(),
  metadata: artifactMetadataSchema.optional(),
  createdBy: artifactActorSchema.optional(),
  createdByNote: z.string().trim().max(500).nullable().optional(),
});
const updateArtifactSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  content: z.string().max(500_000).optional(),
  type: z
    .enum(['code', 'html', 'react', 'svg', 'mermaid', 'markdown', 'csv', 'image', 'document'])
    .nullable()
    .optional(),
  fileName: z.string().trim().min(1).max(255).nullable().optional(),
  mimeType: z.string().trim().min(1).max(255).nullable().optional(),
  metadata: artifactMetadataSchema.optional(),
  createdBy: artifactActorSchema.optional(),
  createdByNote: z.string().trim().max(500).nullable().optional(),
});
const revertArtifactSchema = z.object({
  versionId: z.string().trim().min(1).max(200),
  createdBy: artifactActorSchema.optional(),
  createdByNote: z.string().trim().max(500).nullable().optional(),
});

function normalizeCreatedBy(actor: ArtifactVersionActor | undefined): ArtifactVersionActor {
  return actor ?? 'user';
}

function normalizeMetadata(metadata: Record<string, unknown> | undefined): ArtifactMetadata {
  return metadata ?? {};
}

function isPreviewableText(name: string, mimeType?: string): boolean {
  if (mimeType?.startsWith('text/')) {
    return true;
  }
  const lower = name.toLowerCase();
  return [
    '.txt',
    '.md',
    '.json',
    '.csv',
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.py',
    '.yml',
    '.yaml',
    '.xml',
    '.html',
    '.css',
  ].some((suffix) => lower.endsWith(suffix));
}

function buildPreview(
  name: string,
  mimeType: string | undefined,
  buffer: Buffer,
): string | undefined {
  if (!isPreviewableText(name, mimeType)) {
    return undefined;
  }
  const raw = buffer.toString('utf-8').replace(/\0/g, '');
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.length > 1200 ? `${trimmed.slice(0, 1200)}\n…` : trimmed;
}

async function ensureSessionOwned(sessionId: string, userId: string): Promise<boolean> {
  const row = sqliteGet<{ id: string }>(
    'SELECT id FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
    [sessionId, userId],
  );
  return Boolean(row?.id);
}

export async function artifactsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { sessionId: string } }>(
    '/sessions/:sessionId/artifacts',
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = request.params;
      const owned = await ensureSessionOwned(sessionId, user.sub);
      if (!owned) {
        return reply.status(404).send({ error: 'Session not found' });
      }
      const artifacts = await artifactManager.list(sessionId);
      const contentArtifacts = listArtifactsBySession(user.sub, sessionId);
      return reply.send({ artifacts, contentArtifacts });
    },
  );

  app.post<{ Body: unknown }>('/artifacts', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.user as JwtPayload;
    const parsed = createArtifactSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: 'Invalid artifact payload', issues: parsed.error.issues });
    }

    const owned = await ensureSessionOwned(parsed.data.sessionId, user.sub);
    if (!owned) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    const artifact = createArtifact(user.sub, {
      sessionId: parsed.data.sessionId,
      title: parsed.data.title,
      content: parsed.data.content,
      type: parsed.data.type,
      fileName: parsed.data.fileName,
      mimeType: parsed.data.mimeType,
      metadata: normalizeMetadata(parsed.data.metadata),
      createdBy: normalizeCreatedBy(parsed.data.createdBy),
      createdByNote: parsed.data.createdByNote ?? null,
    });
    return reply.status(201).send({ artifact });
  });

  app.get<{ Params: { artifactId: string } }>(
    '/artifacts/:artifactId',
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = request.user as JwtPayload;
      const artifact = getArtifactById(user.sub, request.params.artifactId);
      if (!artifact) {
        return reply.status(404).send({ error: 'Artifact not found' });
      }
      return reply.send({ artifact });
    },
  );

  app.get<{ Params: { artifactId: string } }>(
    '/artifacts/:artifactId/versions',
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = request.user as JwtPayload;
      const artifact = getArtifactById(user.sub, request.params.artifactId);
      if (!artifact) {
        return reply.status(404).send({ error: 'Artifact not found' });
      }
      const versions = listArtifactVersions(user.sub, request.params.artifactId);
      return reply.send({ artifact, versions });
    },
  );

  app.put<{ Params: { artifactId: string }; Body: unknown }>(
    '/artifacts/:artifactId',
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = request.user as JwtPayload;
      const parsed = updateArtifactSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: 'Invalid artifact payload', issues: parsed.error.issues });
      }

      const artifact = updateArtifact(user.sub, request.params.artifactId, {
        title: parsed.data.title,
        content: parsed.data.content,
        type: parsed.data.type ?? null,
        fileName: parsed.data.fileName ?? null,
        mimeType: parsed.data.mimeType ?? null,
        metadata: normalizeMetadata(parsed.data.metadata),
        createdBy: normalizeCreatedBy(parsed.data.createdBy),
        createdByNote: parsed.data.createdByNote ?? null,
      });
      if (!artifact) {
        return reply.status(404).send({ error: 'Artifact not found' });
      }
      return reply.send({ artifact });
    },
  );

  app.post<{ Params: { artifactId: string }; Body: unknown }>(
    '/artifacts/:artifactId/revert',
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = request.user as JwtPayload;
      const parsed = revertArtifactSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: 'Invalid revert payload', issues: parsed.error.issues });
      }

      const artifact = revertArtifactToVersion(user.sub, request.params.artifactId, {
        versionId: parsed.data.versionId,
        createdBy: normalizeCreatedBy(parsed.data.createdBy),
        createdByNote: parsed.data.createdByNote ?? null,
      });
      if (!artifact) {
        return reply.status(404).send({ error: 'Artifact or version not found' });
      }
      return reply.send({ artifact });
    },
  );

  app.post<{ Params: { sessionId: string }; Body: unknown }>(
    '/sessions/:sessionId/artifacts',
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = request.params;
      const owned = await ensureSessionOwned(sessionId, user.sub);
      if (!owned) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      const parsed = uploadSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: 'Invalid upload payload', issues: parsed.error.issues });
      }

      const { name, mimeType, sizeBytes, contentBase64 } = parsed.data;
      const safeName = basename(name);
      const artifactId = randomUUID();
      const targetDir = join(ARTIFACTS_DIR, sessionId);
      const targetPath = join(targetDir, `${artifactId}${extname(safeName) || '.bin'}`);
      const buffer = Buffer.from(contentBase64, 'base64');
      const preview = buildPreview(safeName, mimeType, buffer);

      await mkdir(targetDir, { recursive: true });
      await writeFile(targetPath, buffer);

      const artifact = artifactManager.add({
        sessionId,
        type: 'document',
        name: safeName,
        path: targetPath,
        mimeType,
        sizeBytes: sizeBytes ?? buffer.byteLength,
        preview,
      });

      return reply.status(201).send({ artifact });
    },
  );
}
