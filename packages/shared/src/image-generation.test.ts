import { describe, expect, it } from 'vitest';
import {
  clampImageGenerationQuality,
  downgradeImageGenerationSizeFrom4K,
  getImageGenerationQualityOptions,
  getImageGenerationSizeTier,
  requiresHighQualityForSize,
  resolveImageGenerationModelCapability,
  shouldLiftQualityToHigh,
  validateImageGenerationBackgroundCombination,
  validateImageGenerationSize,
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

  it('accepts "auto" as a valid size and rejects nonsense', () => {
    expect(validateImageGenerationSize('auto')).toStrictEqual({ valid: true });
    expect(validateImageGenerationSize('AUTO')).toStrictEqual({ valid: true });
    expect(validateImageGenerationSize('2048x1152')).toStrictEqual({ valid: true });
    expect(validateImageGenerationSize('2049x1152').valid).toBe(false);
  });

  it('resolves GPT Image 2.5 capability including the new quality tiers', () => {
    const capability = resolveImageGenerationModelCapability('gpt-image-2.5-flare');
    expect(capability.family).toBe('gpt-image-2.5');
    expect(capability.maxQuality).toBe('max');
    expect(capability.requiresHighQualityBeyond1K).toBe(false);
    expect(capability.supportsTransparentBackground).toBe(true);
  });

  it('strips relay namespaces before matching the model family', () => {
    expect(resolveImageGenerationModelCapability('openai/gpt-image-2.5-sunburst').family).toBe(
      'gpt-image-2.5',
    );
    expect(resolveImageGenerationModelCapability('gpt-image-2.5-flare:free').family).toBe(
      'gpt-image-2.5',
    );
    expect(resolveImageGenerationModelCapability('gpt-image-2').family).toBe('gpt-image-2');
    expect(resolveImageGenerationModelCapability('my-relay-model').family).toBe('unknown');
    expect(resolveImageGenerationModelCapability(undefined).family).toBe('unknown');
  });

  it('only offers xhigh / max to GPT Image 2.5', () => {
    const values = (modelId: string) =>
      getImageGenerationQualityOptions(modelId).map((option) => option.value);

    expect(values('gpt-image-2.5-flare')).toEqual([
      'auto',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
    expect(values('gpt-image-2')).toEqual(['auto', 'low', 'medium', 'high']);
    expect(values('unknown-model')).toEqual(['low', 'medium', 'high']);
  });

  it('clamps quality to the capability of the selected model', () => {
    expect(clampImageGenerationQuality('gpt-image-2.5-flare', 'max')).toBe('max');
    expect(clampImageGenerationQuality('gpt-image-2', 'max')).toBe('high');
    expect(clampImageGenerationQuality('gpt-image-2', 'xhigh')).toBe('high');
    expect(clampImageGenerationQuality('gpt-image-2', 'auto')).toBe('auto');
    expect(clampImageGenerationQuality('unknown-model', 'auto')).toBe('high');
    expect(clampImageGenerationQuality('unknown-model', 'low')).toBe('low');
  });

  it('only lifts legacy models beyond 1K and never lifts "auto"', () => {
    expect(
      shouldLiftQualityToHigh({ modelId: 'gpt-image-2', quality: 'low', size: '2048x1152' }),
    ).toBe(true);
    expect(
      shouldLiftQualityToHigh({
        modelId: 'gpt-image-2.5-flare',
        quality: 'low',
        size: '2048x1152',
      }),
    ).toBe(false);
    expect(
      shouldLiftQualityToHigh({ modelId: 'gpt-image-2', quality: 'auto', size: '2048x1152' }),
    ).toBe(false);
    expect(
      shouldLiftQualityToHigh({ modelId: 'gpt-image-2', quality: 'low', size: '1024x1024' }),
    ).toBe(false);
  });

  it('requires png / webp for transparent backgrounds', () => {
    expect(
      validateImageGenerationBackgroundCombination({
        background: 'auto',
        outputFormat: 'jpeg',
        modelId: 'gpt-image-2.5-flare',
      }),
    ).toBeNull();
    expect(
      validateImageGenerationBackgroundCombination({
        background: 'transparent',
        outputFormat: 'jpeg',
        modelId: 'gpt-image-2.5-flare',
      }),
    ).toContain('PNG');
    expect(
      validateImageGenerationBackgroundCombination({
        background: 'transparent',
        outputFormat: 'webp',
        modelId: 'gpt-image-2.5-flare',
      }),
    ).toBeNull();
    expect(
      validateImageGenerationBackgroundCombination({
        background: 'transparent',
        outputFormat: 'png',
        modelId: 'my-relay-model',
      }),
    ).toContain('不支持透明背景');
  });
});
