import { z } from 'zod';
import type {
  CompanionAgentBinding,
  CompanionBehaviorTone,
  CompanionSpecies,
  CompanionThemeVariant,
  CompanionVoiceOutputMode,
  CompanionVoiceVariant,
} from '@openAwork/shared';
import { sqliteGet } from './db.js';

interface UserSettingRow {
  value: string;
}

export const companionInjectionModeSchema = z.enum(['off', 'mention_only', 'always']);
const companionVerbositySchema = z.enum(['minimal', 'normal']);
const companionThemeVariantSchema = z.enum(['default', 'playful']);
const companionBehaviorToneSchema = z.enum(['supportive', 'focused', 'playful']);
const companionVoiceOutputModeSchema = z.enum(['off', 'buddy_only', 'important_only']);
const companionVoiceVariantSchema = z.enum(['system', 'bright', 'calm']);

export const companionPreferencesSchema = z.object({
  enabled: z.boolean().default(true),
  muted: z.boolean().default(false),
  reducedMotion: z.boolean().default(false),
  verbosity: companionVerbositySchema.default('normal'),
  injectionMode: companionInjectionModeSchema.default('mention_only'),
  themeVariant: companionThemeVariantSchema.default('default'),
  voiceOutputEnabled: z.boolean().default(false),
  voiceOutputMode: companionVoiceOutputModeSchema.default('buddy_only'),
  voiceRate: z.number().min(0.5).max(2).default(1.02),
  voiceVariant: companionVoiceVariantSchema.default('system'),
});

export type CompanionPreferences = z.infer<typeof companionPreferencesSchema>;

export type CompanionAgentBindings = Record<string, CompanionAgentBinding>;

export const DEFAULT_COMPANION_PREFERENCES = companionPreferencesSchema.parse({});

const COMPANION_SETTINGS_KEY = 'companion_preferences_v1';
const COMPANION_TRIGGER_PATTERN = /(^|\s)\/buddy\b/i;

const SPRITE_RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;
type CompanionSpriteRarity = (typeof SPRITE_RARITIES)[number];

const SPRITE_SPECIES = [
  'duck',
  'goose',
  'blob',
  'cat',
  'dragon',
  'octopus',
  'owl',
  'penguin',
  'turtle',
  'snail',
  'ghost',
  'axolotl',
  'capybara',
  'cactus',
  'robot',
  'rabbit',
  'mushroom',
  'chonk',
] as const;
type CompanionSpriteSpecies = (typeof SPRITE_SPECIES)[number];

export const companionAgentBindingSchema = z.object({
  behaviorTone: companionBehaviorToneSchema.optional(),
  displayName: z.string().trim().min(1).max(40).optional(),
  injectionMode: companionInjectionModeSchema.optional(),
  species: z.enum(SPRITE_SPECIES),
  themeVariant: companionThemeVariantSchema.optional(),
  verbosity: companionVerbositySchema.optional(),
  voiceOutputMode: companionVoiceOutputModeSchema.optional(),
  voiceRate: z.number().min(0.5).max(2).optional(),
  voiceVariant: companionVoiceVariantSchema.optional(),
});

const companionSettingsStoredSchema = z.object({
  bindings: z.record(companionAgentBindingSchema).default({}),
  preferences: companionPreferencesSchema,
  profile: z.unknown().nullable().optional(),
  updatedAt: z.string().optional(),
});

export const companionSettingsUpdateSchema = z.object({
  bindings: z.record(companionAgentBindingSchema).optional(),
  preferences: companionPreferencesSchema.partial().optional(),
});

const SPRITE_EYES = ['·', '✦', '×', '◉', '@', '°'] as const;
type CompanionSpriteEye = (typeof SPRITE_EYES)[number];

const SPRITE_HATS = [
  'none',
  'crown',
  'tophat',
  'propeller',
  'halo',
  'wizard',
  'beanie',
  'tinyduck',
] as const;
type CompanionSpriteHat = (typeof SPRITE_HATS)[number];

