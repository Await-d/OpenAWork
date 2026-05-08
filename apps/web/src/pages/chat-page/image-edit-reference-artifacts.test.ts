import { describe, expect, it } from 'vitest';
import type { ArtifactRecord } from '@openAwork/artifacts';
import { toImageEditReferenceArtifacts } from './image-edit-reference-artifacts.js';

function makeArtifact(
  overrides: Partial<ArtifactRecord> &
    Pick<ArtifactRecord, 'content' | 'id' | 'title' | 'updatedAt'>,
): ArtifactRecord {
  const { content, id, title, updatedAt, ...rest } = overrides;

  return {
    id,
    sessionId: 'session-1',
    userId: 'user-1',
    type: 'image',
    title,
    content,
    version: 1,
    parentVersionId: null,
    metadata: rest.metadata ?? {},
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt,
    ...rest,
  };
}

describe('toImageEditReferenceArtifacts', () => {
  it('keeps only stored image data-url artifacts and sorts them newest first', () => {
    const artifacts = [
      makeArtifact({
        id: 'artifact-old-image',
        title: '旧图片',
        content: 'data:image/png;base64,b2xk',
        updatedAt: '2026-05-01T09:00:00.000Z',
      }),
      makeArtifact({
        id: 'artifact-note',
        title: '文本产物',
        content: 'plain text content',
        updatedAt: '2026-05-01T11:00:00.000Z',
        type: 'code',
      }),
      makeArtifact({
        id: 'artifact-new-image',
        title: '新图片',
        content: 'data:image/webp;base64,bmV3',
        updatedAt: '2026-05-01T12:00:00.000Z',
      }),
    ];

    expect(toImageEditReferenceArtifacts(artifacts)).toEqual([
      {
        artifactId: 'artifact-new-image',
        imageUrl: 'data:image/webp;base64,bmV3',
        mimeType: 'image/webp',
        title: '新图片',
        updatedAt: '2026-05-01T12:00:00.000Z',
      },
      {
        artifactId: 'artifact-old-image',
        imageUrl: 'data:image/png;base64,b2xk',
        mimeType: 'image/png',
        title: '旧图片',
        updatedAt: '2026-05-01T09:00:00.000Z',
      },
    ]);
  });

  it('reuses image metadata when present and falls back to the data-url mime type otherwise', () => {
    const artifacts = [
      makeArtifact({
        id: 'artifact-with-meta',
        title: '带元数据的图片',
        content: 'data:image/png;base64,cGlj',
        metadata: {
          fileName: 'poster-final.webp',
          mimeType: 'image/webp',
        },
        updatedAt: '2026-05-01T10:00:00.000Z',
      }),
      makeArtifact({
        id: 'artifact-invalid-meta',
        title: '错误 mime 的图片',
        content: 'data:image/jpeg;base64,cGljMg==',
        metadata: {
          mimeType: 'text/plain',
        },
        updatedAt: '2026-05-01T08:00:00.000Z',
      }),
    ];

    expect(toImageEditReferenceArtifacts(artifacts)).toEqual([
      {
        artifactId: 'artifact-with-meta',
        fileName: 'poster-final.webp',
        imageUrl: 'data:image/png;base64,cGlj',
        mimeType: 'image/webp',
        title: '带元数据的图片',
        updatedAt: '2026-05-01T10:00:00.000Z',
      },
      {
        artifactId: 'artifact-invalid-meta',
        imageUrl: 'data:image/jpeg;base64,cGljMg==',
        mimeType: 'image/jpeg',
        title: '错误 mime 的图片',
        updatedAt: '2026-05-01T08:00:00.000Z',
      },
    ]);
  });
});
