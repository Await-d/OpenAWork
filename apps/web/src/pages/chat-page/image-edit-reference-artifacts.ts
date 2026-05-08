import type { ArtifactRecord } from '@openAwork/artifacts';

export interface ImageEditReferenceArtifact {
  artifactId: string;
  fileName?: string;
  imageUrl?: string;
  mimeType?: string;
  title: string;
  updatedAt: string;
}

function getArtifactMetadataString(
  artifact: ArtifactRecord,
  key: 'fileName' | 'mimeType',
): string | undefined {
  const value = artifact.metadata?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function parseStoredImageDataUrl(content: string): { imageUrl: string; mimeType: string } | null {
  const match = content.match(/^data:(image\/[^;,]+)(?:;[^,]*)?;base64,[\s\S]+$/);
  const mimeType = match?.[1];
  if (!mimeType) {
    return null;
  }

  return {
    imageUrl: content,
    mimeType,
  };
}

export function toImageEditReferenceArtifacts(
  artifacts: ArtifactRecord[],
): ImageEditReferenceArtifact[] {
  return artifacts
    .flatMap((artifact) => {
      const parsed = parseStoredImageDataUrl(artifact.content);
      if (!parsed) {
        return [];
      }

      const metadataMimeType = getArtifactMetadataString(artifact, 'mimeType');
      const mimeType = metadataMimeType?.startsWith('image/') ? metadataMimeType : parsed.mimeType;
      const fileName = getArtifactMetadataString(artifact, 'fileName');

      return [
        {
          artifactId: artifact.id,
          imageUrl: parsed.imageUrl,
          mimeType,
          title: artifact.title,
          updatedAt: artifact.updatedAt,
          ...(fileName ? { fileName } : {}),
        },
      ];
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
