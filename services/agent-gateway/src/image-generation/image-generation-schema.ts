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

export function resolveImageGenerationDefaults(
  input: Partial<ImageGenerationDefaults> | undefined,
  fallback: ImageGenerationDefaults,
): ImageGenerationDefaults {
  return {
    size: input?.size ?? fallback.size ?? DEFAULT_IMAGE_GENERATION_DEFAULTS.size,
    quality: input?.quality ?? fallback.quality ?? DEFAULT_IMAGE_GENERATION_DEFAULTS.quality,
    outputFormat:
      input?.outputFormat ?? fallback.outputFormat ?? DEFAULT_IMAGE_GENERATION_DEFAULTS.outputFormat,
    background:
      input?.background ?? fallback.background ?? DEFAULT_IMAGE_GENERATION_DEFAULTS.background,
  };
}
