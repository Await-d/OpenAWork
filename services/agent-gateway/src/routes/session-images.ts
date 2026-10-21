import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import type { JwtPayload } from '../infra/auth.js';
import { parseBody } from '../infra/parse-request.js';
import { requireAuth } from '../infra/auth.js';
import { createArtifact, getArtifactById } from '../session/artifact-content-store.js';
import { sqliteGet } from '../infra/db.js';
import {
  imageGenerationRequestSchema,
  resolveImageGenerationDefaults,
  type ImageGenerationRequest,
  type ResolveImageGenerationDefaultsResult,
} from '../image-generation/image-generation-schema.js';
import {
  editImagesWithOpenAi,
  generateImageStreamWithOpenAi,
  generateImagesWithOpenAi,
  OpenAiImageGenerationError,
  type OpenAiImageGenerationResult,
} from '../image-generation/openai-image-generation.js';
import { resolveModelRouteFromProvider } from '../provider/model-router.js';
import {
  getImageProviderConfig,
  parseStoredImageGenerationDefaults,
} from '../provider/provider-config.js';
import { getGatewayArtifactManager } from '../infra/artifact-manager.js';
import { createSseClientChannel } from './sse-client-channel.js';

interface UserSettingRow {
  value: string;
}

interface ResolvedImageInput {
  artifact: { id: string };
  bytes: Buffer;
  fileName: string;
  mimeType: string;
}

type ImageProviderConfig = NonNullable<Awaited<ReturnType<typeof getImageProviderConfig>>>;
type ModelRoute = ReturnType<typeof resolveModelRouteFromProvider>;

/** 生成所需的全部输入——已通过校验、可直接执行上游调用。 */
interface PreparedImageGeneration {
  imageProviderConfig: ImageProviderConfig;
  inputArtifact: ResolvedImageInput | null;
  maskArtifact: ResolvedImageInput | null;
  prompt: string;
  resolved: ResolveImageGenerationDefaultsResult;
  route: ModelRoute;
}

type PrepareImageGenerationResult =
  { ok: true; value: PreparedImageGeneration } | { ok: false; body: unknown; status: number };

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

/**
 * 单批多张时用 `index` 区分文件名：同名文件在产物列表 / 导出时会互相覆盖，
 * 而 prompt 相同的两批结果本来就会落到同一文件名上。
 */
function buildImageFileName(prompt: string, extension: string, index?: number): string {
  const base = buildImageArtifactTitle(prompt)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-')
    .replace(/^-+|-+$/g, '');
  const indexSuffix = index === undefined ? '' : `-${index}`;
  return `${base || 'generated-image'}${indexSuffix}-${createHash('sha1').update(prompt).digest('hex').slice(0, 8)}.${extension}`;
}

function inferImageFileExtension(mimeType: string): string {
  if (mimeType === 'image/jpeg') {
    return 'jpg';
  }

  if (mimeType === 'image/webp') {
    return 'webp';
  }

  if (mimeType === 'image/gif') {
    return 'gif';
  }

  if (mimeType === 'image/svg+xml') {
    return 'svg';
  }

  return 'png';
}

function inferImageMimeTypeFromName(fileName: string): string | null {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) {
    return 'image/jpeg';
  }
  if (lowerName.endsWith('.png')) {
    return 'image/png';
  }
  if (lowerName.endsWith('.webp')) {
    return 'image/webp';
  }
  if (lowerName.endsWith('.gif')) {
    return 'image/gif';
  }
  return null;
}

function resolveImageMimeType(fileName: string, mimeType: string | undefined): string | null {
  if (mimeType?.startsWith('image/')) {
    return mimeType === 'image/jpg' ? 'image/jpeg' : mimeType;
  }
  return inferImageMimeTypeFromName(fileName);
}

function parseStoredImageArtifactContent(
  content: string,
): { bytes: Buffer; mimeType: string } | null {
  const match = content.match(/^data:(image\/[^;,]+)(?:;[^,]*)?;base64,([\s\S]+)$/);
  if (!match) {
    return null;
  }

  const mimeType = match[1];
  const base64 = match[2];
  if (!mimeType || !base64) {
    return null;
  }

  return {
    bytes: Buffer.from(base64, 'base64'),
    mimeType,
  };
}

