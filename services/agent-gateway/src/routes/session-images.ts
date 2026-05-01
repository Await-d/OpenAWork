import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { ArtifactManagerImpl } from '@openAwork/artifacts';
import type { JwtPayload } from '../auth.js';
import { requireAuth } from '../auth.js';
import { createArtifact } from '../artifact-content-store.js';
import { sqliteGet } from '../db.js';
import {
  imageGenerationRequestSchema,
  resolveImageGenerationDefaults,
} from '../image-generation/image-generation-schema.js';
import {
  editImageWithOpenAi,
  generateImageWithOpenAi,
  OpenAiImageGenerationError,
} from '../image-generation/openai-image-generation.js';
import { resolveModelRouteFromProvider } from '../model-router.js';
import { getImageProviderConfig, parseStoredImageGenerationDefaults } from '../provider-config.js';
import { resolveGatewayArtifactsIndexPath } from '../storage-paths.js';

interface UserSettingRow {
  value: string;
}

const uploadedArtifactManager = new ArtifactManagerImpl({
  indexFilePath: resolveGatewayArtifactsIndexPath(),
});

function parseStoredJson(value: string | undefined): unknown {
  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

async function ensureSessionOwned(sessionId: string, userId: string): Promise<boolean> {
  const row = sqliteGet<{ id: string }>(
    'SELECT id FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
    [sessionId, userId],
  );
  return Boolean(row?.id);
}

function buildImageArtifactTitle(prompt: string): string {
  const normalized = prompt.trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return 'GPT Image 2 生成结果';
  }

  return normalized.length > 48 ? `${normalized.slice(0, 48)}…` : normalized;
}

function buildImageFileName(prompt: string, extension: string): string {
  const base = buildImageArtifactTitle(prompt)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-')
    .replace(/^-+|-+$/g, '');
  return `${base || 'gpt-image-2'}-${createHash('sha1').update(prompt).digest('hex').slice(0, 8)}.${extension}`;
}

function buildMessageSummary(input: {
  edited: boolean;
  modelId: string;
  outputFormat: string;
  prompt: string;
  revisedPrompt?: string;
  size: string;
}): string {
  const base = `${input.edited ? '已编辑' : '已生成'} 1 张图片（${input.modelId} · ${input.size} · ${input.outputFormat.toUpperCase()}）。`;
  if (input.revisedPrompt && input.revisedPrompt.trim() !== input.prompt.trim()) {
    return `${base} 上游已对提示词做轻微改写。`;
  }
  return base;
}

async function resolveInputArtifact(input: { artifactId: string; sessionId: string }) {
  const artifacts = await uploadedArtifactManager.list(input.sessionId);
  const artifact = artifacts.find((item) => item.id === input.artifactId);
  if (!artifact?.path) {
    return null;
  }

  const mimeType = artifact.mimeType ?? 'application/octet-stream';
  if (!mimeType.startsWith('image/')) {
    return null;
  }

  return {
    artifact,
    bytes: await readFile(artifact.path),
    fileName: artifact.name,
    mimeType,
  };
}

