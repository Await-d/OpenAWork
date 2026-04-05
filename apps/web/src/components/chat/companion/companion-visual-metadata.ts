import type { CompanionProfile } from './companion-display-model.js';
import type { CompanionSpriteRarity } from './companion-sprite-model.js';

const COMPANION_STAT_NAMES = ['DEBUGGING', 'PATIENCE', 'CHAOS', 'WISDOM', 'SNARK'] as const;
type CompanionStatName = (typeof COMPANION_STAT_NAMES)[number];

const COMPANION_STAT_LABELS: Record<CompanionStatName, string> = {
  DEBUGGING: '调试',
  PATIENCE: '耐心',
  CHAOS: '混沌',
  WISDOM: '洞察',
  SNARK: '吐槽',
};

const RARITY_FLOOR: Record<CompanionSpriteRarity, number> = {
  common: 5,
  uncommon: 15,
  rare: 25,
  epic: 35,
  legendary: 50,
};

const RARITY_LABELS: Record<CompanionSpriteRarity, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
};

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
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

function buildStatSeed(profile: CompanionProfile): string {
  return [
    profile.name,
    profile.glyph,
    profile.sprite.species,
    profile.sprite.eye,
    profile.sprite.hat,
    profile.sprite.rarity,
  ].join(':');
}

export function deriveCompanionStats(profile: CompanionProfile): Array<{
  key: CompanionStatName;
  label: string;
  value: number;
}> {
  const rng = mulberry32(hashString(buildStatSeed(profile)));
  const floor = RARITY_FLOOR[profile.sprite.rarity];
  const peak = pick(rng, COMPANION_STAT_NAMES);
  let dump = pick(rng, COMPANION_STAT_NAMES);
  while (dump === peak) {
    dump = pick(rng, COMPANION_STAT_NAMES);
  }

  return COMPANION_STAT_NAMES.map((key) => {
    let value: number;
    if (key === peak) {
      value = Math.min(100, floor + 50 + Math.floor(rng() * 30));
    } else if (key === dump) {
      value = Math.max(1, floor - 10 + Math.floor(rng() * 15));
    } else {
      value = floor + Math.floor(rng() * 40);
    }

    return {
      key,
      label: COMPANION_STAT_LABELS[key],
      value,
    };
  });
}

export function getCompanionRarityVisual(rarity: CompanionSpriteRarity): {
  background: string;
  borderColor: string;
  color: string;
  label: string;
} {
  switch (rarity) {
    case 'common':
      return {
        background: 'color-mix(in oklch, var(--surface) 84%, transparent)',
        borderColor: 'color-mix(in oklch, var(--border) 78%, transparent)',
        color: 'var(--text-3)',
        label: RARITY_LABELS[rarity],
      };
    case 'uncommon':
      return {
        background: 'color-mix(in oklch, var(--success) 14%, transparent)',
        borderColor: 'color-mix(in oklch, var(--success) 38%, transparent)',
        color: 'var(--success)',
        label: RARITY_LABELS[rarity],
      };
    case 'rare':
      return {
        background: 'color-mix(in oklch, var(--accent) 14%, transparent)',
        borderColor: 'color-mix(in oklch, var(--accent) 42%, transparent)',
        color: 'var(--accent)',
        label: RARITY_LABELS[rarity],
      };
    case 'epic':
      return {
        background: 'color-mix(in oklch, var(--accent) 16%, var(--success) 8%)',
        borderColor: 'color-mix(in oklch, var(--accent) 52%, transparent)',
        color: 'color-mix(in oklch, var(--accent) 72%, var(--success) 28%)',
        label: RARITY_LABELS[rarity],
      };
    case 'legendary':
      return {
        background: 'color-mix(in oklch, var(--warning) 16%, transparent)',
        borderColor: 'color-mix(in oklch, var(--warning) 42%, transparent)',
        color: 'var(--warning)',
        label: RARITY_LABELS[rarity],
      };
  }
}
