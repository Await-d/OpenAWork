import type { RequestOverrides } from '@openAwork/agent-core';
import type {
  ImageGenerationBackground,
  ImageGenerationOutputFormat,
  ImageGenerationQuality,
} from '@openAwork/shared';

export type ImageGenerationSize = string;

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

function mapUpstreamImageGenerationMessage(statusCode: number, upstreamBody?: string): string {
  const detail = extractUpstreamErrorDetail(upstreamBody);
  const suffix = detail ? ` (${detail})` : '';

  if (statusCode === 400) {
    return `图片生成请求被上游拒绝，请检查模型配置与请求参数。${suffix}`;
  }

  if (statusCode === 401 || statusCode === 403) {
    return `图片生成鉴权失败，请检查 OpenAI 提供商凭据。${suffix}`;
  }

  if (statusCode === 429) {
    return '图片生成请求过于频繁，请稍后重试。';
  }

  return `图片生成上游服务暂时不可用 [HTTP ${statusCode}]，请稍后重试。${suffix}`;
}

function extractUpstreamErrorDetail(body?: string): string | null {
  if (!body) return null;
  try {
    const json = JSON.parse(body) as Record<string, unknown>;
    const error = json['error'] as Record<string, unknown> | undefined;
    if (error && typeof error['message'] === 'string') {
      const msg = error['message'] as string;
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
  const nextBody = {
    ...body,
    ...(requestOverrides.body ?? {}),
  };

  for (const key of requestOverrides.omitBodyKeys ?? []) {
    delete nextBody[key];
  }

  return nextBody;
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

  const response = await fetch(`${input.apiBaseUrl}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(input.requestOverrides.headers ?? {}),
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify(applyImageGenerationOverrides(baseBody, input.requestOverrides)),
    signal: input.signal,
  });

  if (!response.ok) {
    const upstreamBody = await response.text().catch(() => 'Unknown error');
    throw new OpenAiImageGenerationError(
      mapUpstreamImageGenerationMessage(response.status, upstreamBody),
      {
        retryable: response.status >= 500 || response.status === 429,
        statusCode: response.status,
      },
    );
  }

  const payload = (await response.json()) as {
    data?: Array<{ b64_json?: string; revised_prompt?: string }>;
  };
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

  const form = new FormData();
  form.append('model', input.model);
  form.append('prompt', input.prompt);
  form.append('size', input.size);
  form.append('quality', input.quality);
  form.append('output_format', input.outputFormat);
  form.append('background', input.background);
  const imageBytes = new Uint8Array(input.inputImage.bytes.byteLength);
  imageBytes.set(input.inputImage.bytes);
  form.append(
    'image',
    new Blob([imageBytes.buffer], { type: input.inputImage.mimeType }),
    input.inputImage.fileName,
  );

  const response = await fetch(`${input.apiBaseUrl}/images/edits`, {
    method: 'POST',
    headers: {
      ...(input.requestOverrides.headers ?? {}),
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: form,
    signal: input.signal,
  });

  if (!response.ok) {
    const upstreamBody = await response.text().catch(() => 'Unknown error');
    throw new OpenAiImageGenerationError(mapUpstreamImageGenerationMessage(response.status, upstreamBody), {
      retryable: response.status >= 500 || response.status === 429,
      statusCode: response.status,
    });
  }

  const payload = (await response.json()) as {
    data?: Array<{ b64_json?: string; revised_prompt?: string }>;
  };
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
