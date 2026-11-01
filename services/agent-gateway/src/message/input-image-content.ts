import type { InputImageContent, MessageContent } from '@openAwork/shared';
import { z } from 'zod';

export const MAX_INPUT_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_INPUT_IMAGE_URL_LENGTH = 28 * 1024 * 1024;

export const inputImageContentSchema = z
  .object({
    type: z.literal('input_image'),
    artifactId: z.string().trim().min(1).max(200).optional(),
    detail: z.enum(['auto', 'high', 'low', 'original']).optional(),
    fileId: z.string().trim().min(1).max(200).optional(),
    fileName: z.string().trim().min(1).max(255).optional(),
    imageUrl: z.string().trim().min(1).max(MAX_INPUT_IMAGE_URL_LENGTH).optional(),
    mimeType: z.string().trim().min(1).max(255).optional(),
  })
  .refine((part) => Boolean(part.artifactId || part.fileId || part.imageUrl), {
    message: '图片必须提供有效来源。',
  });

export function buildUserInputContent(
  text: string,
  inputParts?: InputImageContent[],
): MessageContent[] {
  return [
    ...(text.trim().length > 0 ? [{ type: 'text' as const, text }] : []),
    ...(inputParts ?? []),
  ];
}
