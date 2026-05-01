export type ImageGenerationSizePresetTier = '1k' | '2k' | '4k';
export type ImageGenerationSizeAspect = 'square' | 'landscape' | 'portrait';
export type ImageGenerationSizePresetId =
  | `${ImageGenerationSizePresetTier}-${ImageGenerationSizeAspect}`
  | 'custom';
export type ImageGenerationQuality = 'low' | 'medium' | 'high';
export type ImageGenerationOutputFormat = 'png' | 'jpeg' | 'webp';
export type ImageGenerationBackground = 'auto' | 'opaque';

export interface ImageGenerationSizePreset {
  aspect: ImageGenerationSizeAspect;
  description: string;
  id: Exclude<ImageGenerationSizePresetId, 'custom'>;
  label: '方图' | '横图' | '竖图';
  size: string;
  tier: ImageGenerationSizePresetTier;
}

export interface ImageGenerationSizePresetGroup {
  description: string;
  label: '1K' | '2K' | '4K';
  presets: ImageGenerationSizePreset[];
  tier: ImageGenerationSizePresetTier;
}

export const DEFAULT_IMAGE_GENERATION_SIZE = '1024x1024';

export const IMAGE_GENERATION_SIZE_PRESETS: ImageGenerationSizePreset[] = [
  {
    id: '1k-square',
    tier: '1k',
    aspect: 'square',
    label: '方图',
    size: '1024x1024',
    description: '1024 × 1024 · 1:1',
  },
  {
    id: '1k-landscape',
    tier: '1k',
    aspect: 'landscape',
    label: '横图',
    size: '1536x1024',
    description: '1536 × 1024 · 3:2',
  },
  {
    id: '1k-portrait',
    tier: '1k',
    aspect: 'portrait',
    label: '竖图',
    size: '1024x1536',
    description: '1024 × 1536 · 2:3',
  },
  {
    id: '2k-square',
    tier: '2k',
    aspect: 'square',
    label: '方图',
    size: '2048x2048',
    description: '2048 × 2048 · 1:1',
  },
  {
    id: '2k-landscape',
    tier: '2k',
    aspect: 'landscape',
    label: '横图',
    size: '2048x1152',
    description: '2048 × 1152 · 16:9',
  },
  {
    id: '2k-portrait',
    tier: '2k',
    aspect: 'portrait',
    label: '竖图',
    size: '1152x2048',
    description: '1152 × 2048 · 9:16',
  },
  {
    id: '4k-landscape',
    tier: '4k',
    aspect: 'landscape',
    label: '横图',
    size: '3840x2160',
    description: '3840 × 2160 · 16:9',
  },
  {
    id: '4k-portrait',
    tier: '4k',
    aspect: 'portrait',
    label: '竖图',
    size: '2160x3840',
    description: '2160 × 3840 · 9:16',
  },
];

export const IMAGE_GENERATION_SIZE_PRESET_GROUPS: ImageGenerationSizePresetGroup[] = [
  {
    tier: '1k',
    label: '1K',
    description: '基础档，适合大多数常规生图。',
    presets: IMAGE_GENERATION_SIZE_PRESETS.filter((preset) => preset.tier === '1k'),
  },
  {
    tier: '2k',
    label: '2K',
    description: '更高细节；方图/横图/竖图都可直接选。',
    presets: IMAGE_GENERATION_SIZE_PRESETS.filter((preset) => preset.tier === '2k'),
  },
  {
    tier: '4k',
    label: '4K',
    description: '高分辨率预设；官方像素上限下仅提供横图/竖图。',
    presets: IMAGE_GENERATION_SIZE_PRESETS.filter((preset) => preset.tier === '4k'),
  },
];

export function parseImageGenerationSize(value: string): { height: number; width: number } | null {
  const match = /^(\d{2,5})x(\d{2,5})$/i.exec(value.trim());
  if (!match) {
    return null;
  }

  const width = Number.parseInt(match[1] ?? '', 10);
  const height = Number.parseInt(match[2] ?? '', 10);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }

  return { width, height };
}