export interface CompanionSpriteBones {
  eye: CompanionSpriteEye;
  hat: CompanionSpriteHat;
  rarity: CompanionSpriteRarity;
  shiny: boolean;
  species: CompanionSpriteSpecies;
}

export interface CompanionProfile {
  accentColor: string;
  accentTint: string;
  archetype: string;
  glyph: string;
  name: string;
  note: string;
  rarityStars: string;
  species: string;
  sprite: CompanionSpriteBones;
  traits: string[];
}

export interface CompanionSettingsRecord {
  activeBinding?: CompanionAgentBinding;
  bindings: CompanionAgentBindings;
  effectiveVoiceOutputMode: CompanionVoiceOutputMode;
  effectiveVoiceRate: number;
  effectiveVoiceVariant: CompanionVoiceVariant;
  preferences: CompanionPreferences;
  profile: CompanionProfile;
  updatedAt?: string;
}

const SPRITE_SPECIES_LABELS: Record<CompanionSpriteSpecies, string> = {
  duck: '小鸭',
  goose: '白鹅',
  blob: '软团',
  cat: '夜猫',
  dragon: '幼龙',
  octopus: '章鱼',
  owl: '猫头鹰',
  penguin: '企鹅',
  turtle: '海龟',
  snail: '蜗牛',
  ghost: '幽灵',
  axolotl: '六角恐龙',
  capybara: '水豚',
  cactus: '仙人掌',
  robot: '机械体',
  rabbit: '兔子',
  mushroom: '蘑菇',
  chonk: '团子兽',
};

const SPRITE_RARITY_WEIGHTS: Record<CompanionSpriteRarity, number> = {
  common: 60,
  uncommon: 25,
  rare: 10,
  epic: 4,
  legendary: 1,
};

const SPRITE_RARITY_STARS: Record<CompanionSpriteRarity, string> = {
  common: '★',
  uncommon: '★★',
  rare: '★★★',
  epic: '★★★★',
  legendary: '★★★★★',
};

const COMPANION_NAMES = ['雾灯', '回声', '稜镜', '潮汐', '灰羽', '柏舟', '松针', '折光'];
const COMPANION_ARCHETYPES = [
  '低打扰观察员',
  '节奏记录者',
  '上下文伴读者',
  '边栏巡航员',
  '静默副屏同伴',
  '工作台回声体',
];
const COMPANION_GLYPHS = ['✦', '◐', '◒', '✷', '◍', '◇', '◈', '✧'];
const COMPANION_NOTES = [
  '只在你需要时露面，不抢主助手的话筒。',
  '擅长贴着输入节奏给出轻声反馈。',
  '偏爱把复杂过程压成一句安静提示。',
  '更像工作台里的第二道呼吸，而不是第二个助手。',
];
const COMPANION_TRAIT_SETS = [
  ['低打扰', '看输入', '贴着节奏'],
  ['看附件', '看队列', '不抢前景'],
  ['看运行态', '看待办', '轻量提醒'],
  ['跟侧栏', '跟命令', '跟上下文'],
] as const;
const COMPANION_TONE_PROFILES: Record<
  CompanionBehaviorTone,
  { archetype: string; note: string; tag: string }
