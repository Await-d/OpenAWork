import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ArtifactMetadata, ArtifactVersionActor, RunArtifact } from '@openAwork/artifacts';
import type { JwtPayload } from '../infra/auth.js';
import { requireAuth } from '../infra/auth.js';
import { sqliteGet } from '../infra/db.js';
import { formatTextReadOutput } from '../artifacts/text-read-output.js';
import { getGatewayArtifactManager } from '../infra/artifact-manager.js';
import { resolveGatewayArtifactsDir } from '../infra/storage-paths.js';
import {
  createArtifact,
  deleteArtifact,
  getArtifactById,
  listArtifactsBySession,
  listArtifactVersions,
  listImageWorkbenchArtifacts,
  revertArtifactToVersion,
  updateArtifact,
} from '../session/artifact-content-store.js';
import { parseBody } from '../infra/parse-request.js';

/**
 * 磁盘型产物的根目录在**请求时**解析，而非模块加载时。
 *
 * 它取决于环境变量（`OPENAWORK_DATA_DIR`），而路由模块会被测试反复 import：模块级
 * 常量会把首次 import 时的环境钉死，一旦测试在设置环境变量前 import 本模块，读写
 * 就会落到开发者真实数据目录。管理器单例（`getGatewayArtifactManager`）同理，一律
 * 在调用点获取而不是模块顶层缓存。
 */
function artifactsRootDir(): string {
  return resolveGatewayArtifactsDir();
}

/**
 * 会话 id 会作为目录名参与磁盘路径拼接。
 *
 * 会话 id 目前都来自服务端（UUID），走到这里前也已经过 `ensureSessionOwned` 的归属
 * 校验，理论上不可能带路径分隔符；但「拼路径前先拒绝分隔符」是零成本防线——一旦哪
 * 天会话 id 可由客户端带入，这里就是唯一拦截点。
 */
function isSafePathSegment(value: string): boolean {
  return (
    value.length > 0 &&
    value !== '.' &&
    value !== '..' &&
    !value.includes('/') &&
    !value.includes('\\')
  );
}

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

const ARTIFACT_ROUTE_ERROR_MESSAGES = {
  artifactNotFound: '目标产物不存在。',
  artifactOrVersionNotFound: '目标产物或版本不存在。',
  sessionNotFound: '目标会话不存在。',
} as const;

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

/**
 * 解析磁盘型产物的真实路径，并做目录逃逸校验。
 *
 * 索引文件（`artifacts-index.json`）位于本机数据目录，理论上可被同机其它进程篡改；
 * 下载 / 删除路由一旦直接信任 `path` 字段，就等于把任意文件读写暴露成 HTTP 面。
 * 这里统一要求路径必须落在 `ARTIFACTS_DIR` 之内，越界一律视为产物不存在。
 */
function resolveArtifactFilePath(artifact: RunArtifact): string | null {
  if (!artifact.path) {
    return null;
  }
  const root = resolve(artifactsRootDir());
  const resolvedPath = resolve(artifact.path);
  if (resolvedPath !== root && !resolvedPath.startsWith(`${root}${sep}`)) {
    return null;
  }
  return resolvedPath;
}

