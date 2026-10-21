import { describe, expect, it } from 'vitest';
import { IMAGE_GENERATION_COUNT_RANGE } from '@openAwork/shared';
import { resolveImageGenerationDefaults } from '../../image-generation/image-generation-schema.js';

describe('resolveImageGenerationDefaults', () => {
  const fallback: Parameters<typeof resolveImageGenerationDefaults>[1] = {
    size: '1024x1024',
    quality: 'medium',
    outputFormat: 'png',
    background: 'auto',
  };

  it('keeps requested quality for 1K sizes', () => {
    const resolved = resolveImageGenerationDefaults(
      { size: '1024x1024', quality: 'medium' },
      fallback,
    );

    expect(resolved.quality).toBe('medium');
    expect(resolved.requestedQuality).toBe('medium');
    expect(resolved.qualityAutoLifted).toBe(false);
  });

  it('auto-lifts 2K sizes to high quality on legacy models', () => {
    const resolved = resolveImageGenerationDefaults(
      { size: '2048x1152', quality: 'low' },
      fallback,
      { modelId: 'gpt-image-2' },
    );

    expect(resolved.quality).toBe('high');
    expect(resolved.requestedQuality).toBe('low');
    expect(resolved.qualityAutoLifted).toBe(true);
  });

  it('auto-lifts 4K sizes to high quality on legacy models', () => {
    const resolved = resolveImageGenerationDefaults(
      { size: '3840x2160', quality: 'medium' },
      fallback,
      { modelId: 'gpt-image-2' },
    );

    expect(resolved.quality).toBe('high');
    expect(resolved.requestedQuality).toBe('medium');
    expect(resolved.qualityAutoLifted).toBe(true);
  });

  it('does not auto-lift 2K sizes on GPT Image 2.5', () => {
    const resolved = resolveImageGenerationDefaults(
      { size: '2048x1152', quality: 'medium' },
      fallback,
      { modelId: 'gpt-image-2.5-flare' },
    );

    expect(resolved.quality).toBe('medium');
    expect(resolved.qualityAutoLifted).toBe(false);
  });

  it('keeps the new xhigh / max tiers for GPT Image 2.5', () => {
    const resolved = resolveImageGenerationDefaults(
      { size: '1024x1024', quality: 'max' },
      fallback,
      { modelId: 'gpt-image-2.5-sunburst' },
    );

    expect(resolved.quality).toBe('max');
    expect(resolved.qualityClamped).toBe(false);
  });

  it('clamps xhigh / max to high on models that only support up to high', () => {
    const resolved = resolveImageGenerationDefaults(
      { size: '1024x1024', quality: 'xhigh' },
      fallback,
      { modelId: 'gpt-image-2' },
    );

    expect(resolved.quality).toBe('high');
    expect(resolved.requestedQuality).toBe('xhigh');
    expect(resolved.qualityClamped).toBe(true);
  });

  it('never lifts quality=auto', () => {
    const resolved = resolveImageGenerationDefaults(
      { size: '2048x1152', quality: 'auto' },
      fallback,
      { modelId: 'gpt-image-2' },
    );

    expect(resolved.quality).toBe('auto');
    expect(resolved.qualityAutoLifted).toBe(false);
  });

  it('reports a notice for transparent background on jpeg', () => {
    const resolved = resolveImageGenerationDefaults(
      { background: 'transparent', outputFormat: 'jpeg' },
      fallback,
      { modelId: 'gpt-image-2.5-flare' },
    );

    expect(resolved.backgroundNotice).toContain('透明背景');
  });

  it('accepts transparent background on png', () => {
    const resolved = resolveImageGenerationDefaults(
      { background: 'transparent', outputFormat: 'png' },
      fallback,
      { modelId: 'gpt-image-2.5-flare' },
    );

    expect(resolved.backgroundNotice).toBeNull();
    expect(resolved.background).toBe('transparent');
  });

  it('drops outputCompression for png and keeps it for jpeg', () => {
    const png = resolveImageGenerationDefaults(
      { outputCompression: 60, outputFormat: 'png' },
      fallback,
      { modelId: 'gpt-image-2.5-flare' },
    );
    const jpeg = resolveImageGenerationDefaults(
      { outputCompression: 60, outputFormat: 'jpeg' },
      fallback,
      { modelId: 'gpt-image-2.5-flare' },
    );

    expect(png.outputCompression).toBeUndefined();
    expect(jpeg.outputCompression).toBe(60);
  });

  it('defaults moderation to auto and honours an explicit low', () => {
    expect(resolveImageGenerationDefaults(undefined, fallback).moderation).toBe('auto');
    expect(resolveImageGenerationDefaults({ moderation: 'low' }, fallback).moderation).toBe('low');
  });

  it('defaults the count to one and clamps out-of-range requests', () => {
    expect(resolveImageGenerationDefaults(undefined, fallback).count).toBe(1);
    expect(resolveImageGenerationDefaults({ count: 3 }, fallback).count).toBe(3);
    expect(resolveImageGenerationDefaults({ count: 99 }, fallback).count).toBe(
      IMAGE_GENERATION_COUNT_RANGE.max,
    );
    expect(resolveImageGenerationDefaults({ count: 0 }, fallback).count).toBe(
      IMAGE_GENERATION_COUNT_RANGE.min,
    );
    // 小数张数没有意义：向下取整而不是四舍五入，避免「要 2 张却发 3 张」。
    expect(resolveImageGenerationDefaults({ count: 2.9 }, fallback).count).toBe(2);
  });
});
