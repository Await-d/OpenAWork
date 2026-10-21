import type { RequestOverrides } from '@openAwork/agent-core';
import {
  getImageGenerationSizeTier,
  IMAGE_GENERATION_PARTIAL_IMAGES_RANGE,
  type ImageGenerationBackground,
  type ImageGenerationModeration,
  type ImageGenerationOutputFormat,
  type ImageGenerationQuality,
} from '@openAwork/shared';
import {
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
  resolveHttpBodyLimitBytes,
} from '../infra/http-body-limit.js';

export type ImageGenerationSize = string;

// Memory bound for an upstream image-generation/edit response. `apiBaseUrl`
// is a user-configured provider endpoint, so a misbehaving / hostile relay
// could stream unbounded bytes and OOM the gateway — the wall-clock-only
// caller signal does NOT bound memory (§0.124/§0.125 class). Image payloads
// are base64 (legitimately several MB at 4K), so the default is generous but
// still finite; override via OPENAWORK_IMAGE_RESPONSE_MAX_BYTES, 0 disables.
const DEFAULT_IMAGE_RESPONSE_MAX_BYTES = 64 * 1024 * 1024;
function resolveImageResponseMaxBytes(): number {
  return resolveHttpBodyLimitBytes(
    'OPENAWORK_IMAGE_RESPONSE_MAX_BYTES',
    DEFAULT_IMAGE_RESPONSE_MAX_BYTES,
  );
}

interface OpenAiImageGenerationInput {
  apiBaseUrl: string;
  apiKey: string;
  background: ImageGenerationBackground;
  /**
   * 单次请求生成张数（官方 `n` 参数）。`1` 时**不发送**该字段——
   * 部分中转对 `n` 支持不完整，多送一个默认值反而会把正常请求打成 400。
   */
  count?: number | undefined;
  model: string;
  /** 内容审核严格度；GPT Image 起才有该参数。 */
  moderation: ImageGenerationModeration;
  /** 压缩率百分比，仅 jpeg / webp 生效；缺省表示不发送。 */
  outputCompression?: number | undefined;
  outputFormat: ImageGenerationOutputFormat;
  prompt: string;
  providerType?: string;
  quality: ImageGenerationQuality;
  requestOverrides: RequestOverrides;
  signal?: AbortSignal;
  size: ImageGenerationSize;
}

interface OpenAiImageEditInput extends OpenAiImageGenerationInput {
  inputImage: {
    bytes: Buffer;
    fileName: string;
    mimeType: string;
  };
  /**
   * 局部编辑遮罩。官方要求与输入图**格式、尺寸一致**（均 < 50MB）且必须带
   * alpha 通道——尺寸与 alpha 的校验交给上游，失败时按其错误文案回传。
   */
  mask?: {
    bytes: Buffer;
    fileName: string;
    mimeType: string;
  };
}

export interface OpenAiImageGenerationResult {
  bytes: Buffer;
  mimeType: string;
  outputFormat: ImageGenerationOutputFormat;
  prompt: string;
  quality: ImageGenerationQuality;
  requestId?: string;
  revisedPrompt?: string;
  size: ImageGenerationSize;
}

export class OpenAiImageGenerationError extends Error {
  /** 上游 `error.code`——官方指定的稳定判别依据（例如 `moderation_blocked`）。 */
  public readonly code?: string;

  /** 仅用于日志/排查，禁止直接展示给终端用户。 */
  public readonly moderationCategories?: string[];

  /** 仅用于日志/排查，禁止直接展示给终端用户。 */
  public readonly moderationStage?: string;

  public readonly retryable: boolean;

  public readonly statusCode: number;

  /** 上游 `error.type`（例如 `image_generation_user_error`）。 */
  public readonly upstreamType?: string;

  public constructor(
    message: string,
    options: {
      code?: string | undefined;
      moderationCategories?: string[] | undefined;
      moderationStage?: string | undefined;
      retryable: boolean;
      statusCode: number;
      upstreamType?: string | undefined;
    },
  ) {
    super(message);
    this.name = 'OpenAiImageGenerationError';
    this.retryable = options.retryable;
    this.statusCode = options.statusCode;
    this.code = options.code;
    this.upstreamType = options.upstreamType;
    this.moderationStage = options.moderationStage;
    this.moderationCategories = options.moderationCategories;
  }
}

