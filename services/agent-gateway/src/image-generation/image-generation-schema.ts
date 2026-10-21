import {
  clampImageGenerationQuality,
  IMAGE_GENERATION_COUNT_RANGE,
  shouldLiftQualityToHigh,
  validateImageGenerationBackgroundCombination,
  type ImageGenerationBackground,
  type ImageGenerationModeration,
  type ImageGenerationOutputFormat,
  type ImageGenerationQuality,
} from '@openAwork/shared';
import { z } from 'zod';
import {
  DEFAULT_IMAGE_GENERATION_DEFAULTS,
  imageGenerationDefaultsSchema,
  type ImageGenerationDefaults,
} from '../provider/provider-config.js';

const imageArtifactRefSchema = z.object({
  artifactId: z.string().trim().min(1).max(200),
  fileName: z.string().trim().min(1).max(255).optional(),
  mimeType: z.string().trim().min(1).max(255).optional(),
});

export const imageGenerationRequestSchema = imageGenerationDefaultsSchema.partial().extend({
  inputArtifacts: z.array(imageArtifactRefSchema).max(1).optional(),
  /**
   * 局部编辑遮罩（官方 `/images/edits` 的 `mask`）。
   * 必须与输入图格式、尺寸一致且带 alpha 通道——这一层不做图像解析，
   * 交给上游判定并把它的错误文案回传。
   */
  maskArtifact: imageArtifactRefSchema.optional(),
  prompt: z.string().trim().min(1).max(4000),
});

export type ImageGenerationRequest = z.infer<typeof imageGenerationRequestSchema>;

export interface ResolveImageGenerationDefaultsResult {
  /** 透明背景等参数组合非法时的提示；非 null 时调用方应拒绝该请求，而不是静默改参。 */
  backgroundNotice: string | null;
  background: ImageGenerationBackground;
  /** 单次生成张数（官方 `n`），至少为 1。 */
  count: number;
  moderation: ImageGenerationModeration;
  /** 仅 jpeg / webp 才会带上；png 下会被丢弃（上游对该组合无定义）。 */
  outputCompression?: number;
  outputFormat: ImageGenerationOutputFormat;
  quality: ImageGenerationQuality;
  /** 请求档位超出模型能力上限、被收敛到上限（与 `qualityAutoLifted` 方向相反）。 */
  qualityClamped: boolean;
  /** True when the requested quality was raised to "high" because the size requires it. */
  qualityAutoLifted: boolean;
  /** Quality value originally requested (or fallback) before any clamp / auto-lift, kept for diagnostics. */
  requestedQuality: ImageGenerationQuality;
  size: string;
}

/**
 * Merge per-request overrides with the user's stored defaults, then align the
 * request with the capability of the selected model:
 *
 *   - quality 超出模型上限（例如给 gpt-image-2 传 `xhigh` / `max`）时收敛到上限；
 *   - >1K 尺寸对 gpt-image-2 及更早的模型仍需 `quality="high"`（GPT Image 2.5 已无此约束）。
 *
 * The lift / clamp are silent at the code level but flagged via
 * `qualityAutoLifted` / `qualityClamped` so callers can log / surface them.
 */
export function resolveImageGenerationDefaults(
  input: Partial<ImageGenerationDefaults> | undefined,
  fallback: ImageGenerationDefaults,
  options?: { modelId?: string | undefined },
): ResolveImageGenerationDefaultsResult {
  const modelId = options?.modelId;
  const size = input?.size ?? fallback.size ?? DEFAULT_IMAGE_GENERATION_DEFAULTS.size;
  const requestedQuality =
    input?.quality ?? fallback.quality ?? DEFAULT_IMAGE_GENERATION_DEFAULTS.quality;
  const outputFormat =
    input?.outputFormat ?? fallback.outputFormat ?? DEFAULT_IMAGE_GENERATION_DEFAULTS.outputFormat;
  const background =
    input?.background ?? fallback.background ?? DEFAULT_IMAGE_GENERATION_DEFAULTS.background;
  const moderation =
    input?.moderation ??
    fallback.moderation ??
    DEFAULT_IMAGE_GENERATION_DEFAULTS.moderation ??
    'auto';

  const supportedQuality = clampImageGenerationQuality(modelId, requestedQuality);
  const qualityClamped = supportedQuality !== requestedQuality;

  const qualityAutoLifted = shouldLiftQualityToHigh({
    modelId,
    quality: supportedQuality,
    size,
  });
  const quality = qualityAutoLifted ? 'high' : supportedQuality;

  const requestedCompression = input?.outputCompression ?? fallback.outputCompression;
  const outputCompression =
    outputFormat === 'png' || requestedCompression === undefined ? undefined : requestedCompression;

  // 越界张数直接夹到合法区间：调用方只可能给出无法满足的请求，报错不如收敛。
  const requestedCount = input?.count ?? fallback.count ?? IMAGE_GENERATION_COUNT_RANGE.min;
  const count = Math.min(
    Math.max(Math.trunc(requestedCount), IMAGE_GENERATION_COUNT_RANGE.min),
    IMAGE_GENERATION_COUNT_RANGE.max,
  );

  return {
    size,
    quality,
    outputFormat,
    background,
    moderation,
    count,
    outputCompression,
    backgroundNotice: validateImageGenerationBackgroundCombination({
      background,
      outputFormat,
      modelId,
    }),
    qualityAutoLifted,
    qualityClamped,
    requestedQuality,
  };
}