export async function sessionImagesRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { sessionId: string }; Body: unknown }>(
    '/sessions/:sessionId/images/generations',
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = request.params;
      const owned = await ensureSessionOwned(sessionId, user.sub);
      if (!owned) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      const parsed = imageGenerationRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: 'Invalid image generation payload', issues: parsed.error.issues });
      }

      const providersRow = sqliteGet<UserSettingRow>(
        `SELECT value FROM user_settings WHERE user_id = ? AND key = 'providers'`,
        [user.sub],
      );
      const selectionRow = sqliteGet<UserSettingRow>(
        `SELECT value FROM user_settings WHERE user_id = ? AND key = 'active_selection'`,
        [user.sub],
      );
      const defaultsRow = sqliteGet<UserSettingRow>(
        `SELECT value FROM user_settings WHERE user_id = ? AND key = 'image_generation_defaults'`,
        [user.sub],
      );

      const imageProviderConfig = await getImageProviderConfig(
        parseStoredJson(providersRow?.value),
        parseStoredJson(selectionRow?.value),
      );
      if (!imageProviderConfig) {
        return reply.status(400).send({
          error: {
            code: 'image_model_not_configured',
            message: '当前未配置可用的图片生成模型。',
            retryable: false,
          },
        });
      }

      const defaults = parseStoredImageGenerationDefaults(parseStoredJson(defaultsRow?.value));
      const resolved = resolveImageGenerationDefaults(parsed.data, defaults);
      const route = resolveModelRouteFromProvider(
        imageProviderConfig.provider,
        imageProviderConfig.modelId,
        { maxTokens: 1, temperature: 1 },
      );

      try {
        const inputArtifact = parsed.data.inputArtifacts?.[0]
          ? await resolveInputArtifact({
              artifactId: parsed.data.inputArtifacts[0].artifactId,
              sessionId,
            })
          : null;
        if (parsed.data.inputArtifacts?.[0] && !inputArtifact) {
          return reply.status(400).send({
            error: {
              code: 'image_input_invalid',
              message: '参考图不存在、不可访问，或不是受支持的图片类型。',
              retryable: false,
            },
          });
        }

        const generated = inputArtifact
          ? await editImageWithOpenAi({
              apiBaseUrl: route.apiBaseUrl,
              apiKey: route.apiKey,
              background: resolved.background,
              inputImage: {
                bytes: inputArtifact.bytes,
                fileName: inputArtifact.fileName,
                mimeType: inputArtifact.mimeType,
              },
              model: route.model,
              outputFormat: resolved.outputFormat,
              prompt: parsed.data.prompt,
              providerType: route.providerType,
              quality: resolved.quality,
              requestOverrides: route.requestOverrides,
              size: resolved.size,
            })
          : await generateImageWithOpenAi({
              apiBaseUrl: route.apiBaseUrl,
              apiKey: route.apiKey,
              background: resolved.background,
              model: route.model,
              outputFormat: resolved.outputFormat,
              prompt: parsed.data.prompt,
              providerType: route.providerType,
              quality: resolved.quality,
              requestOverrides: route.requestOverrides,
              size: resolved.size,
            });

        const contentBase64 = generated.bytes.toString('base64');
        const content = `data:${generated.mimeType};base64,${contentBase64}`;
        const fileExtension =
          generated.outputFormat === 'jpeg'
            ? 'jpg'
            : generated.outputFormat === 'webp'
              ? 'webp'
              : 'png';
        const artifact = createArtifact(user.sub, {
          sessionId,
          title: buildImageArtifactTitle(parsed.data.prompt),
          content,
          type: 'image',
          fileName: buildImageFileName(parsed.data.prompt, fileExtension),
          mimeType: generated.mimeType,
          metadata: {
            sourceKind: inputArtifact ? 'gpt_image_2_edit' : 'gpt_image_2_generation',
            ...(inputArtifact ? { sourceArtifactId: inputArtifact.artifact.id } : {}),
            providerId: imageProviderConfig.provider.id,
            modelId: imageProviderConfig.modelId,
            prompt: parsed.data.prompt,
            revisedPrompt: generated.revisedPrompt,
            size: resolved.size,
            quality: resolved.quality,
            outputFormat: resolved.outputFormat,
            background: resolved.background,
            requestId: generated.requestId,
          },
          createdBy: 'agent',
          createdByNote: 'gpt-image-2 generation',
        });

        return reply.status(201).send({
          artifact,
          revisedPrompt: generated.revisedPrompt ?? null,
          parameters: {
            providerId: imageProviderConfig.provider.id,
            modelId: imageProviderConfig.modelId,
            size: resolved.size,
            quality: resolved.quality,
            outputFormat: resolved.outputFormat,
            background: resolved.background,
          },
          messageSummary: buildMessageSummary({
            edited: Boolean(inputArtifact),
            modelId: imageProviderConfig.modelId,
            outputFormat: resolved.outputFormat,
            prompt: parsed.data.prompt,
            revisedPrompt: generated.revisedPrompt,
            size: resolved.size,
          }),
        });
      } catch (error) {
        if (error instanceof OpenAiImageGenerationError) {
          return reply.status(error.statusCode).send({
            error: {
              code: 'image_generation_failed',
              message: error.message,
              retryable: error.retryable,
            },
          });
        }

        request.log.error({ err: error, sessionId, userId: user.sub }, 'failed to generate image');
        return reply.status(500).send({
          error: {
            code: 'image_generation_failed',
            message: '图片生成失败，请稍后重试。',
            retryable: true,
          },
        });
      }
    },
  );
}
