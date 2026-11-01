import { describe, expect, it } from 'vitest';
import { isInlineInputImage } from '../../message/input-image-resolver.js';
import {
  MAX_INPUT_IMAGE_BYTES,
  inputImageContentSchema,
} from '../../message/input-image-content.js';

describe('模型图片输入边界', () => {
  it('超过旧500k限制但在上游预算内的图片可进入规划', () => {
    const image = {
      type: 'input_image' as const,
      imageUrl: `data:image/png;base64,${Buffer.alloc(1024 * 1024).toString('base64')}`,
    };
    expect(inputImageContentSchema.safeParse(image).success).toBe(true);
    expect(isInlineInputImage(image)).toBe(true);
  });

  it('上游解码预算之外的图片拒绝', () => {
    const image = {
      type: 'input_image' as const,
      imageUrl: `data:image/png;base64,${Buffer.alloc(MAX_INPUT_IMAGE_BYTES + 1).toString('base64')}`,
    };
    expect(isInlineInputImage(image)).toBe(false);
  });

  it.each([
    'data:image/png;base64,a===',
    'data:image/png;base64,',
    'data:image/svg+xml;base64,aW1hZ2U=',
    'https://example.test/image.png',
  ])('不可发送来源明确无效：%s', (imageUrl) => {
    expect(isInlineInputImage({ type: 'input_image', imageUrl })).toBe(false);
  });

  it('MIME必须与图片data URL一致', () => {
    const image = { type: 'input_image' as const, imageUrl: 'data:image/png;base64,aW1hZ2U=' };
    expect(isInlineInputImage({ ...image, mimeType: 'image/png' })).toBe(true);
    expect(isInlineInputImage({ ...image, mimeType: 'image/jpeg' })).toBe(false);
  });
});