/** 官方：`error.code` 是稳定判别依据，`error.type = image_generation_user_error` 表示改动请求才可能成功。 */
const MODERATION_BLOCKED_CODE = 'moderation_blocked';
const IMAGE_GENERATION_USER_ERROR_TYPE = 'image_generation_user_error';
/** 配额类失败改提示词也没用，退避重试只会放大失败。 */
const NON_RETRYABLE_UPSTREAM_CODES: ReadonlySet<string> = new Set([
  'insufficient_quota',
  'billing_hard_limit_reached',
]);

export interface UpstreamImageErrorInfo {
  code?: string;
  /** 截断后的可读详情（来自 `error.message` 或原始 body）。 */
  detail: string | null;
  moderationCategories?: string[];
  moderationStage?: string;
  type?: string;
}

function truncateDetail(value: string): string {
  return value.length > 200 ? `${value.slice(0, 200)}…` : value;
}

/**
 * 解析上游错误体。官方错误契约：
 * `{ error: { type, code, moderation_details: { moderation_stage, categories } } }`。
 * `moderation_details` 只进日志与排查链路，不面向终端用户。
 */
export function extractUpstreamImageError(body?: string): UpstreamImageErrorInfo {
  if (!body) {
    return { detail: null };
  }

  try {
    const json = JSON.parse(body) as Record<string, unknown>;
    const error = json['error'];
    if (error && typeof error === 'object') {
      const record = error as Record<string, unknown>;
      const message = typeof record['message'] === 'string' ? record['message'] : undefined;
      const details = record['moderation_details'];
      let moderationStage: string | undefined;
      let moderationCategories: string[] | undefined;
      if (details && typeof details === 'object') {
        const detailRecord = details as Record<string, unknown>;
        moderationStage =
          typeof detailRecord['moderation_stage'] === 'string'
            ? detailRecord['moderation_stage']
            : undefined;
        if (Array.isArray(detailRecord['categories'])) {
          moderationCategories = detailRecord['categories'].filter(
            (item): item is string => typeof item === 'string',
          );
        }
      }

      return {
        code: typeof record['code'] === 'string' ? record['code'] : undefined,
        type: typeof record['type'] === 'string' ? record['type'] : undefined,
        moderationStage,
        moderationCategories,
        detail: message ? truncateDetail(message) : null,
      };
    }
  } catch {
    // not JSON, use raw body
  }

  return { detail: truncateDetail(body) };
}

function isRetryableUpstreamImageFailure(input: {
  errorCode?: string | undefined;
  errorType?: string | undefined;
  statusCode: number;
}): boolean {
  if (input.errorType === IMAGE_GENERATION_USER_ERROR_TYPE) {
    return false;
  }

  if (
    input.errorCode === MODERATION_BLOCKED_CODE ||
    (input.errorCode !== undefined && NON_RETRYABLE_UPSTREAM_CODES.has(input.errorCode))
  ) {
    return false;
  }

  return input.statusCode >= 500 || input.statusCode === 429;
}

function moderationBlockedMessage(stage: string | undefined): string {
  const base = '图片生成请求未通过内容安全审核，因此被拒绝。';
  if (stage === 'output') {
    return `${base}生成结果被下游安全检查拦截，请修改提示词后重试。`;
  }
  if (stage === 'input') {
    return `${base}请调整提示词或参考图后重试。`;
  }
  return `${base}请调整提示词或参考图后重试。`;
}