function buildMessageSummary(input: {
  count: number;
  edited: boolean;
  modelId: string;
  outputFormat: string;
  prompt: string;
  revisedPrompt?: string;
  size: string;
}): string {
  const base = `${input.edited ? '已编辑' : '已生成'} ${input.count} 张图片（${input.modelId} · ${input.size} · ${input.outputFormat.toUpperCase()}）。`;
  if (input.revisedPrompt && input.revisedPrompt.trim() !== input.prompt.trim()) {
    return `${base} 上游已对提示词做轻微改写。`;
  }
  return base;
}

/**
 * 从磁盘型产物索引里解析输入图（参考图 / 遮罩共用）。
 *
 * 管理器的单例在调用点获取（不在模块顶层缓存）：它和 artifacts 路由共享同一份内存
 * 索引（两份视图会互相覆盖，见 `infra/artifact-manager.ts`），而索引路径取决于
 * 环境变量——模块级常量会在 import 时把它钉死。
 */
async function resolveInputArtifact(input: {
  artifactId: string;
  sessionId: string;
  userId: string;
}): Promise<ResolvedImageInput | null> {
  const artifacts = await getGatewayArtifactManager().list(input.sessionId);
  const artifact = artifacts.find((item) => item.id === input.artifactId);
  if (artifact?.path) {
    const mimeType = resolveImageMimeType(artifact.name, artifact.mimeType);
    if (!mimeType) {
      return null;
    }

    return {
      artifact,
      bytes: await readFile(artifact.path),
      fileName: artifact.name,
      mimeType,
    };
  }

  const contentArtifact = getArtifactById(input.userId, input.artifactId);
  if (!contentArtifact || contentArtifact.sessionId !== input.sessionId) {
    return null;
  }

  const parsedContent = parseStoredImageArtifactContent(contentArtifact.content);
  if (!parsedContent) {
    return null;
  }

  const storedMimeType =
    typeof contentArtifact.metadata['mimeType'] === 'string'
      ? contentArtifact.metadata['mimeType']
      : parsedContent.mimeType;
  const storedFileName =
    typeof contentArtifact.metadata['fileName'] === 'string'
      ? contentArtifact.metadata['fileName']
      : undefined;
  const mimeType =
    resolveImageMimeType(storedFileName ?? contentArtifact.id, storedMimeType) ??
    parsedContent.mimeType;

  return {
    artifact: { id: contentArtifact.id },
    bytes: parsedContent.bytes,
    fileName: storedFileName ?? `${contentArtifact.id}.${inferImageFileExtension(mimeType)}`,
    mimeType,
  };
}

function buildClientError(input: { code: string; message: string; retryable?: boolean }): {
  error: { code: string; message: string; retryable: boolean };
} {
  return {
    error: {
      code: input.code,
      message: input.message,
      retryable: input.retryable ?? false,
    },
  };
}

/**
 * 校验请求并解析出执行所需的全部输入。
 *
 * 非流式与流式两个端点的前置校验完全一致——它们只是上游调用方式不同，
 * 因此校验逻辑必须只有一份，否则「JSON 端点拒绝、SSE 端点放行」的偏差会直接
 * 变成安全问题（例如遮罩绕过参考图校验）。
 */
