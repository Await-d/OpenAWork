import type { RequestOverrides } from '@openAwork/agent-core';
import {
  getImageGenerationSizeTier,
  type ImageGenerationBackground,
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
  model: string;
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
  public readonly retryable: boolean;

  public readonly statusCode: number;

  public constructor(message: string, options: { retryable: boolean; statusCode: number }) {
    super(message);
    this.name = 'OpenAiImageGenerationError';
    this.retryable = options.retryable;
    this.statusCode = options.statusCode;
  }
}

function mapUpstreamImageGenerationMessage(
  statusCode: number,
  upstreamBody: string | undefined,
  size: ImageGenerationSize,
): string {
  const detail = extractUpstreamErrorDetail(upstreamBody);
  const suffix = detail ? ` (${detail})` : '';
  const tier = getImageGenerationSizeTier(size);
  const fourKHint =
    tier === '4k'
      ? ' 提示：4K 是实验性功能，您当前的中转/服务可能不支持，建议改用 2K（如 2048x1152）重试。'
      : '';

  if (statusCode === 400) {
    return `图片生成请求被上游拒绝，请检查模型配置与请求参数。${suffix}${fourKHint}`;
  }

  if (statusCode === 401 || statusCode === 403) {
    return `图片生成鉴权失败，请检查 OpenAI 提供商凭据。${suffix}`;
  }

  if (statusCode === 408) {
    return `图片生成超时（${tier === '4k' ? '4K 可能耗时接近 6 分钟' : tier === '2k' ? '2K 通常约 1~3 分钟' : '请检查网络'}）。${fourKHint}`;
  }

  if (statusCode === 429) {
    return '图片生成请求过于频繁，请稍后重试。';
  }

  return `图片生成上游服务暂时不可用 [HTTP ${statusCode}]，请稍后重试。${suffix}${fourKHint}`;
}

function extractUpstreamErrorDetail(body?: string): string | null {
  if (!body) return null;
  try {
    const json = JSON.parse(body) as Record<string, unknown>;
    const error = json['error'] as Record<string, unknown> | undefined;
    if (error && typeof error['message'] === 'string') {
      const msg = error['message'];
      return msg.length > 200 ? msg.slice(0, 200) + '…' : msg;
    }
  } catch {
    // not JSON, use raw body
  }
  return body.length > 200 ? body.slice(0, 200) + '…' : body;
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

function buildImageEditFormData(input: OpenAiImageEditInput): FormData {
  const baseBody = {
    model: input.model,
    prompt: input.prompt,
    size: input.size,
    quality: input.quality,
    output_format: input.outputFormat,
    background: input.background,
  } satisfies Record<string, unknown>;
  const body = applyImageGenerationOverrides(baseBody, input.requestOverrides);
  const form = new FormData();

  for (const [key, value] of Object.entries(body)) {
    setImageGenerationFormValue(form, key, value);
  }

  if (!input.requestOverrides.omitBodyKeys?.includes('image')) {
    const imageBytes = new Uint8Array(input.inputImage.bytes.byteLength);
    imageBytes.set(input.inputImage.bytes);
    form.set(
      'image',
      new Blob([imageBytes.buffer], { type: input.inputImage.mimeType }),
      input.inputImage.fileName,
    );
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

export async function generateImageWithOpenAi(
  input: OpenAiImageGenerationInput,
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

  const baseBody = {
    model: input.model,
    prompt: input.prompt,
    size: input.size,
    quality: input.quality,
    output_format: input.outputFormat,
    background: input.background,
  } satisfies Record<string, unknown>;

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
    throw new OpenAiImageGenerationError(
      mapUpstreamImageGenerationMessage(response.status, upstreamBody, input.size),
      {
        retryable: response.status >= 500 || response.status === 429,
        statusCode: response.status,
      },
    );
  }

  const payload = await readResponseJsonWithLimit<{
    data?: Array<{ b64_json?: string; revised_prompt?: string }>;
  }>(response, resolveImageResponseMaxBytes());
  const item = payload.data?.[0];
  if (!item?.b64_json) {
    throw new OpenAiImageGenerationError('图片生成未返回可用的图像数据。', {
      retryable: false,
      statusCode: 502,
    });
  }

  return {
    bytes: Buffer.from(item.b64_json, 'base64'),
    mimeType: inferMimeType(input.outputFormat),
    outputFormat: input.outputFormat,
    prompt: input.prompt,
    quality: input.quality,
    requestId: response.headers.get('x-request-id') ?? undefined,
    revisedPrompt: item.revised_prompt,
    size: input.size,
  };
}

export async function editImageWithOpenAi(
  input: OpenAiImageEditInput,
): Promise<OpenAiImageGenerationResult> {
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
    throw new OpenAiImageGenerationError(
      mapUpstreamImageGenerationMessage(response.status, upstreamBody, input.size),
      {
        retryable: response.status >= 500 || response.status === 429,
        statusCode: response.status,
      },
    );
  }

  const payload = await readResponseJsonWithLimit<{
    data?: Array<{ b64_json?: string; revised_prompt?: string }>;
  }>(response, resolveImageResponseMaxBytes());
  const item = payload.data?.[0];
  if (!item?.b64_json) {
    throw new OpenAiImageGenerationError('图片编辑未返回可用的图像数据。', {
      retryable: false,
      statusCode: 502,
    });
  }

  return {
    bytes: Buffer.from(item.b64_json, 'base64'),
    mimeType: inferMimeType(input.outputFormat),
    outputFormat: input.outputFormat,
    prompt: input.prompt,
    quality: input.quality,
    requestId: response.headers.get('x-request-id') ?? undefined,
    revisedPrompt: item.revised_prompt,
    size: input.size,
  };
}