function buildUpstreamImageGenerationError(input: {
  size: ImageGenerationSize;
  statusCode: number;
  upstreamBody: string | undefined;
}): OpenAiImageGenerationError {
  const { statusCode, upstreamBody } = input;
  const info = extractUpstreamImageError(upstreamBody);
  const tier = getImageGenerationSizeTier(input.size);
  const fourKHint =
    tier === '4k'
      ? ' 提示：4K 是实验性功能，您当前的中转/服务可能不支持，建议改用 2K（如 2048x1152）重试。'
      : '';
  const suffix = info.detail ? ` (${info.detail})` : '';

  const shared = {
    code: info.code,
    upstreamType: info.type,
    moderationStage: info.moderationStage,
    moderationCategories: info.moderationCategories,
    retryable: isRetryableUpstreamImageFailure({
      errorCode: info.code,
      errorType: info.type,
      statusCode,
    }),
    statusCode,
  } as const;

  if (info.code === MODERATION_BLOCKED_CODE) {
    return new OpenAiImageGenerationError(moderationBlockedMessage(info.moderationStage), shared);
  }

  if (statusCode === 400) {
    return new OpenAiImageGenerationError(
      `图片生成请求被上游拒绝，请检查模型配置与请求参数。${suffix}${fourKHint}`,
      shared,
    );
  }

  if (statusCode === 401 || statusCode === 403) {
    return new OpenAiImageGenerationError(
      `图片生成鉴权失败，请检查 OpenAI 提供商凭据。${suffix}`,
      shared,
    );
  }

  if (statusCode === 408) {
    const latencyHint =
      tier === '4k'
        ? '4K 可能耗时接近 6 分钟'
        : tier === '2k'
          ? '2K 通常约 1~3 分钟'
          : '1K 也可能因复杂 prompt 接近 2 分钟，请检查网络';
    return new OpenAiImageGenerationError(`图片生成超时（${latencyHint}）。${fourKHint}`, shared);
  }

  if (statusCode === 429) {
    return new OpenAiImageGenerationError(`图片生成请求过于频繁，请稍后重试。${suffix}`, shared);
  }

  return new OpenAiImageGenerationError(
    `图片生成上游服务暂时不可用 [HTTP ${statusCode}]，请稍后重试。${suffix}${fourKHint}`,
    shared,
  );
}

function applyImageGenerationOverrides(
  body: Record<string, unknown>,
  requestOverrides: RequestOverrides,
): Record<string, unknown> {
  // Per-request body (model/prompt/size/quality/output_format/background) reflects
  // the user's runtime selection on the chat page and must take precedence over
  // provider-level requestOverrides.body, otherwise picking different size/quality
  // in the chat composer silently does nothing whenever a model has overrides set.
  // Provider overrides may still inject extra fields not present in `body`.
  const nextBody = {
    ...(requestOverrides.body ?? {}),
    ...body,
  };

  for (const key of requestOverrides.omitBodyKeys ?? []) {
    delete nextBody[key];
  }

  return nextBody;
}

function setImageGenerationFormValue(form: FormData, key: string, value: unknown): void {
  if (value === undefined) {
    return;
  }

  if (value instanceof Blob) {
    form.set(key, value);
    return;
  }

  if (typeof value === 'string') {
    form.set(key, value);
    return;
  }

  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    form.set(key, String(value));
    return;
  }

  form.set(key, JSON.stringify(value));
}

/**
 * 生成与编辑共用的请求体。
 * `output_compression` 只在显式设置时发送——官方只对 jpeg / webp 定义该字段，
 * 带着 `undefined` 上送反而会被部分中转判成非法参数。
 */
function buildImageGenerationRequestBody(
  input: OpenAiImageGenerationInput,
): Record<string, unknown> {
  return {
    model: input.model,
    prompt: input.prompt,
    size: input.size,
    quality: input.quality,
    output_format: input.outputFormat,
    background: input.background,
    moderation: input.moderation,
    ...(input.count === undefined || input.count <= 1 ? {} : { n: input.count }),
    ...(input.outputCompression === undefined
      ? {}
      : { output_compression: input.outputCompression }),
  } satisfies Record<string, unknown>;
}

function buildImageEditFormData(input: OpenAiImageEditInput): FormData {
  const body = applyImageGenerationOverrides(
    buildImageGenerationRequestBody(input),
    input.requestOverrides,
  );
  const form = new FormData();

  for (const [key, value] of Object.entries(body)) {
    setImageGenerationFormValue(form, key, value);
  }

  const appendFile = (
    field: 'image' | 'mask',
    file: { bytes: Buffer; fileName: string; mimeType: string },
  ) => {
    // Uint8Array 视图是为了拿到独立 ArrayBuffer：Node 的 Buffer 可能指向共享
    // 内存池，直接交给 Blob 会把相邻数据一起带走。
    const bytes = new Uint8Array(file.bytes.byteLength);
    bytes.set(file.bytes);
    form.set(field, new Blob([bytes.buffer], { type: file.mimeType }), file.fileName);
  };

  if (!input.requestOverrides.omitBodyKeys?.includes('image')) {
    appendFile('image', input.inputImage);
  }

  if (input.mask && !input.requestOverrides.omitBodyKeys?.includes('mask')) {
    appendFile('mask', input.mask);
  }

  return form;
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { name?: unknown };
  return candidate.name === 'AbortError';
}

