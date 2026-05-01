import { requiresHighQualityForSize } from '@openAwork/shared';
import { z } from 'zod';
import {
  DEFAULT_IMAGE_GENERATION_DEFAULTS,
  imageGenerationDefaultsSchema,
  type ImageGenerationDefaults,
} from '../provider-config.js';

export const imageGenerationRequestSchema = imageGenerationDefaultsSchema.partial().extend({
  inputArtifacts: z
    .array(
      z.object({
        artifactId: z.string().trim().min(1).max(200),
        fileName: z.string().trim().min(1).max(255).optional(),
        mimeType: z.string().trim().min(1).max(255).optional(),
      }),
    )
    .max(1)
    .optional(),
  prompt: z.string().trim().min(1).max(4000),
});

export type ImageGenerationRequest = z.infer<typeof imageGenerationRequestSchema>;

export interface ResolveImageGenerationDefaultsResult extends ImageGenerationDefaults {
  /** True when the requested quality was raised to "high" because the size requires it. */
  qualityAutoLifted: boolean;
  /** Quality value originally requested (or fallback) before any auto-lift, kept for diagnostics. */
  requestedQuality: ImageGenerationDefaults['quality'];
}

/**
 * Merge per-request overrides with the user's stored defaults, then enforce
 * GPT Image 2's hard requirement that 2K/4K calls must use quality="high".
 * The lift is silent at the code level but flagged via `qualityAutoLifted` so
 * callers can log / surface it to the UI when relevant.
 */
export function resolveImageGenerationDefaults(
  input: Partial<ImageGenerationDefaults> | undefined,
  fallback: ImageGenerationDefaults,
): ResolveImageGenerationDefaultsResult {
  const size = input?.size ?? fallback.size ?? DEFAULT_IMAGE_GENERATION_DEFAULTS.size;
  const requestedQuality =
    input?.quality ?? fallback.quality ?? DEFAULT_IMAGE_GENERATION_DEFAULTS.quality;
  const outputFormat =
    input?.outputFormat ?? fallback.outputFormat ?? DEFAULT_IMAGE_GENERATION_DEFAULTS.outputFormat;
  const background =
    input?.background ?? fallback.background ?? DEFAULT_IMAGE_GENERATION_DEFAULTS.background;

  const qualityAutoLifted = requiresHighQualityForSize(size) && requestedQuality !== 'high';
  const quality = qualityAutoLifted ? 'high' : requestedQuality;

  return {
    size,
    quality,
    outputFormat,
    background,
    qualityAutoLifted,
    requestedQuality,
  };
}
