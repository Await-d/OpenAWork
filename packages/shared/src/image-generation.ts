export type ImageGenerationSizePresetTier = '1k' | '2k' | '4k';
export type ImageGenerationSizeAspect = 'square' | 'landscape' | 'portrait';
export type ImageGenerationSizePresetId =
  `${ImageGenerationSizePresetTier}-${ImageGenerationSizeAspect}` | 'custom';
/**
 * 明确的质量档位。GPT Image 2.5 起新增 `xhigh` / `max`；更早的 GPT Image 模型
 * （gpt-image-2 及之前）最高只到 `high`，传入更高档位会被上游拒绝，因此必须
 * 经 `clampImageGenerationQuality` 按模型能力收敛。
 */
export type ImageGenerationQualityTier = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
/** 请求侧质量取值：明确档位，或交给模型按 prompt 自行决定的 `auto`（官方默认值）。 */
export type ImageGenerationQuality = ImageGenerationQualityTier | 'auto';
export type ImageGenerationOutputFormat = 'png' | 'jpeg' | 'webp';
export type ImageGenerationBackground = 'auto' | 'opaque' | 'transparent';
/** 内容审核严格度：`auto` 为标准过滤，`low` 更宽松。 */
export type ImageGenerationModeration = 'auto' | 'low';

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

/** `size` 的自动取值——由模型按 prompt 选择最合适的尺寸（官方默认值）。 */
export const IMAGE_GENERATION_SIZE_AUTO = 'auto';

/** `output_compression` 的取值范围（百分比，仅对 jpeg / webp 生效）。 */
export const IMAGE_GENERATION_OUTPUT_COMPRESSION_RANGE = { min: 0, max: 100 } as const;

/**
 * `partial_images` 的取值范围（流式生图的中间稿数量）。
 * 官方上限是 0–3；设 0 表示只收最终图。Requests API 与 Responses hosted 工具同域。
 */
export const IMAGE_GENERATION_PARTIAL_IMAGES_RANGE = { min: 0, max: 3 } as const;

/**
 * 单次请求可生成的图片张数（官方 `n` 参数）取值范围。
 * 官方未给出硬上限，这里取 4：张数会线性放大延迟、成本与产物数量，
 * 而下游还有 6 分钟级别的超时墙，再多就只剩超时风险。
 */
export const IMAGE_GENERATION_COUNT_RANGE = { max: 4, min: 1 } as const;

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
  if (value.trim().toLowerCase() === IMAGE_GENERATION_SIZE_AUTO) {
    return { valid: true };
  }

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
 *
 * GPT Image 2.5 起官方不再有此约束，是否提档由 `shouldLiftQualityToHigh` 按模型判定。
 */
export function requiresHighQualityForSize(size: string): boolean {
  const tier = getImageGenerationSizeTier(size);
  return tier === '2k' || tier === '4k';
}

const IMAGE_GENERATION_QUALITY_TIER_ORDER: readonly ImageGenerationQualityTier[] = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

export interface ImageGenerationQualityOption {
  description: string;
  label: string;
  value: ImageGenerationQuality;
}

export const IMAGE_GENERATION_QUALITY_OPTIONS: readonly ImageGenerationQualityOption[] = [
  {
    value: 'auto',
    label: '自动',
    description: '由模型按 prompt 自行选择，官方默认值。',
  },
  { value: 'low', label: '速度优先', description: '草稿级，最快出图。' },
  { value: 'medium', label: '平衡', description: '速度与细节兼顾。' },
  { value: 'high', label: '细节优先', description: '正式交付常用档位。' },
  { value: 'xhigh', label: '极高', description: '仅在 GPT Image 2.5 上可用，细节与材质更强。' },
  { value: 'max', label: '最高', description: '仅在 GPT Image 2.5 上可用，延迟与成本最高。' },
];

/**
 * 生图模型的能力画像——协议参数不是所有模型都吃：
 * GPT Image 2.5 新增 `xhigh` / `max` 质量档与 `moderation` / `output_compression`，
 * 而 gpt-image-2 及更早的模型最高只到 `high`。
 */
export interface ImageGenerationModelCapability {
  family: 'gpt-image-2.5' | 'gpt-image-2' | 'gpt-image-legacy' | 'unknown';
  /** 模型接受的最高质量档位；更高档位必须收敛到它。 */
  maxQuality: ImageGenerationQualityTier;
  /**
   * >1K 尺寸是否必须 `quality="high"`。
   * 这是 gpt-image-2 及更早模型的硬约束，GPT Image 2.5 起不再需要。
   */
  requiresHighQualityBeyond1K: boolean;
  supportsModeration: boolean;
  supportsOutputCompression: boolean;
  supportsQualityAuto: boolean;
  supportsSizeAuto: boolean;
  supportsTransparentBackground: boolean;
}

const GPT_IMAGE_25_CAPABILITY: ImageGenerationModelCapability = {
  family: 'gpt-image-2.5',
  maxQuality: 'max',
  requiresHighQualityBeyond1K: false,
  supportsModeration: true,
  supportsOutputCompression: true,
  supportsQualityAuto: true,
  supportsSizeAuto: true,
  supportsTransparentBackground: true,
};

const GPT_IMAGE_2_CAPABILITY: ImageGenerationModelCapability = {
  family: 'gpt-image-2',
  maxQuality: 'high',
  requiresHighQualityBeyond1K: true,
  supportsModeration: true,
  supportsOutputCompression: true,
  supportsQualityAuto: true,
  supportsSizeAuto: true,
  supportsTransparentBackground: true,
};

