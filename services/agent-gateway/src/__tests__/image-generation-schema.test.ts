import { describe, expect, it } from 'vitest';
import { resolveImageGenerationDefaults } from '../image-generation/image-generation-schema.js';

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

  it('auto-lifts 2K sizes to high quality', () => {
    const resolved = resolveImageGenerationDefaults(
      { size: '2048x1152', quality: 'low' },
      fallback,
    );

    expect(resolved.quality).toBe('high');
    expect(resolved.requestedQuality).toBe('low');
    expect(resolved.qualityAutoLifted).toBe(true);
  });

  it('auto-lifts 4K sizes to high quality', () => {
    const resolved = resolveImageGenerationDefaults(
      { size: '3840x2160', quality: 'medium' },
      fallback,
    );

    expect(resolved.quality).toBe('high');
    expect(resolved.requestedQuality).toBe('medium');
    expect(resolved.qualityAutoLifted).toBe(true);
  });
});
