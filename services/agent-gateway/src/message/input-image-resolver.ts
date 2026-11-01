import type { InputImageContent } from '@openAwork/shared';
import type { RunArtifact } from '@openAwork/artifacts';
import { readFileSync, statSync } from 'node:fs';
import { MAX_INPUT_IMAGE_BYTES, MAX_INPUT_IMAGE_URL_LENGTH } from './input-image-content.js';
import { resolveGatewayArtifactsIndexPath } from '../infra/storage-paths.js';

export function resolveSessionInputImage(
  sessionId: string,
  item: InputImageContent,
): InputImageContent {
  if (item.imageUrl || !item.artifactId) return item;
  try {
    const artifacts = JSON.parse(
      readFileSync(resolveGatewayArtifactsIndexPath(), 'utf-8'),
    ) as RunArtifact[];
    const artifact = artifacts.find(
      (entry) => entry.id === item.artifactId && entry.sessionId === sessionId,
    );
    if (!artifact?.path || !artifact.mimeType?.startsWith('image/')) return item;
    if (statSync(artifact.path).size > MAX_INPUT_IMAGE_BYTES) return item;
    const contentBase64 = readFileSync(artifact.path, 'base64');
    return {
      ...item,
      fileName: item.fileName ?? artifact.name,
      imageUrl: `data:${artifact.mimeType};base64,${contentBase64}`,
      mimeType: item.mimeType ?? artifact.mimeType,
    };
  } catch {
    return item;
  }
}

export function isInlineInputImage(image: InputImageContent): boolean {
  const value = image.imageUrl?.trim();
  if (!value || value.length > MAX_INPUT_IMAGE_URL_LENGTH) return false;
  const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return false;
  const encoded = match[2]!;
  if (encoded.length % 4 !== 0) return false;
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  const decodedBytes = (encoded.length / 4) * 3 - padding;
  return (
    decodedBytes > 0 &&
    decodedBytes <= MAX_INPUT_IMAGE_BYTES &&
    (!image.mimeType || image.mimeType.toLowerCase() === match[1])
  );
}