function inferMimeType(outputFormat: ImageGenerationOutputFormat): string {
  if (outputFormat === 'jpeg') {
    return 'image/jpeg';
  }

  if (outputFormat === 'webp') {
    return 'image/webp';
  }

  return 'image/png';
}

/**
 * 把上游 `data[]` 归一成图片结果列表。
 * 官方在 `n > 1` 时返回多张；单张请求也走同一条路径，避免两套解析逻辑漂移。
 */
function mapImageGenerationItems(input: {
  data: Array<{ b64_json?: string; revised_prompt?: string }> | undefined;
  emptyMessage: string;
  outputFormat: ImageGenerationOutputFormat;
  prompt: string;
  quality: ImageGenerationQuality;
  requestId: string | undefined;
  size: ImageGenerationSize;
}): OpenAiImageGenerationResult[] {
  const items = (input.data ?? []).filter(
    (item): item is { b64_json: string; revised_prompt?: string } =>
      typeof item?.b64_json === 'string' && item.b64_json.length > 0,
  );
  if (items.length === 0) {
    throw new OpenAiImageGenerationError(input.emptyMessage, {
      retryable: false,
      statusCode: 502,
    });
  }

  return items.map((item) => ({
    bytes: Buffer.from(item.b64_json, 'base64'),
    mimeType: inferMimeType(input.outputFormat),
    outputFormat: input.outputFormat,
    prompt: input.prompt,
    quality: input.quality,
    requestId: input.requestId,
    revisedPrompt: item.revised_prompt,
    size: input.size,
  }));
}

function firstImageOrThrow(
  images: OpenAiImageGenerationResult[],
  emptyMessage: string,
): OpenAiImageGenerationResult {
  const [first] = images;
  if (!first) {
    throw new OpenAiImageGenerationError(emptyMessage, {
      retryable: false,
      statusCode: 502,
    });
  }
  return first;
}

