export const SPRITE_RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;
export type CompanionSpriteRarity = (typeof SPRITE_RARITIES)[number];

export const SPRITE_SPECIES = [
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
export type CompanionSpriteSpecies = (typeof SPRITE_SPECIES)[number];

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

const SPRITE_BODIES: Record<CompanionSpriteSpecies, string[][]> = {
  duck: [
    ['            ', '    __      ', '  <({E} )___  ', '   (  ._>   ', '    `--´    '],
    ['            ', '    __      ', '  <({E} )___  ', '   (  ._>   ', '    `--´~   '],
    ['            ', '    __      ', '  <({E} )___  ', '   (  .__>  ', '    `--´    '],
  ],
  goose: [
    ['            ', '     ({E}>    ', '     ||     ', '   _(__)_   ', '    ^^^^    '],
    ['            ', '    ({E}>     ', '     ||     ', '   _(__)_   ', '    ^^^^    '],
    ['            ', '     ({E}>>   ', '     ||     ', '   _(__)_   ', '    ^^^^    '],
  ],
  blob: [
    ['            ', '   .----.   ', '  ( {E}  {E} )  ', '  (      )  ', '   `----´   '],
    ['            ', '  .------.  ', ' (  {E}  {E}  ) ', ' (        ) ', '  `------´  '],
    ['            ', '    .--.    ', '   ({E}  {E})   ', '   (    )   ', '    `--´    '],
  ],
  cat: [
    ['            ', '   /\\_/\\    ', '  ( {E}   {E})  ', '  (  ω  )   ', '  (")_(")   '],
    ['            ', '   /\\_/\\    ', '  ( {E}   {E})  ', '  (  ω  )   ', '  (")_(")~  '],
    ['            ', '   /\\-/\\    ', '  ( {E}   {E})  ', '  (  ω  )   ', '  (")_(")   '],
  ],
  dragon: [
    ['            ', '  /^\\  /^\\  ', ' <  {E}  {E}  > ', ' (   ~~   ) ', '  `-vvvv-´  '],
    ['            ', '  /^\\  /^\\  ', ' <  {E}  {E}  > ', ' (        ) ', '  `-vvvv-´  '],
    ['   ~    ~   ', '  /^\\  /^\\  ', ' <  {E}  {E}  > ', ' (   ~~   ) ', '  `-vvvv-´  '],
  ],
  octopus: [
    ['            ', '   .----.   ', '  ( {E}  {E} )  ', '  (______)  ', '  /\\/\\/\\/\\  '],
    ['            ', '   .----.   ', '  ( {E}  {E} )  ', '  (______)  ', '  \\/\\/\\/\\/  '],
    ['     o      ', '   .----.   ', '  ( {E}  {E} )  ', '  (______)  ', '  /\\/\\/\\/\\  '],
  ],
  owl: [
    ['            ', '   /\\  /\\   ', '  (({E})({E}))  ', '  (  ><  )  ', '   `----´   '],
    ['            ', '   /\\  /\\   ', '  (({E})({E}))  ', '  (  ><  )  ', '   .----.   '],
    ['            ', '   /\\  /\\   ', '  (({E})(-))  ', '  (  ><  )  ', '   `----´   '],
  ],
  penguin: [
    ['            ', '  .---.     ', '  ({E}>{E})     ', ' /(   )\\    ', '  `---´     '],
    ['            ', '  .---.     ', '  ({E}>{E})     ', ' |(   )|    ', '  `---´     '],
    ['  .---.     ', '  ({E}>{E})     ', ' /(   )\\    ', '  `---´     ', '   ~ ~      '],
  ],
  turtle: [
    ['            ', '   _,--._   ', '  ( {E}  {E} )  ', ' /[______]\\ ', '  ``    ``  '],
    ['            ', '   _,--._   ', '  ( {E}  {E} )  ', ' /[______]\\ ', '   ``  ``   '],
    ['            ', '   _,--._   ', '  ( {E}  {E} )  ', ' /[======]\\ ', '  ``    ``  '],
  ],
  snail: [
    ['            ', ' {E}    .--.  ', '  \\  ( @ )  ', '   \\_`--´   ', '  ~~~~~~~   '],
    ['            ', '  {E}   .--.  ', '  |  ( @ )  ', '   \\_`--´   ', '  ~~~~~~~   '],
    ['            ', ' {E}    .--.  ', '  \\  ( @  ) ', '   \\_`--´   ', '   ~~~~~~   '],
  ],
  ghost: [
    ['            ', '   .----.   ', '  / {E}  {E} \\  ', '  |      |  ', '  ~`~``~`~  '],
    ['            ', '   .----.   ', '  / {E}  {E} \\  ', '  |      |  ', '  `~`~~`~`  '],
    ['    ~  ~    ', '   .----.   ', '  / {E}  {E} \\  ', '  |      |  ', '  ~~`~~`~~  '],
  ],
  axolotl: [
    ['            ', '}~(______)~{', '}~({E} .. {E})~{', '  ( .--. )  ', '  (_/  \\_)  '],
    ['            ', '~}(______){~', '~}({E} .. {E}){~', '  ( .--. )  ', '  (_/  \\_)  '],
    ['            ', '}~(______)~{', '}~({E} .. {E})~{', '  (  --  )  ', '  ~_/  \\_~  '],
  ],
  capybara: [
    ['            ', '  n______n  ', ' ( {E}    {E} ) ', ' (   oo   ) ', '  `------´  '],
    ['            ', '  n______n  ', ' ( {E}    {E} ) ', ' (   Oo   ) ', '  `------´  '],
    ['    ~  ~    ', '  u______n  ', ' ( {E}    {E} ) ', ' (   oo   ) ', '  `------´  '],
  ],
  cactus: [
    ['            ', ' n  ____  n ', ' | |{E}  {E}| | ', ' |_|    |_| ', '   |    |   '],
    ['            ', '    ____    ', ' n |{E}  {E}| n ', ' |_|    |_| ', '   |    |   '],
    [' n        n ', ' |  ____  | ', ' | |{E}  {E}| | ', ' |_|    |_| ', '   |    |   '],
  ],
  robot: [
    ['            ', '   .[||].   ', '  [ {E}  {E} ]  ', '  [ ==== ]  ', '  `------´  '],
    ['            ', '   .[||].   ', '  [ {E}  {E} ]  ', '  [ -==- ]  ', '  `------´  '],
    ['     *      ', '   .[||].   ', '  [ {E}  {E} ]  ', '  [ ==== ]  ', '  `------´  '],
  ],
  rabbit: [
    ['            ', '   (\\__/)   ', '  ( {E}  {E} )  ', ' =(  ..  )= ', '  (")__(")  '],
    ['            ', '   (|__/)   ', '  ( {E}  {E} )  ', ' =(  ..  )= ', '  (")__(")  '],
    ['            ', '   (\\__/)   ', '  ( {E}  {E} )  ', ' =( .  . )= ', '  (")__(")  '],
  ],
  mushroom: [
    ['            ', ' .-o-OO-o-. ', '(__________)', '   |{E}  {E}|   ', '   |____|   '],
    ['            ', ' .-O-oo-O-. ', '(__________)', '   |{E}  {E}|   ', '   |____|   '],
    ['   . o  .   ', ' .-o-OO-o-. ', '(__________)', '   |{E}  {E}|   ', '   |____|   '],
  ],
  chonk: [
    ['            ', '  /\\    /\\  ', ' ( {E}    {E} ) ', ' (   ..   ) ', '  `------´  '],
    ['            ', '  /\\    /|  ', ' ( {E}    {E} ) ', ' (   ..   ) ', '  `------´  '],
    ['            ', '  /\\    /\\  ', ' ( {E}    {E} ) ', ' (   ..   ) ', '  `------´~ '],
  ],
};

const HAT_LINES: Record<CompanionSpriteHat, string> = {
  none: '',
  crown: '   \\^^^/    ',
  tophat: '   [___]    ',
  propeller: '    -+-     ',
  halo: '   (   )    ',
  wizard: '    /^\\     ',
  beanie: '   (___)    ',
  tinyduck: '    ,>      ',
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

export function createCompanionSpriteBones(seedInput: string): CompanionSpriteBones {
  const rng = mulberry32(hashString(`${seedInput}:friend-2026-401`));
  const rarity = rollSpriteRarity(rng);
  return {
    eye: pick(rng, SPRITE_EYES),
    hat: rarity === 'common' ? 'none' : pick(rng, SPRITE_HATS),
    rarity,
    shiny: rng() < 0.01,
    species: pick(rng, SPRITE_SPECIES),
  };
}

export function spriteDisplayLabel(species: CompanionSpriteSpecies): string {
  return SPRITE_SPECIES_LABELS[species];
}

export function spriteRarityStars(rarity: CompanionSpriteRarity): string {
  return SPRITE_RARITY_STARS[rarity];
}

export function spriteFrameCount(species: CompanionSpriteSpecies): number {
  return SPRITE_BODIES[species].length;
}

export function renderCompanionSprite(bones: CompanionSpriteBones, frame = 0): string[] {
  const frames = SPRITE_BODIES[bones.species];
  const body = frames[frame % frames.length]!.map((line) => line.replaceAll('{E}', bones.eye));
  const lines = [...body];
  if (bones.hat !== 'none' && !lines[0]!.trim()) {
    lines[0] = HAT_LINES[bones.hat];
  }
  if (!lines[0]!.trim() && frames.every((item) => !item[0]!.trim())) {
    lines.shift();
  }
  return lines;
}

export function renderCompanionFace(bones: CompanionSpriteBones): string {
  switch (bones.species) {
    case 'duck':
    case 'goose':
      return `(${bones.eye}>`;
    case 'blob':
      return `(${bones.eye}${bones.eye})`;
    case 'cat':
      return `=${bones.eye}ω${bones.eye}=`;
    case 'dragon':
      return `<${bones.eye}~${bones.eye}>`;
    case 'octopus':
      return `~(${bones.eye}${bones.eye})~`;
    case 'owl':
      return `(${bones.eye})(${bones.eye})`;
    case 'penguin':
      return `(${bones.eye}>)`;
    case 'turtle':
      return `[${bones.eye}_${bones.eye}]`;
    case 'snail':
      return `${bones.eye}(@)`;
    case 'ghost':
      return `/${bones.eye}${bones.eye}\\`;
    case 'axolotl':
      return `}${bones.eye}.${bones.eye}{`;
    case 'capybara':
      return `(${bones.eye}oo${bones.eye})`;
    case 'cactus':
      return `|${bones.eye}  ${bones.eye}|`;
    case 'robot':
      return `[${bones.eye}${bones.eye}]`;
    case 'rabbit':
      return `(${bones.eye}..${bones.eye})`;
    case 'mushroom':
      return `|${bones.eye}  ${bones.eye}|`;
    case 'chonk':
      return `(${bones.eye}.${bones.eye})`;
  }
}
