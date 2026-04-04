import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ArtifactManagerImpl } from '@openAwork/artifacts';
import type { JwtPayload } from '../auth.js';
import { requireAuth } from '../auth.js';
import { sqliteGet } from '../db.js';
import { resolveGatewayArtifactsDir, resolveGatewayArtifactsIndexPath } from '../storage-paths.js';

const ARTIFACTS_DIR = resolveGatewayArtifactsDir();
const ARTIFACTS_INDEX = resolveGatewayArtifactsIndexPath();

const artifactManager = new ArtifactManagerImpl({ indexFilePath: ARTIFACTS_INDEX });

const uploadSchema = z.object({
  name: z.string().min(1),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  contentBase64: z.string().min(1),
});

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
      return reply.send({ artifacts });
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
