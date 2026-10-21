import { describe, expect, it } from 'vitest';
import { parseGenerateImageOutput, resolveGenerateImageArtifactIds } from './parse.js';

const outputFor = (fields: Record<string, unknown>) => JSON.stringify({ success: true, ...fields });

describe('parseGenerateImageOutput', () => {
  it('parses a single-artifact payload (legacy shape)', () => {
    const result = parseGenerateImageOutput(
      outputFor({ artifactId: 'artifact-1', title: '海报', summary: '已生成' }),
    );

    expect(result?.artifactId).toBe('artifact-1');
    expect(result?.artifactIds).toBeUndefined();
  });

  it('keeps the multi-artifact fields when present', () => {
    const result = parseGenerateImageOutput(
      outputFor({
        artifactId: 'artifact-1',
        artifactIds: ['artifact-1', 'artifact-2'],
        count: 2,
        title: '海报',
        summary: '已生成 2 张',
      }),
    );

    expect(result?.artifactIds).toEqual(['artifact-1', 'artifact-2']);
    expect(result?.count).toBe(2);
  });

  it('returns null for non-json / unsuccessful output', () => {
    expect(parseGenerateImageOutput('图片生成失败: 上游拒绝')).toBeNull();
    expect(parseGenerateImageOutput(JSON.stringify({ success: false }))).toBeNull();
    expect(parseGenerateImageOutput(undefined)).toBeNull();
  });
});

describe('resolveGenerateImageArtifactIds', () => {
  it('returns an empty list when there is no result', () => {
    expect(resolveGenerateImageArtifactIds(null)).toEqual([]);
  });

  it('falls back to the single artifactId for legacy payloads', () => {
    const result = parseGenerateImageOutput(outputFor({ artifactId: 'artifact-1' }));

    expect(resolveGenerateImageArtifactIds(result)).toEqual(['artifact-1']);
  });

  it('keeps generation order and never duplicates the first artifact', () => {
    const result = parseGenerateImageOutput(
      outputFor({
        artifactId: 'artifact-1',
        artifactIds: ['artifact-1', 'artifact-2', 'artifact-3'],
      }),
    );

    expect(resolveGenerateImageArtifactIds(result)).toEqual([
      'artifact-1',
      'artifact-2',
      'artifact-3',
    ]);
  });

  it('appends a primary id that artifactIds omits', () => {
    const result = parseGenerateImageOutput(
      outputFor({ artifactId: 'artifact-9', artifactIds: ['artifact-1'] }),
    );

    expect(resolveGenerateImageArtifactIds(result)).toEqual(['artifact-1', 'artifact-9']);
  });

  it('drops blank and non-string entries', () => {
    const result = parseGenerateImageOutput(
      outputFor({
        artifactId: 'artifact-1',
        artifactIds: ['artifact-1', '  ', '', 42, null, 'artifact-2'],
      }),
    );

    expect(resolveGenerateImageArtifactIds(result)).toEqual(['artifact-1', 'artifact-2']);
  });
});