export async function artifactsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/image-workbench/artifacts', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.user as JwtPayload;
    const query = (request.query ?? {}) as { type?: string; limit?: string };
    const limitNum = Number.parseInt(query.limit ?? '', 10);
    const contentArtifacts = listImageWorkbenchArtifacts(user.sub, {
      ...(query.type ? { type: query.type } : {}),
      ...(Number.isFinite(limitNum) && limitNum > 0 ? { limit: limitNum } : {}),
    });
    return reply.send({ contentArtifacts });
  });

  app.get<{ Params: { sessionId: string } }>(
    '/sessions/:sessionId/artifacts',
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = request.params;
      const owned = await ensureSessionOwned(sessionId, user.sub);
      if (!owned) {
        return reply.status(404).send({ error: ARTIFACT_ROUTE_ERROR_MESSAGES.sessionNotFound });
      }
      const artifacts = await getGatewayArtifactManager().list(sessionId);
      const contentArtifacts = listArtifactsBySession(user.sub, sessionId);
      return reply.send({ artifacts, contentArtifacts });
    },
  );

  app.post<{ Body: unknown }>('/artifacts', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.user as JwtPayload;
    const parsed = parseBody(createArtifactSchema, request.body);

    const owned = await ensureSessionOwned(parsed.sessionId, user.sub);
    if (!owned) {
      return reply.status(404).send({ error: ARTIFACT_ROUTE_ERROR_MESSAGES.sessionNotFound });
    }

    const artifact = createArtifact(user.sub, {
      sessionId: parsed.sessionId,
      title: parsed.title,
      content: parsed.content,
      type: parsed.type,
      fileName: parsed.fileName,
      mimeType: parsed.mimeType,
      metadata: normalizeMetadata(parsed.metadata),
      createdBy: normalizeCreatedBy(parsed.createdBy),
      createdByNote: parsed.createdByNote ?? null,
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
        return reply.status(404).send({ error: ARTIFACT_ROUTE_ERROR_MESSAGES.artifactNotFound });
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
        return reply.status(404).send({ error: ARTIFACT_ROUTE_ERROR_MESSAGES.artifactNotFound });
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
      const parsed = parseBody(updateArtifactSchema, request.body);

      const artifact = updateArtifact(user.sub, request.params.artifactId, {
        title: parsed.title,
        content: parsed.content,
        type: parsed.type ?? null,
        fileName: parsed.fileName ?? null,
        mimeType: parsed.mimeType ?? null,
        metadata: normalizeMetadata(parsed.metadata),
        createdBy: normalizeCreatedBy(parsed.createdBy),
        createdByNote: parsed.createdByNote ?? null,
      });
      if (!artifact) {
        return reply.status(404).send({ error: ARTIFACT_ROUTE_ERROR_MESSAGES.artifactNotFound });
      }
      return reply.send({ artifact });
    },
  );

  app.delete<{ Params: { artifactId: string } }>(
    '/artifacts/:artifactId',
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = request.user as JwtPayload;
      const deleted = deleteArtifact(user.sub, request.params.artifactId);
      if (!deleted) {
        return reply.status(404).send({ error: ARTIFACT_ROUTE_ERROR_MESSAGES.artifactNotFound });
      }
      return reply.status(204).send();
    },
  );

  app.post<{ Params: { artifactId: string }; Body: unknown }>(
    '/artifacts/:artifactId/revert',
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = request.user as JwtPayload;
      const parsed = parseBody(revertArtifactSchema, request.body);

      const artifact = revertArtifactToVersion(user.sub, request.params.artifactId, {
        versionId: parsed.versionId,
        createdBy: normalizeCreatedBy(parsed.createdBy),
        createdByNote: parsed.createdByNote ?? null,
      });
      if (!artifact) {
        return reply
          .status(404)
          .send({ error: ARTIFACT_ROUTE_ERROR_MESSAGES.artifactOrVersionNotFound });
      }
      return reply.send({ artifact });
    },
  );

  app.post<{ Params: { sessionId: string }; Body: unknown }>(
    '/sessions/:sessionId/artifacts',
    { preHandler: requireAuth, bodyLimit: 40 * 1024 * 1024 },
    async (request, reply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = request.params;
      if (!isSafePathSegment(sessionId)) {
        return reply.status(404).send({ error: ARTIFACT_ROUTE_ERROR_MESSAGES.sessionNotFound });
      }
      const owned = await ensureSessionOwned(sessionId, user.sub);
      if (!owned) {
        return reply.status(404).send({ error: ARTIFACT_ROUTE_ERROR_MESSAGES.sessionNotFound });
      }

      const parsed = parseBody(uploadSchema, request.body);

      const { name, mimeType, contentBase64 } = parsed;
      const safeName = basename(name);
      const artifactId = randomUUID();
      const targetDir = join(artifactsRootDir(), sessionId);
      const targetPath = join(targetDir, `${artifactId}${extname(safeName) || '.bin'}`);
      const buffer = Buffer.from(contentBase64, 'base64');
      const preview = buildPreview(safeName, mimeType, buffer);
      // 供模型读取的文本正文（opencode 风格、带上限）。刻意**不落盘**：
      // 它只随本次上传响应回传，否则 artifact 索引会被大段正文撑爆。
      const textContent = formatTextReadOutput({ buffer, displayPath: safeName })?.text;

      await mkdir(targetDir, { recursive: true });
      await writeFile(targetPath, buffer);

      const artifact = getGatewayArtifactManager().add({
        sessionId,
        type: 'document',
        name: safeName,
        path: targetPath,
        mimeType,
        // 以**实际落盘字节**为准，不采信客户端上报的 `sizeBytes`：下游（跨端恢复）
        // 会拿这个值校验下载结果，客户端算错一次就会让附件被判定为损坏。
        sizeBytes: buffer.byteLength,
        preview,
      });

      return reply.status(201).send({ artifact, ...(textContent ? { textContent } : {}) });
    },
  );

  /**
   * 下载上传到会话的二进制附件（磁盘型产物）。
   *
   * 这是「待发队列附件跨端」的读取面：条目在网关只存附件元数据，另一台设备水合时
   * 凭这里的 `artifactId` 把文件拉回去，而不是只能提示用户重新选择。
   *
   * 与 `GET /artifacts/:artifactId`（SQLite 内容型产物）的区别：那条路由查的是
   * `artifacts` 表，上传路由写入的产物不在其中，两者不可互换。
   */
  app.get<{ Params: { artifactId: string; sessionId: string } }>(
    '/sessions/:sessionId/artifacts/:artifactId/content',
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = request.user as JwtPayload;
      const { artifactId, sessionId } = request.params;
      const owned = await ensureSessionOwned(sessionId, user.sub);
      if (!owned) {
        return reply.status(404).send({ error: ARTIFACT_ROUTE_ERROR_MESSAGES.sessionNotFound });
      }

      const artifact = getGatewayArtifactManager().get(artifactId);
      // 归属校验跨会话不可绕过：artifactId 命中但会话不符，等价于不存在。
      if (!artifact || artifact.sessionId !== sessionId) {
        return reply.status(404).send({ error: ARTIFACT_ROUTE_ERROR_MESSAGES.artifactNotFound });
      }
      const filePath = resolveArtifactFilePath(artifact);
      if (!filePath || !existsSync(filePath)) {
        return reply.status(404).send({ error: ARTIFACT_ROUTE_ERROR_MESSAGES.artifactNotFound });
      }

      const stat = statSync(filePath);
      reply.header('Content-Type', artifact.mimeType ?? 'application/octet-stream');
      reply.header('Content-Length', String(stat.size));
      // RFC 5987 的 filename* 保证中文 / 特殊字符文件名不乱码；客户端以元数据里的
      // 名字为准，这里的响应头只是兜底。
      reply.header(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(artifact.name)}`,
      );
      return reply.send(createReadStream(filePath));
    },
  );

  /**
   * 删除磁盘型产物（索引 + 磁盘文件）。
   *
   * 主要消费方是待发队列：条目带着附件一起离开队列时，需要把为跨端存储上传的副本
   * 回收掉。队列条目的常规删除走服务端联动清理（见 `session-composer-queue.ts`），
   * 这里覆盖的是「条目已被删除、但上传刚完成」的孤儿窗口。
   */
  app.delete<{ Params: { artifactId: string; sessionId: string } }>(
    '/sessions/:sessionId/artifacts/:artifactId',
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = request.user as JwtPayload;
      const { artifactId, sessionId } = request.params;
      const owned = await ensureSessionOwned(sessionId, user.sub);
      if (!owned) {
        return reply.status(404).send({ error: ARTIFACT_ROUTE_ERROR_MESSAGES.sessionNotFound });
      }

      const artifact = getGatewayArtifactManager().get(artifactId);
      if (!artifact || artifact.sessionId !== sessionId) {
        return reply.status(404).send({ error: ARTIFACT_ROUTE_ERROR_MESSAGES.artifactNotFound });
      }
      const removed = getGatewayArtifactManager().remove(artifactId);
      return reply.send({ ok: true, removed });
    },
  );
}
