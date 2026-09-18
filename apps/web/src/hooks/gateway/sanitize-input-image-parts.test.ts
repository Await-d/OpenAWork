import type { InputImageContent } from '@openAwork/shared';
import { describe, expect, it } from 'vitest';
import {
  MAX_GATEWAY_IMAGE_URL_CHARS,
  stripOversizedInlineImageUrls,
} from './sanitize-input-image-parts.js';

function buildOversizedImageUrl(): string {
  return `data:image/png;base64,${'A'.repeat(MAX_GATEWAY_IMAGE_URL_CHARS)}`;
}

describe('stripOversizedInlineImageUrls', () => {
  it('超长 imageUrl 且带 artifactId 时移除 imageUrl，并保留其余字段', () => {
    const imageUrl = buildOversizedImageUrl();
    const part: InputImageContent = {
      type: 'input_image',
      artifactId: 'a1',
      fileName: 'a.png',
      mimeType: 'image/png',
      imageUrl,
    };

    const [result] = stripOversizedInlineImageUrls([part]);

    expect(result).toEqual({
      type: 'input_image',
      artifactId: 'a1',
      fileName: 'a.png',
      mimeType: 'image/png',
    });
    expect(result).not.toHaveProperty('imageUrl');
  });

  it('超长 imageUrl 但无 artifactId 与 fileId 时保持原样', () => {
    const imageUrl = buildOversizedImageUrl();
    const part: InputImageContent = {
      type: 'input_image',
      fileName: 'a.png',
      imageUrl,
    };

    const [result] = stripOversizedInlineImageUrls([part]);

    expect(result).toBe(part);
    expect(result?.imageUrl).toBe(imageUrl);
  });

  it('imageUrl 恰好等于上限时保持不变，超出一个字符时移除', () => {
    const atLimit: InputImageContent = {
      type: 'input_image',
      artifactId: 'a1',
      imageUrl: 'a'.repeat(MAX_GATEWAY_IMAGE_URL_CHARS),
    };
    const oneOver: InputImageContent = {
      type: 'input_image',
      artifactId: 'a1',
      imageUrl: 'a'.repeat(MAX_GATEWAY_IMAGE_URL_CHARS + 1),
    };

    const [atLimitResult, oneOverResult] = stripOversizedInlineImageUrls([atLimit, oneOver]);

    expect(atLimitResult).toBe(atLimit);
    expect(atLimitResult?.imageUrl).toBe(atLimit.imageUrl);
    expect(oneOverResult).toEqual({ type: 'input_image', artifactId: 'a1' });
    expect(oneOverResult).not.toHaveProperty('imageUrl');
  });

  it('没有 imageUrl 的 part 原样返回且保持同一引用', () => {
    const part: InputImageContent = { type: 'input_image', artifactId: 'a1' };

    const [result] = stripOversizedInlineImageUrls([part]);

    expect(result).toBe(part);
  });
});