> = {
  supportive: {
    archetype: '安抚型陪跑者',
    note: '更关注稳定情绪和节奏托底，会优先给出柔和但明确的提醒。',
    tag: '情绪托底',
  },
  focused: {
    archetype: '聚焦型执行伴侣',
    note: '偏向把干扰压低，只保留最短路径的执行提示与任务推进感。',
    tag: '执行优先',
  },
  playful: {
    archetype: '轻快型工作台搭子',
    note: '语气更轻松，允许在不抢主线的前提下给出一点玩笑和活力。',
    tag: '轻快互动',
  },
};
type CompanionPalette = {
  accentColor: string;
  accentTint: string;
};
const COMPANION_PALETTES = {
  default: [
    {
      accentColor: 'var(--accent)',
      accentTint: 'color-mix(in oklch, var(--accent) 14%, transparent)',
    },
    {
      accentColor: 'color-mix(in oklch, var(--success) 82%, white 18%)',
      accentTint: 'color-mix(in oklch, var(--success) 14%, transparent)',
    },
    {
      accentColor: 'color-mix(in oklch, var(--warning) 82%, white 18%)',
      accentTint: 'color-mix(in oklch, var(--warning) 16%, transparent)',
    },
  ] satisfies CompanionPalette[],
  playful: [
    {
      accentColor: 'color-mix(in oklch, var(--warning) 88%, white 12%)',
      accentTint: 'color-mix(in oklch, var(--warning) 18%, transparent)',
    },
    {
      accentColor: 'color-mix(in oklch, var(--accent) 88%, white 12%)',
      accentTint: 'color-mix(in oklch, var(--accent) 18%, transparent)',
    },
    {
      accentColor: 'color-mix(in oklch, var(--success) 86%, white 14%)',
      accentTint: 'color-mix(in oklch, var(--success) 16%, transparent)',
    },
  ] satisfies CompanionPalette[],
} as const;