/** 生成一批图片（`count > 1` 时上游会返回多张）。 */
export async function generateImagesWithOpenAi(
  input: OpenAiImageGenerationInput,
): Promise<OpenAiImageGenerationResult[]> {
  if (!input.apiKey) {
    throw new OpenAiImageGenerationError('图片生成缺少可用的 OpenAI API Key。', {
      retryable: false,
      statusCode: 400,
    });
  }

  if (input.providerType !== 'openai') {
    throw new OpenAiImageGenerationError('图片生成仅支持 OpenAI 类型提供商。', {
      retryable: false,
      statusCode: 400,
    });
  }

  const baseBody = buildImageGenerationRequestBody(input);

  let response: Response;
  try {
    response = await fetch(`${input.apiBaseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(input.requestOverrides.headers ?? {}),
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify(applyImageGenerationOverrides(baseBody, input.requestOverrides)),
      signal: input.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new OpenAiImageGenerationError('图片生成已被取消。', {
        retryable: false,
        statusCode: 499,
      });
    }
    throw error;
  }

  if (!response.ok) {
    const upstreamBody = await readResponseTextWithLimit(
      response,
      resolveImageResponseMaxBytes(),
    ).catch(() => 'Unknown error');
    throw buildUpstreamImageGenerationError({
      size: input.size,
      statusCode: response.status,
      upstreamBody,
    });
  }

  const payload = await readResponseJsonWithLimit<{
    data?: Array<{ b64_json?: string; revised_prompt?: string }>;
  }>(response, resolveImageResponseMaxBytes());

  return mapImageGenerationItems({
    data: payload.data,
    emptyMessage: '图片生成未返回可用的图像数据。',
    outputFormat: input.outputFormat,
    prompt: input.prompt,
    quality: input.quality,
    requestId: response.headers.get('x-request-id') ?? undefined,
    size: input.size,
  });
}

/** 单张生成的薄封装（取首批结果中的第一张）。 */
export async function generateImageWithOpenAi(
  input: OpenAiImageGenerationInput,
): Promise<OpenAiImageGenerationResult> {
  return firstImageOrThrow(await generateImagesWithOpenAi(input), '图片生成未返回可用的图像数据。');
}

export interface OpenAiImagePartialImage {
  bytes: Buffer;
  index: number;
  mimeType: string;
}

export interface OpenAiImageStreamHandlers {
  /** 每收到一张中间稿回调一次；中间稿只用于预览，不应落库为产物。 */
  onPartial?: (partial: OpenAiImagePartialImage) => void;
}

const DEFAULT_STREAM_PARTIAL_IMAGES = 2;

/**
 * 从 SSE 帧里取出 `data:` 载荷。一帧可能带多行（`event:` / `id:` / 多个 `data:`），
 * 这里只关心 `data:`，按 SSE 规范用 `\n` 拼接。
 */
function readSseFrameData(frame: string): string | null {
  const dataLines: string[] = [];
  for (const rawLine of frame.split('\n')) {
    const line = rawLine.trimEnd();
    if (!line.startsWith('data:')) {
      continue;
    }
    dataLines.push(line.slice('data:'.length).trimStart());
  }
  return dataLines.length > 0 ? dataLines.join('\n') : null;
}

interface UpstreamImageStreamEvent {
  b64_json?: unknown;
  data?: unknown;
  partial_image_index?: unknown;
  revised_prompt?: unknown;
  type?: unknown;
}

/**
 * 流式生图（官方 Image API 的 `stream: true` + `partial_images`）。
 *
 * 事件契约：
 * - `image_generation.partial_image`：中间稿，带 `partial_image_index` 与 `b64_json`；
 * - `image_generation.completed`：最终图，带 `b64_json`。
 *
 * 官方未保证一定事件到达顺序 / 一定收满 `partial_images` 张，因此最终图按
 * 「completed 事件 → 最后一张中间稿」逐级兜底；中间稿只回调给调用方做预览，
 * 不参与落库。
 */
export async function generateImageStreamWithOpenAi(
  input: OpenAiImageGenerationInput,
  handlers: OpenAiImageStreamHandlers = {},
  options: { partialImages?: number } = {},
): Promise<OpenAiImageGenerationResult> {
  if (!input.apiKey) {
    throw new OpenAiImageGenerationError('图片生成缺少可用的 OpenAI API Key。', {
      retryable: false,
      statusCode: 400,
    });
  }

  if (input.providerType !== 'openai') {
    throw new OpenAiImageGenerationError('图片生成仅支持 OpenAI 类型提供商。', {
      retryable: false,
      statusCode: 400,
    });
  }

  const mimeType = inferMimeType(input.outputFormat);
  const requestedPartials = options.partialImages ?? DEFAULT_STREAM_PARTIAL_IMAGES;
  const partialImages = Math.min(
    Math.max(Math.trunc(requestedPartials), IMAGE_GENERATION_PARTIAL_IMAGES_RANGE.min),
    IMAGE_GENERATION_PARTIAL_IMAGES_RANGE.max,
  );
  // 流式路径固定出一张：中间稿与「第几张结果」的对应关系官方未定义，
  // `n>1` 与 partial_images 叠加属于未验证组合，不做承诺。
  const body = applyImageGenerationOverrides(
    {
      ...buildImageGenerationRequestBody({ ...input, count: 1 }),
      partial_images: partialImages,
      stream: true,
    },
    input.requestOverrides,
  );

  let response: Response;
  try {
    response = await fetch(`${input.apiBaseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
        ...(input.requestOverrides.headers ?? {}),
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: input.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new OpenAiImageGenerationError('图片生成已被取消。', {
        retryable: false,
        statusCode: 499,
      });
    }
    throw error;
  }

  if (!response.ok) {
    const upstreamBody = await readResponseTextWithLimit(
      response,
      resolveImageResponseMaxBytes(),
    ).catch(() => 'Unknown error');
    throw buildUpstreamImageGenerationError({
      size: input.size,
      statusCode: response.status,
      upstreamBody,
    });
  }

  if (!response.body) {
    throw new OpenAiImageGenerationError('图片生成流式响应不可用。', {
      retryable: false,
      statusCode: 502,
    });
  }

  let completedBase64: string | undefined;
  let lastPartialBase64: string | undefined;
  let revisedPrompt: string | undefined;

  const handleFrame = (frame: string) => {
    const data = readSseFrameData(frame);
    if (!data || data === '[DONE]') {
      return;
    }

    let event: UpstreamImageStreamEvent;
    try {
      event = JSON.parse(data) as UpstreamImageStreamEvent;
    } catch {
      // 未知帧（部分中转会插入心跳/注释）不应打断整条流。
      return;
    }

    const eventType = typeof event.type === 'string' ? event.type : '';
    const eventBase64 = typeof event.b64_json === 'string' ? event.b64_json : undefined;
    if (typeof event.revised_prompt === 'string') {
      revisedPrompt = event.revised_prompt;
    }

    if (eventType === 'image_generation.partial_image') {
      if (!eventBase64) {
        return;
      }
      lastPartialBase64 = eventBase64;
      const rawIndex = event.partial_image_index;
      handlers.onPartial?.({
        bytes: Buffer.from(eventBase64, 'base64'),
        index: typeof rawIndex === 'number' && Number.isFinite(rawIndex) ? rawIndex : 0,
        mimeType,
      });
      return;
    }

    if (eventType === 'image_generation.completed') {
      completedBase64 = eventBase64 ?? readFirstImageBase64(event.data) ?? completedBase64;
      return;
    }

    // 容错：个别中转省略 `type`，只在从未见过完成事件时把它当成最终图。
    if (!completedBase64 && eventBase64) {
      completedBase64 = eventBase64;
    }
  };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    let finished = false;
    while (!finished) {
      const { done, value } = await reader.read();
      if (done) {
        finished = true;
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let separatorIndex = buffer.indexOf('\n\n');
      while (separatorIndex !== -1) {
        const frame = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        handleFrame(frame);
        separatorIndex = buffer.indexOf('\n\n');
      }
    }
    buffer += decoder.decode();
    if (buffer.trim().length > 0) {
      handleFrame(buffer);
    }
  } catch (error) {
    if (isAbortError(error)) {
      throw new OpenAiImageGenerationError('图片生成已被取消。', {
        retryable: false,
        statusCode: 499,
      });
    }
    throw error;
  } finally {
    reader.releaseLock();
  }

  const finalBase64 = completedBase64 ?? lastPartialBase64;
  if (!finalBase64) {
    throw new OpenAiImageGenerationError('图片生成流式响应未返回可用的图像数据。', {
      retryable: false,
      statusCode: 502,
    });
  }

  return {
    bytes: Buffer.from(finalBase64, 'base64'),
    mimeType,
    outputFormat: input.outputFormat,
    prompt: input.prompt,
    quality: input.quality,
    requestId: response.headers.get('x-request-id') ?? undefined,
    revisedPrompt,
    size: input.size,
  };
}

function readFirstImageBase64(value: unknown): string | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  for (const item of value) {
    if (item && typeof item === 'object') {
      const candidate = (item as Record<string, unknown>)['b64_json'];
      if (typeof candidate === 'string' && candidate.length > 0) {
        return candidate;
      }
    }
  }
  return undefined;
}

