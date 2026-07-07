import type { InputImageContent } from '@openAwork/shared';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function extractInputImageParts(rawContent: unknown): InputImageContent[] {
  if (!Array.isArray(rawContent)) {
    return [];
  }
  return rawContent.flatMap((item) => {
    if (!isRecord(item) || item['type'] !== 'input_image') {
      return [];
    }
    const part: InputImageContent = {
      type: 'input_image',
      ...(typeof item['artifactId'] === 'string' ? { artifactId: item['artifactId'] } : {}),
      ...(typeof item['fileName'] === 'string' ? { fileName: item['fileName'] } : {}),
      ...(typeof item['imageUrl'] === 'string' ? { imageUrl: item['imageUrl'] } : {}),
      ...(typeof item['mimeType'] === 'string' ? { mimeType: item['mimeType'] } : {}),
    };
    return [part];
  });
}
