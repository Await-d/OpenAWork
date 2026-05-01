import { describe, expect, it } from 'vitest';
import {
  downgradeImageGenerationSizeFrom4K,
  getImageGenerationSizeTier,
  requiresHighQualityForSize,
} from './image-generation.js';

describe('image-generation helpers', () => {
  it('classifies canonical GPT Image 2 presets into the expected tiers', () => {
    expect(getImageGenerationSizeTier('1024x1024')).toBe('1k');
    expect(getImageGenerationSizeTier('1536x1024')).toBe('1k');
    expect(getImageGenerationSizeTier('2048x2048')).toBe('2k');
    expect(getImageGenerationSizeTier('2048x1152')).toBe('2k');
    expect(getImageGenerationSizeTier('3840x2160')).toBe('4k');
    expect(getImageGenerationSizeTier('2160x3840')).toBe('4k');
  });

  it('requires high quality for 2K and 4K sizes only', () => {
    expect(requiresHighQualityForSize('1024x1024')).toBe(false);
    expect(requiresHighQualityForSize('1536x1024')).toBe(false);
    expect(requiresHighQualityForSize('2048x1152')).toBe(true);
    expect(requiresHighQualityForSize('2048x2048')).toBe(true);
    expect(requiresHighQualityForSize('3840x2160')).toBe(true);
  });

  it('downgrades 4K sizes to the closest 2K preset shape', () => {
    expect(downgradeImageGenerationSizeFrom4K('3840x2160')).toBe('2048x1152');
    expect(downgradeImageGenerationSizeFrom4K('2160x3840')).toBe('1152x2048');
    expect(downgradeImageGenerationSizeFrom4K('3840x3840')).toBe('2048x2048');
    expect(downgradeImageGenerationSizeFrom4K('not-a-size')).toBe('2048x2048');
  });
});