async function prepareImageGeneration(input: {
  parsed: ImageGenerationRequest;
  sessionId: string;
  userId: string;
}): Promise<PrepareImageGenerationResult> {
  const { parsed, sessionId, userId } = input;
  const providersRow = sqliteGet<UserSettingRow>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = 'providers'`,
    [userId],
  );
  const selectionRow = sqliteGet<UserSettingRow>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = 'active_selection'`,
    [userId],
  );
  const defaultsRow = sqliteGet<UserSettingRow>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = 'image_generation_defaults'`,
    [userId],
  );

  const imageProviderConfig = await getImageProviderConfig(
    parseStoredJson(providersRow?.value),
    parseStoredJson(selectionRow?.value),
  );
  if (!imageProviderConfig) {
    return {
      ok: false,
      status: 400,
      body: buildClientError({
        code: 'image_model_not_configured',
        message: '当前未配置可用的图片生成模型。',
      }),
    };
  }

  const defaults = parseStoredImageGenerationDefaults(parseStoredJson(defaultsRow?.value));
  const resolved = resolveImageGenerationDefaults(parsed, defaults, {
    modelId: imageProviderConfig.modelId,
  });
  if (resolved.backgroundNotice) {
    return {
      ok: false,
      status: 400,
      body: buildClientError({
        code: 'image_parameters_invalid',
        message: resolved.backgroundNotice,
      }),
    };
  }

  const inputArtifact = parsed.inputArtifacts?.[0]
    ? await resolveInputArtifact({
        artifactId: parsed.inputArtifacts[0].artifactId,
        sessionId,
        userId,
      })
    : null;
  if (parsed.inputArtifacts?.[0] && !inputArtifact) {
    return {
      ok: false,
      status: 400,
      body: buildClientError({
        code: 'image_input_invalid',
        message: '参考图不存在、不可访问，或不是受支持的图片类型。',
      }),
    };
  }

  const maskArtifact = parsed.maskArtifact
    ? await resolveInputArtifact({
        artifactId: parsed.maskArtifact.artifactId,
        sessionId,
        userId,
      })
    : null;
  if (parsed.maskArtifact && !maskArtifact) {
    return {
      ok: false,
      status: 400,
      body: buildClientError({
        code: 'image_mask_invalid',
        message: '遮罩图不存在、不可访问，或不是受支持的图片类型。',
      }),
    };
  }
  if (maskArtifact && !inputArtifact) {
    return {
      ok: false,
      status: 400,
      body: buildClientError({
        code: 'image_mask_invalid',
        message: '局部编辑需要先选择参考图——遮罩必须作用在一张待编辑的图上。',
      }),
    };
  }

  return {
    ok: true,
    value: {
      imageProviderConfig,
      inputArtifact,
      maskArtifact,
      prompt: parsed.prompt,
      resolved,
      route: resolveModelRouteFromProvider(
        imageProviderConfig.provider,
        imageProviderConfig.modelId,
        { maxTokens: 1, temperature: 1 },
      ),
    },
  };
}

/** 逐张落库，返回与 `generatedImages` 同序的产物列表。 */
function persistGeneratedImages(input: {
  context: PreparedImageGeneration;
  generatedImages: OpenAiImageGenerationResult[];
  sessionId: string;
  userId: string;
}): Array<ReturnType<typeof createArtifact>> {
  const { context, generatedImages, sessionId, userId } = input;
  const { imageProviderConfig, inputArtifact, maskArtifact, prompt, resolved } = context;

  return generatedImages.map((generated, index) =>
    createArtifact(userId, {
      sessionId,
      title: buildImageArtifactTitle(prompt),
      content: `data:${generated.mimeType};base64,${generated.bytes.toString('base64')}`,
      type: 'image',
      fileName: buildImageFileName(
        prompt,
        inferImageFileExtension(generated.mimeType),
        generatedImages.length > 1 ? index + 1 : undefined,
      ),
      mimeType: generated.mimeType,
      metadata: {
        sourceKind: inputArtifact ? 'gpt_image_2_edit' : 'gpt_image_2_generation',
        ...(inputArtifact ? { sourceArtifactId: inputArtifact.artifact.id } : {}),
        ...(maskArtifact ? { maskArtifactId: maskArtifact.artifact.id } : {}),
        providerId: imageProviderConfig.provider.id,
        modelId: imageProviderConfig.modelId,
        prompt,
        revisedPrompt: generated.revisedPrompt,
        size: resolved.size,
        quality: resolved.quality,
        outputFormat: resolved.outputFormat,
        background: resolved.background,
        moderation: resolved.moderation,
        outputCompression: resolved.outputCompression,
        requestId: generated.requestId,
        ...(generatedImages.length > 1
          ? { batchIndex: index + 1, batchSize: generatedImages.length }
          : {}),
      },
      createdBy: 'agent',
      createdByNote: `${imageProviderConfig.modelId} ${inputArtifact ? 'edit' : 'generation'}`,
    }),
  );
}

function buildImageGenerationResponse(input: {
  artifacts: Array<ReturnType<typeof createArtifact>>;
  context: PreparedImageGeneration;
  generatedImages: OpenAiImageGenerationResult[];
}): { artifact: ReturnType<typeof createArtifact>; [key: string]: unknown } | null {
  const { artifacts, context, generatedImages } = input;
  const primaryArtifact = artifacts[0];
  if (!primaryArtifact) {
    return null;
  }

  const { imageProviderConfig, inputArtifact, prompt, resolved } = context;

  return {
    // `artifact` 是既有客户端的读取字段（取首张），`artifacts` 承载 n>1 的全部结果。
    artifact: primaryArtifact,
    artifacts,
    revisedPrompt: generatedImages[0]?.revisedPrompt ?? null,
    parameters: {
      providerId: imageProviderConfig.provider.id,
      modelId: imageProviderConfig.modelId,
      size: resolved.size,
      quality: resolved.quality,
      outputFormat: resolved.outputFormat,
      background: resolved.background,
      moderation: resolved.moderation,
      outputCompression: resolved.outputCompression,
      count: artifacts.length,
    },
    messageSummary: buildMessageSummary({
      count: artifacts.length,
      edited: Boolean(inputArtifact),
      modelId: imageProviderConfig.modelId,
      outputFormat: resolved.outputFormat,
      prompt,
      revisedPrompt: generatedImages[0]?.revisedPrompt,
      size: resolved.size,
    }),
  };
}

function logUpstreamImageError(input: {
  context: PreparedImageGeneration;
  error: OpenAiImageGenerationError;
  log: { warn: (fields: Record<string, unknown>, message: string) => void };
  sessionId: string;
  userId: string;
}): void {
  const { context, error, log, sessionId, userId } = input;
  // 官方要求：`error.code` 是稳定判别依据，`moderation_details` 只进日志与排查链路。
  if (!error.code && !error.upstreamType) {
    return;
  }

  log.warn(
    {
      code: error.code,
      moderationCategories: error.moderationCategories,
      moderationStage: error.moderationStage,
      modelId: context.imageProviderConfig.modelId,
      sessionId,
      upstreamType: error.upstreamType,
      userId,
    },
    'image generation rejected by upstream',
  );
}

function toClientImageError(error: OpenAiImageGenerationError): {
  code: string;
  message: string;
  retryable: boolean;
} {
  return {
    code: error.code === 'moderation_blocked' ? 'moderation_blocked' : 'image_generation_failed',
    message: error.message,
    retryable: error.retryable,
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
        return reply.status(404).send({ error: '目标会话不存在。' });
      }

      const parsed = parseBody(imageGenerationRequestSchema, request.body);
      const prepared = await prepareImageGeneration({ parsed, sessionId, userId: user.sub });
      if (!prepared.ok) {
        return reply.status(prepared.status).send(prepared.body);
      }

      const context = prepared.value;
      const { inputArtifact, maskArtifact, prompt, resolved, route } = context;

      try {
        const generatedImages = inputArtifact
          ? await editImagesWithOpenAi({
              apiBaseUrl: route.apiBaseUrl,
              apiKey: route.apiKey,
              background: resolved.background,
              count: resolved.count,
              inputImage: {
                bytes: inputArtifact.bytes,
                fileName: inputArtifact.fileName,
                mimeType: inputArtifact.mimeType,
              },
              ...(maskArtifact
                ? {
                    mask: {
                      bytes: maskArtifact.bytes,
                      fileName: maskArtifact.fileName,
                      mimeType: maskArtifact.mimeType,
                    },
                  }
                : {}),
              model: route.model,
              moderation: resolved.moderation,
              outputCompression: resolved.outputCompression,
              outputFormat: resolved.outputFormat,
              prompt,
              providerType: route.providerType,
              quality: resolved.quality,
              requestOverrides: route.requestOverrides,
              size: resolved.size,
            })
          : await generateImagesWithOpenAi({
              apiBaseUrl: route.apiBaseUrl,
              apiKey: route.apiKey,
              background: resolved.background,
              count: resolved.count,
              model: route.model,
              moderation: resolved.moderation,
              outputCompression: resolved.outputCompression,
              outputFormat: resolved.outputFormat,
              prompt,
              providerType: route.providerType,
              quality: resolved.quality,
              requestOverrides: route.requestOverrides,
              size: resolved.size,
            });

        const artifacts = persistGeneratedImages({
          context,
          generatedImages,
          sessionId,
          userId: user.sub,
        });
        const payload = buildImageGenerationResponse({ artifacts, context, generatedImages });
        if (!payload) {
          return reply.status(502).send(
            buildClientError({
              code: 'image_generation_failed',
              message: '图片生成未返回可用的图像数据。',
            }),
          );
        }

        return reply.status(201).send(payload);
      } catch (error) {
        if (error instanceof OpenAiImageGenerationError) {
          logUpstreamImageError({ context, error, log: request.log, sessionId, userId: user.sub });
          return reply.status(error.statusCode).send({ error: toClientImageError(error) });
        }

        request.log.error({ err: error, sessionId, userId: user.sub }, 'failed to generate image');
        return reply.status(500).send(
          buildClientError({
            code: 'image_generation_failed',
            message: '图片生成失败，请稍后重试。',
            retryable: true,
          }),
        );
      }
    },
  );

  /**
   * 流式生图：与上面同一套校验，只是把上游的 `stream: true` + `partial_images`
   * 中间稿实时透出，最后仍按同样的契约落库并下发 `done`。
   *
   * 事件：`partial`（中间稿预览）→ `done`（与 JSON 端点同构的产物负载）；
   * 失败时下发 `error`（结构同 JSON 端点的 `error` 对象）。`n > 1` 不在流式路径上
   * 支持——中间稿与「第几张结果」的对应关系官方未定义，客户端应改用非流式端点。
   */
  app.post<{ Params: { sessionId: string }; Body: unknown }>(
    '/sessions/:sessionId/images/generations/stream',
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = request.user as JwtPayload;
      const { sessionId } = request.params;
      const owned = await ensureSessionOwned(sessionId, user.sub);
      if (!owned) {
        return reply.status(404).send({ error: '目标会话不存在。' });
      }

      const parsed = parseBody(imageGenerationRequestSchema, request.body);
      const prepared = await prepareImageGeneration({ parsed, sessionId, userId: user.sub });
      if (!prepared.ok) {
        return reply.status(prepared.status).send(prepared.body);
      }

      const context = prepared.value;
      const { prompt, resolved, route } = context;
      const upstreamAbort = new AbortController();

      return new Promise<void>((resolve) => {
        // 手动接管响应：`close()` 负责 rawEnd，`resolve` 作为最后一个 teardown 让
        // Fastify 知道「已结束」，否则它会在已经 end 的 raw 流上再补一次 send。
        // 同款处理见 `session-terminals` / `/mcp/events`。
        const channel = createSseClientChannel({
          rawWrite: (chunk) => reply.raw.write(chunk),
          rawEnd: () => reply.raw.end(),
        });
        const onClientClose = (): void => channel.close();
        channel.addTeardown(() => request.raw.off('close', onClientClose));
        // 客户端断开要立刻取消上游请求，否则这张图会白花钱继续生成。
        channel.addTeardown(() => upstreamAbort.abort());
        channel.addTeardown(resolve);

        reply.raw.writeHead(200, {
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'Content-Type': 'text/event-stream',
          'X-Accel-Buffering': 'no',
        });
        request.raw.on('close', onClientClose);

        const writeEvent = (event: string, data: unknown): void => {
          channel.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };

        void (async () => {
          try {
            const generated = await generateImageStreamWithOpenAi(
              {
                apiBaseUrl: route.apiBaseUrl,
                apiKey: route.apiKey,
                background: resolved.background,
                model: route.model,
                moderation: resolved.moderation,
                outputCompression: resolved.outputCompression,
                outputFormat: resolved.outputFormat,
                prompt,
                providerType: route.providerType,
                quality: resolved.quality,
                requestOverrides: route.requestOverrides,
                signal: upstreamAbort.signal,
                size: resolved.size,
              },
              {
                onPartial: (partial) => {
                  writeEvent('partial', {
                    index: partial.index,
                    mimeType: partial.mimeType,
                    partialImageBase64: partial.bytes.toString('base64'),
                  });
                },
              },
            );

            const artifacts = persistGeneratedImages({
              context,
              generatedImages: [generated],
              sessionId,
              userId: user.sub,
            });
            const payload = buildImageGenerationResponse({
              artifacts,
              context,
              generatedImages: [generated],
            });
            if (!payload) {
              writeEvent('error', {
                code: 'image_generation_failed',
                message: '图片生成未返回可用的图像数据。',
                retryable: false,
              });
              return;
            }

            writeEvent('done', payload);
          } catch (error) {
            if (error instanceof OpenAiImageGenerationError) {
              logUpstreamImageError({
                context,
                error,
                log: request.log,
                sessionId,
                userId: user.sub,
              });
              writeEvent('error', toClientImageError(error));
              return;
            }

            request.log.error(
              { err: error, sessionId, userId: user.sub },
              'failed to stream image generation',
            );
            writeEvent('error', {
              code: 'image_generation_failed',
              message: '图片生成失败，请稍后重试。',
              retryable: true,
            });
          } finally {
            channel.close();
          }
        })();
      });
    },
  );
}