export function validateImageGenerationSize(value: string): { message?: string; valid: boolean } {
  const parsed = parseImageGenerationSize(value);
  if (!parsed) {
    return { valid: false, message: '尺寸必须使用 WxH 格式，例如 2048x2048。' };
  }

  const { width, height } = parsed;
  if (width % 16 !== 0 || height % 16 !== 0) {
    return { valid: false, message: '宽和高都必须是 16 的倍数。' };
  }

  const maxEdge = Math.max(width, height);
  const minEdge = Math.min(width, height);
  if (maxEdge > 3840) {
    return { valid: false, message: '最长边不能超过 3840 像素。' };
  }

  if (minEdge === 0 || maxEdge / minEdge > 3) {
    return { valid: false, message: '宽高比不能超过 3:1。' };
  }

  const totalPixels = width * height;
  if (totalPixels < 655_360 || totalPixels > 8_294_400) {
    return { valid: false, message: '总像素必须介于 655,360 到 8,294,400 之间。' };
  }

  return { valid: true };
}

export function normalizeImageGenerationSize(
  value: unknown,
  fallback = DEFAULT_IMAGE_GENERATION_SIZE,
): string {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  return validateImageGenerationSize(normalized).valid ? normalized : fallback;
}

export function resolveImageGenerationSizePresetId(size: string): ImageGenerationSizePresetId {
  const preset = IMAGE_GENERATION_SIZE_PRESETS.find((item) => item.size === size);
  return preset?.id ?? 'custom';
}

export function sizeForPreset(
  id: Exclude<ImageGenerationSizePresetId, 'custom'> | ImageGenerationSizePresetTier,
): string {
  const directPreset = IMAGE_GENERATION_SIZE_PRESETS.find((item) => item.id === id);
  if (directPreset) {
    return directPreset.size;
  }

  const groupFallback = IMAGE_GENERATION_SIZE_PRESET_GROUPS.find((group) => group.tier === id)
    ?.presets[0]?.size;
  return groupFallback ?? DEFAULT_IMAGE_GENERATION_SIZE;
}

/**
 * Classify an arbitrary image generation size into a tier (1K/2K/4K).
 * The tier is decided by the longest edge:
 *   - max edge ≤ 1536 → 1K
 *   - 1536 < max edge ≤ 2560 → 2K
 *   - max edge > 2560 → 4K
 * Returns null if the value is not parseable. Custom sizes are included.
 */
export function getImageGenerationSizeTier(size: string): ImageGenerationSizePresetTier | null {
  const parsed = parseImageGenerationSize(size);
  if (!parsed) {
    return null;
  }
  const maxEdge = Math.max(parsed.width, parsed.height);
  if (maxEdge <= 1536) {
    return '1k';
  }
  if (maxEdge <= 2560) {
    return '2k';
  }
  return '4k';
}

/**
 * GPT Image 2 requires `quality="high"` whenever the request goes beyond 1K.
 * Sources of truth:
 *   - 2K: documented as needing high quality on the official API.
 *   - 4K: experimental relay extension; high quality avoids rejection on most relays.
 */
export function requiresHighQualityForSize(size: string): boolean {
  const tier = getImageGenerationSizeTier(size);
  return tier === '2k' || tier === '4k';
}

export function downgradeImageGenerationSizeFrom4K(size: string): string {
  const parsed = parseImageGenerationSize(size);
  if (!parsed) {
    return sizeForPreset('2k-square');
  }

  if (parsed.width === parsed.height) {
    return sizeForPreset('2k-square');
  }

  return parsed.width > parsed.height
    ? sizeForPreset('2k-landscape')
    : sizeForPreset('2k-portrait');
}

/**
 * Recommended HTTP timeouts (ms) per tier when calling the upstream image
 * generation endpoint. 4K needs ≥ 6 minutes per OpenAI guidance; 2K can take
 * ~2 minutes; 1K usually finishes within a minute.
 */
export const IMAGE_GENERATION_TIMEOUT_MS_BY_TIER: Record<ImageGenerationSizePresetTier, number> = {
  '1k': 90_000,
  '2k': 180_000,
  '4k': 360_000,
};

export function resolveImageGenerationTimeoutMs(size: string): number {
  const tier = getImageGenerationSizeTier(size);
  if (!tier) {
    return IMAGE_GENERATION_TIMEOUT_MS_BY_TIER['2k'];
  }
  return IMAGE_GENERATION_TIMEOUT_MS_BY_TIER[tier];
}
