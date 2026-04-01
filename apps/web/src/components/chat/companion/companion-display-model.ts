import {
  createCompanionSpriteBones,
  spriteDisplayLabel,
  spriteRarityStars,
  type CompanionSpriteBones,
} from './companion-sprite-model.js';

export interface CompanionActivitySnapshot {
  attachedCount: number;
  currentUserEmail: string;
  input: string;
  pendingPermissionCount: number;
  queuedCount: number;
  rightOpen: boolean;
  sessionBusyState: 'running' | 'paused' | null;
  sessionId: string | null;
  showVoice: boolean;
  streaming: boolean;
  todoCount: number;
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

export interface CompanionReaction {
  badge: string;
  importance: 'ambient' | 'notice' | 'active';
  text: string;
}

export interface CompanionUtteranceSeed {
  badge: string;
  text: string;
  tone: 'intro' | CompanionReaction['importance'];
}

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
];
const COMPANION_PALETTES = [
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
];
const IDLE_REACTIONS = [
  '我在侧边安静跟着，不会打断主线。',
  '今天我负责看节奏，你继续把注意力放在主对话。',
  '如果你开始引用文件或排队消息，我会先一步提醒。',
  '我会贴着工作台边缘待命，不抢镜。',
];

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

export function createCompanionProfile(seedInput: string): CompanionProfile {
  const normalizedSeed = seedInput.trim().toLowerCase() || 'guest';
  const seed = hashString(normalizedSeed);
  const palette = pickBySeed(COMPANION_PALETTES, seed, 2);
  const sprite = createCompanionSpriteBones(normalizedSeed);
  return {
    accentColor: palette.accentColor,
    accentTint: palette.accentTint,
    archetype: pickBySeed(COMPANION_ARCHETYPES, seed, 3),
    glyph: pickBySeed(COMPANION_GLYPHS, seed, 5),
    name: pickBySeed(COMPANION_NAMES, seed),
    note: pickBySeed(COMPANION_NOTES, seed, 7),
    rarityStars: spriteRarityStars(sprite.rarity),
    species: spriteDisplayLabel(sprite.species),
    sprite,
    traits: [...pickBySeed(COMPANION_TRAIT_SETS, seed, 4)],
  };
}

export function deriveCompanionReaction(snapshot: CompanionActivitySnapshot): CompanionReaction {
  if (snapshot.streaming) {
    return {
      badge: '跟随生成',
      importance: 'active',
      text: '主助手正在生成，我贴着边观察这轮输出。',
    };
  }

  if (snapshot.pendingPermissionCount > 0) {
    return {
      badge: '待确认',
      importance: 'notice',
      text: `右侧还有 ${snapshot.pendingPermissionCount} 项待确认动作，别忘了看一眼。`,
    };
  }

  if (snapshot.queuedCount > 0) {
    return {
      badge: '待发队列',
      importance: 'notice',
      text: `我在替你看着 ${snapshot.queuedCount} 条待发消息，节奏不会丢。`,
    };
  }

  if (snapshot.attachedCount > 0) {
    return {
      badge: '附件在场',
      importance: 'active',
      text: '这轮带上了附件，我会把注意力贴近上下文。',
    };
  }

  if (snapshot.showVoice) {
    return {
      badge: '语音输入',
      importance: 'active',
      text: '语音已打开，我会尽量保持短句和低打扰。',
    };
  }

  if (snapshot.sessionBusyState === 'running') {
    return {
      badge: '会话运行中',
      importance: 'notice',
      text: '当前会话还在继续运行，我先待在边缘，不挤占焦点。',
    };
  }

  if (snapshot.sessionBusyState === 'paused') {
    return {
      badge: '等待处理',
      importance: 'notice',
      text: '会话正在等待下一步处理，我会继续跟着状态变化。',
    };
  }

  if (snapshot.input.includes('/buddy')) {
    return {
      badge: '被点名',
      importance: 'active',
      text: '你刚刚叫到我了——我在，而且会尽量不喧宾夺主。',
    };
  }

  if (snapshot.input.trim().startsWith('/')) {
    return {
      badge: '命令模式',
      importance: 'ambient',
      text: '命令氛围已经起来了，我先把存在感调低一点。',
    };
  }

  if (snapshot.input.includes('@')) {
    return {
      badge: '文件引用',
      importance: 'ambient',
      text: '看到文件引用了，我会更贴近这轮上下文。',
    };
  }

  if (snapshot.todoCount > 0) {
    return {
      badge: '待办在前景',
      importance: 'ambient',
      text: `今天有 ${snapshot.todoCount} 条待办挂在前景，我保持轻声提醒。`,
    };
  }

  if (snapshot.rightOpen) {
    return {
      badge: '右侧已展开',
      importance: 'ambient',
      text: '右侧面板已经打开，我把注意力往中线收一点。',
    };
  }

  if (snapshot.input.trim().length > 84) {
    return {
      badge: '长输入',
      importance: 'ambient',
      text: '这条输入信息量很足，我会安静跟着，不额外加压。',
    };
  }

  const idleSeed = hashString(`${snapshot.currentUserEmail}:${snapshot.sessionId ?? 'home'}`);
  return {
    badge: '安静陪伴',
    importance: 'ambient',
    text: pickBySeed(IDLE_REACTIONS, idleSeed),
  };
}

export function deriveCompanionStatus(snapshot: CompanionActivitySnapshot): string {
  if (snapshot.streaming) {
    return '跟随当前生成';
  }
  if (snapshot.pendingPermissionCount > 0) {
    return '留意待确认动作';
  }
  if (snapshot.queuedCount > 0) {
    return '照看待发队列';
  }
  if (snapshot.attachedCount > 0) {
    return '贴近附件上下文';
  }
  if (snapshot.showVoice) {
    return '跟随语音输入';
  }
  if (snapshot.sessionBusyState === 'running') {
    return '低打扰跟随会话';
  }
  if (snapshot.sessionBusyState === 'paused') {
    return '等待会话恢复';
  }
  return '安静陪伴中';
}

export function deriveCompanionFocusTags(snapshot: CompanionActivitySnapshot): string[] {
  const tags = ['Web/Desktop'];

  if (snapshot.streaming) {
    tags.push('生成中');
  }
  if (snapshot.attachedCount > 0) {
    tags.push('附件');
  }
  if (snapshot.queuedCount > 0) {
    tags.push('队列');
  }
  if (snapshot.pendingPermissionCount > 0) {
    tags.push('权限');
  }
  if (snapshot.todoCount > 0) {
    tags.push('待办');
  }
  if (snapshot.showVoice) {
    tags.push('语音');
  }

  return tags;
}

export function buildCompanionIntroText(
  profile: Pick<CompanionProfile, 'name' | 'species'>,
): string {
  return `${profile.name} 会以一只${profile.species}的身份坐在输入框旁边轻声陪跑。除非你点名，不然我会把话让给主助手。`;
}