export async function editImagesWithOpenAi(
  input: OpenAiImageEditInput,
): Promise<OpenAiImageGenerationResult[]> {
  if (!input.apiKey) {
    throw new OpenAiImageGenerationError('图片编辑缺少可用的 OpenAI API Key。', {
      retryable: false,
      statusCode: 400,
    });
  }

  if (input.providerType !== 'openai') {
    throw new OpenAiImageGenerationError('图片编辑仅支持 OpenAI 类型提供商。', {
      retryable: false,
      statusCode: 400,
    });
  }

  const form = buildImageEditFormData(input);

  let response: Response;
  try {
    response = await fetch(`${input.apiBaseUrl}/images/edits`, {
      method: 'POST',
      headers: {
        ...(input.requestOverrides.headers ?? {}),
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: form,
      signal: input.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new OpenAiImageGenerationError('图片编辑已被取消。', {
        retryable: false,
        statusCode: 499,
      });
    }
    throw error;
  }

  if (!response.ok) {
    const upstreamBody = await readResponseTextWithLimit(
      response,
      resolveImageResponseMaxBytes(),
    ).catch(() => 'Unknown error');
    throw buildUpstreamImageGenerationError({
      size: input.size,
      statusCode: response.status,
      upstreamBody,
    });
  }

  const payload = await readResponseJsonWithLimit<{
    data?: Array<{ b64_json?: string; revised_prompt?: string }>;
  }>(response, resolveImageResponseMaxBytes());

  return mapImageGenerationItems({
    data: payload.data,
    emptyMessage: '图片编辑未返回可用的图像数据。',
    outputFormat: input.outputFormat,
    prompt: input.prompt,
    quality: input.quality,
    requestId: response.headers.get('x-request-id') ?? undefined,
    size: input.size,
  });
}

/** 单张编辑的薄封装（取首批结果中的第一张）。 */
export async function editImageWithOpenAi(
  input: OpenAiImageEditInput,
): Promise<OpenAiImageGenerationResult> {
  return firstImageOrThrow(await editImagesWithOpenAi(input), '图片编辑未返回可用的图像数据。');
}