function parseStoredJson(value: string | undefined): unknown {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function normalizeAgentId(agentId: string | null | undefined): string | undefined {
  if (typeof agentId !== 'string') {
    return undefined;
  }

  const normalized = agentId.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeCompanionBindings(
  bindings: Record<string, CompanionAgentBinding>,
): CompanionAgentBindings {
  return Object.fromEntries(
    Object.entries(bindings).flatMap(([agentId, binding]) => {
      const normalizedAgentId = normalizeAgentId(agentId);
      if (!normalizedAgentId) {
        return [];
      }

      return [[normalizedAgentId, binding] as const];
    }),
  );
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pickBySeed<T>(values: readonly T[], seed: number, offset = 0): T {
  return values[(seed + offset) % values.length] ?? values[0]!;
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value |= 0;
    value = (value + 0x6d2b79f5) | 0;
    let next = Math.imul(value ^ (value >>> 15), 1 | value);
    next = (next + Math.imul(next ^ (next >>> 7), 61 | next)) ^ next;
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, values: readonly T[]): T {
  return values[Math.floor(rng() * values.length)] ?? values[0]!;
}

function rollSpriteRarity(rng: () => number): CompanionSpriteRarity {
  const total = Object.values(SPRITE_RARITY_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
  let roll = rng() * total;
  for (const rarity of SPRITE_RARITIES) {
    roll -= SPRITE_RARITY_WEIGHTS[rarity];
    if (roll < 0) {
      return rarity;
    }
  }
  return 'common';
}

function createCompanionSpriteBonesForSpecies(
  seedInput: string,
  speciesOverride?: CompanionSpecies,
): CompanionSpriteBones {
  const rng = mulberry32(hashString(`${seedInput}:friend-2026-401`));
  const rarity = rollSpriteRarity(rng);
  return {
    eye: pick(rng, SPRITE_EYES),
    hat: rarity === 'common' ? 'none' : pick(rng, SPRITE_HATS),
    rarity,
    shiny: rng() < 0.01,
    species: speciesOverride ?? pick(rng, SPRITE_SPECIES),
  };
}

function spriteDisplayLabel(species: CompanionSpriteSpecies): string {
  return SPRITE_SPECIES_LABELS[species];
}

function spriteRarityStars(rarity: CompanionSpriteRarity): string {
  return SPRITE_RARITY_STARS[rarity];
}

export function createCompanionProfile(
  seedInput: string,
  themeVariant: CompanionThemeVariant = 'default',
  overrides?: {
    behaviorTone?: CompanionBehaviorTone;
    displayName?: string;
    species?: CompanionSpecies;
  },
): CompanionProfile {
  const normalizedSeed = seedInput.trim().toLowerCase() || 'guest';
  const seed = hashString(normalizedSeed);
  const palette = pickBySeed(
    COMPANION_PALETTES[themeVariant],
    seed,
    themeVariant === 'playful' ? 1 : 2,
  );
  const sprite = createCompanionSpriteBonesForSpecies(normalizedSeed, overrides?.species);
  const toneProfile = overrides?.behaviorTone
    ? COMPANION_TONE_PROFILES[overrides.behaviorTone]
    : undefined;
  const baseTraits = [...pickBySeed(COMPANION_TRAIT_SETS, seed, 4)];
  return {
    accentColor: palette.accentColor,
    accentTint: palette.accentTint,
    archetype: toneProfile?.archetype ?? pickBySeed(COMPANION_ARCHETYPES, seed, 3),
    glyph: pickBySeed(COMPANION_GLYPHS, seed, 5),
    name: overrides?.displayName?.trim() || pickBySeed(COMPANION_NAMES, seed),
    note: toneProfile?.note ?? pickBySeed(COMPANION_NOTES, seed, 7),
    rarityStars: spriteRarityStars(sprite.rarity),
    species: spriteDisplayLabel(sprite.species),
    sprite,
    traits: toneProfile ? [toneProfile.tag, ...baseTraits] : baseTraits,
  };
}

export function buildCompanionIntroText(
  profile: Pick<CompanionProfile, 'name' | 'species'>,
): string {
  return `${profile.name} 会以一只${profile.species}的身份坐在输入框旁边轻声陪跑。除非你点名，不然我会把话让给主助手。`;
}

export function readCompanionSettings(value: string | undefined): CompanionSettingsRecord {
  const parsed = companionSettingsStoredSchema.safeParse(parseStoredJson(value));
  const preferences = parsed.success ? parsed.data.preferences : DEFAULT_COMPANION_PREFERENCES;
  return {
    activeBinding: undefined,
    bindings: parsed.success ? normalizeCompanionBindings(parsed.data.bindings) : {},
    effectiveVoiceOutputMode: preferences.voiceOutputMode,
    effectiveVoiceRate: preferences.voiceRate,
    effectiveVoiceVariant: preferences.voiceVariant,
    preferences,
    profile: createCompanionProfile('guest', preferences.themeVariant),
    ...(parsed.success && parsed.data.updatedAt ? { updatedAt: parsed.data.updatedAt } : {}),
  };
}

export function resolveCompanionBindingForAgent(params: {
  agentId?: string;
  bindings: CompanionAgentBindings;
}): CompanionAgentBinding | undefined {
  const normalizedAgentId = normalizeAgentId(params.agentId);
  return normalizedAgentId ? params.bindings[normalizedAgentId] : undefined;
}

export function resolveEffectiveCompanionPreferences(params: {
  activeBinding?: CompanionAgentBinding;
  preferences: CompanionPreferences;
}): Pick<CompanionPreferences, 'injectionMode' | 'verbosity'> {
  return {
    injectionMode: params.activeBinding?.injectionMode ?? params.preferences.injectionMode,
    verbosity: params.activeBinding?.verbosity ?? params.preferences.verbosity,
  };
}

export function resolveEffectiveCompanionVoiceSettings(params: {
  activeBinding?: CompanionAgentBinding;
  preferences: CompanionPreferences;
}): {
  voiceOutputMode: CompanionVoiceOutputMode;
  voiceRate: number;
  voiceVariant: CompanionVoiceVariant;
} {
  return {
    voiceOutputMode: params.activeBinding?.voiceOutputMode ?? params.preferences.voiceOutputMode,
    voiceRate: params.activeBinding?.voiceRate ?? params.preferences.voiceRate,
    voiceVariant: params.activeBinding?.voiceVariant ?? params.preferences.voiceVariant,
  };
}

export function resolveCompanionProfileForAgent(params: {
  agentId?: string;
  bindings: CompanionAgentBindings;
  preferences: CompanionPreferences;
  userEmail: string;
}): CompanionProfile {
  const normalizedAgentId = normalizeAgentId(params.agentId);
  const binding = resolveCompanionBindingForAgent({
    agentId: normalizedAgentId,
    bindings: params.bindings,
  });
  const themeVariant = binding?.themeVariant ?? params.preferences.themeVariant;
  const seed =
    binding && normalizedAgentId
      ? `${params.userEmail.trim().toLowerCase()}:${normalizedAgentId}`
      : params.userEmail;

  return createCompanionProfile(seed, themeVariant, {
    behaviorTone: binding?.behaviorTone,
    displayName: binding?.displayName,
    species: binding?.species,
  });
}

export function loadCompanionSettingsForUser(
  userId: string,
  userEmail: string,
  agentId?: string,
): CompanionSettingsRecord {
  const row = sqliteGet<UserSettingRow>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = ?`,
    [userId, COMPANION_SETTINGS_KEY],
  );
  const settings = readCompanionSettings(row?.value);
  const activeBinding = resolveCompanionBindingForAgent({ agentId, bindings: settings.bindings });
  const effectiveVoiceSettings = resolveEffectiveCompanionVoiceSettings({
    activeBinding,
    preferences: settings.preferences,
  });
  return {
    ...settings,
    activeBinding,
    effectiveVoiceOutputMode: effectiveVoiceSettings.voiceOutputMode,
    effectiveVoiceRate: effectiveVoiceSettings.voiceRate,
    effectiveVoiceVariant: effectiveVoiceSettings.voiceVariant,
    profile: resolveCompanionProfileForAgent({
      agentId,
      bindings: settings.bindings,
      preferences: settings.preferences,
      userEmail,
    }),
  };
}

export function buildCompanionFeatureState(preferences: CompanionPreferences): {
  enabled: boolean;
  mode: 'off' | 'beta';
} {
  return preferences.enabled ? { enabled: true, mode: 'beta' } : { enabled: false, mode: 'off' };
}

export function buildCompanionPrompt(
  settings: CompanionSettingsRecord,
  message: string,
): string | null {
  const effectivePreferences = resolveEffectiveCompanionPreferences({
    activeBinding: settings.activeBinding,
    preferences: settings.preferences,
  });

  if (!settings.preferences.enabled || effectivePreferences.injectionMode === 'off') {
    return null;
  }

  if (
    effectivePreferences.injectionMode === 'mention_only' &&
    !COMPANION_TRIGGER_PATTERN.test(message)
  ) {
    return null;
  }

  const intro = buildCompanionIntroText(settings.profile);
  const behaviorInstruction =
    effectivePreferences.verbosity === 'minimal'
      ? '保持极短、低打扰，不主动展开，不抢主助手的话筒。'
      : '保持低打扰，只在必要时补充轻量提醒、节奏反馈或陪伴式短句。';
  const injectionReason =
    effectivePreferences.injectionMode === 'always'
      ? '该 companion 处于常驻注入模式。'
      : '用户本轮显式使用了 /buddy，允许 companion 临时进入上下文。';
  const toneInstruction = settings.activeBinding?.behaviorTone
    ? `行为语气：${COMPANION_TONE_PROFILES[settings.activeBinding.behaviorTone].note}`
    : null;

  return [
    'OpenAWork companion 上下文：',
    intro,
    `${settings.profile.name} 的定位：${settings.profile.archetype}。`,
    `行为基调：${settings.profile.note}`,
    `关注标签：${settings.profile.traits.join(' / ')}`,
    toneInstruction,
    `注入原因：${injectionReason}`,
    `输出约束：${behaviorInstruction}`,
    '把 companion 视为工作台里的低打扰陪跑层，而不是第二个主助手。',
    '',
    `当你需要以 companion（${settings.profile.name}）的身份输出内容时，请使用以下结构化标记：`,
    '```companion',
    `${settings.profile.name} 的内容写在这里`,
    '```',
    'companion 标记内的内容会在 UI 中以独立的 companion 面板渲染，与主助手回复视觉分离。',
    '只在确实需要 companion 说话时才使用此标记，不要在每条回复中都使用。',
  ].join('\n');
}

export function getCompanionSettingsKey(): string {
  return COMPANION_SETTINGS_KEY;
}