const UNKNOWN_IMAGE_MODEL_CAPABILITY: ImageGenerationModelCapability = {
  family: 'unknown',
  maxQuality: 'high',
  requiresHighQualityBeyond1K: true,
  supportsModeration: false,
  supportsOutputCompression: false,
  supportsQualityAuto: false,
  supportsSizeAuto: false,
  supportsTransparentBackground: false,
};

/**
 * 按模型 id 解析能力画像。中转商常给模型加前缀（`openai/gpt-image-2.5-flare`）
 * 或后缀（`gpt-image-2.5-flare:free`），故先剥掉命名空间再匹配；
 * 无法识别的模型按保守画像处理（不发新参数、不发超出 `high` 的档位）。
 */
export function resolveImageGenerationModelCapability(
  modelId: string | undefined,
): ImageGenerationModelCapability {
  if (typeof modelId !== 'string') {
    return UNKNOWN_IMAGE_MODEL_CAPABILITY;
  }

  const normalized = modelId.trim().toLowerCase();
  if (!normalized) {
    return UNKNOWN_IMAGE_MODEL_CAPABILITY;
  }

  const bare = normalized.slice(normalized.lastIndexOf('/') + 1).split(':')[0] ?? '';
  if (bare.startsWith('gpt-image-2.5')) {
    return GPT_IMAGE_25_CAPABILITY;
  }
  if (bare === 'gpt-image-2' || bare.startsWith('gpt-image-2-')) {
    return GPT_IMAGE_2_CAPABILITY;
  }
  return UNKNOWN_IMAGE_MODEL_CAPABILITY;
}

/** 该模型可选的质量档位（已按能力收敛，顺序为「由快到精」）。 */
export function getImageGenerationQualityOptions(
  modelId: string | undefined,
): readonly ImageGenerationQualityOption[] {
  const capability = resolveImageGenerationModelCapability(modelId);
  const maxIndex = IMAGE_GENERATION_QUALITY_TIER_ORDER.indexOf(capability.maxQuality);

  return IMAGE_GENERATION_QUALITY_OPTIONS.filter((option) => {
    if (option.value === 'auto') {
      return capability.supportsQualityAuto;
    }
    const index = IMAGE_GENERATION_QUALITY_TIER_ORDER.indexOf(option.value);
    return index >= 0 && index <= maxIndex;
  });
}

/** 把请求的 quality 收敛到模型支持的档位：超出上限则降级到上限，`auto` 不受支持时退到 `high`。 */
export function clampImageGenerationQuality(
  modelId: string | undefined,
  quality: ImageGenerationQuality,
): ImageGenerationQuality {
  const capability = resolveImageGenerationModelCapability(modelId);
  if (quality === 'auto') {
    return capability.supportsQualityAuto ? 'auto' : 'high';
  }

  const index = IMAGE_GENERATION_QUALITY_TIER_ORDER.indexOf(quality);
  const maxIndex = IMAGE_GENERATION_QUALITY_TIER_ORDER.indexOf(capability.maxQuality);
  if (index < 0 || maxIndex < 0) {
    return quality;
  }

  return index <= maxIndex ? quality : capability.maxQuality;
}

/**
 * 是否要把 quality 静默提升到 `high`。
 * - `auto` 由模型决定，永远不提升；
 * - 仅 `requiresHighQualityBeyond1K` 的旧模型在 2K/4K 下提升。
 */
export function shouldLiftQualityToHigh(input: {
  modelId: string | undefined;
  quality: ImageGenerationQuality;
  size: string;
}): boolean {
  if (input.quality === 'auto' || input.quality === 'high') {
    return false;
  }

  if (!resolveImageGenerationModelCapability(input.modelId).requiresHighQualityBeyond1K) {
    return false;
  }

  return requiresHighQualityForSize(input.size);
}

/**
 * 透明背景要求输出格式为 png 或 webp（jpeg 没有 alpha 通道）。
 * 返回 null 表示组合合法，否则返回可直接展示的提示。
 */
export function validateImageGenerationBackgroundCombination(input: {
  background: ImageGenerationBackground;
  outputFormat: ImageGenerationOutputFormat;
  modelId?: string | undefined;
}): string | null {
  if (input.background !== 'transparent') {
    return null;
  }

  if (!resolveImageGenerationModelCapability(input.modelId).supportsTransparentBackground) {
    return '当前图片模型不支持透明背景，请改用「自动」或「不透明」。';
  }

  if (input.outputFormat === 'jpeg') {
    return '透明背景需要 PNG 或 WebP 格式，JPEG 不支持透明通道。';
  }

  return null;
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
 * generation endpoint. 官方文档给出的上限是「复杂 prompt 最长约 2 分钟」，
 * 因此 1K 档也必须留足 150s；4K 属于实验性分辨率，留 6 分钟。
 * 客户端与网关共用这张表，避免任何一侧先超时并把它归一成「网络异常」。
 */
export const IMAGE_GENERATION_TIMEOUT_MS_BY_TIER: Record<ImageGenerationSizePresetTier, number> = {
  '1k': 150_000,
  '2k': 240_000,
  '4k': 360_000,
};

export function resolveImageGenerationTimeoutMs(size: string): number {
  const tier = getImageGenerationSizeTier(size);
  if (!tier) {
    return IMAGE_GENERATION_TIMEOUT_MS_BY_TIER['2k'];
  }
  return IMAGE_GENERATION_TIMEOUT_MS_BY_TIER[tier];
}
