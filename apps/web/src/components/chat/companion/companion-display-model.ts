import {
  createCompanionSpriteBones,
  createCompanionSpriteBonesForSpecies,
  spriteDisplayLabel,
  spriteRarityStars,
  type CompanionSpriteBones,
  type CompanionSpriteSpecies,
} from './companion-sprite-model.js';

export interface CompanionActivitySnapshot {
  attachedCount: number;
  currentUserEmail: string;
  hasStreamError: boolean;
  idleSeconds: number;
  input: string;
  lastToolName: string | null;
  pendingPermissionCount: number;
  queuedCount: number;
  rightOpen: boolean;
  sessionBusyState: 'running' | 'paused' | null;
  sessionId: string | null;
  showVoice: boolean;
  streamErrorMessage: string | null;
  streaming: boolean;
  todoCount: number;
  toolCallCount: number;
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
  spokenText?: string;
  text: string;
  tone: 'intro' | CompanionReaction['importance'] | 'chat';
}

export interface CompanionOutputPolicy {
  shouldShowLiveOutput: boolean;
  shouldSpeak: boolean;
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
    accentColor: 'color-mix(in oklch, var(--success) 82%, var(--fg-on-accent) 18%)',
    accentTint: 'color-mix(in oklch, var(--success) 14%, transparent)',
  },
  {
    accentColor: 'color-mix(in oklch, var(--warning) 82%, var(--fg-on-accent) 18%)',
    accentTint: 'color-mix(in oklch, var(--warning) 16%, transparent)',
  },
];
const IDLE_REACTIONS = [
  '我在旁边，不打断你。',
  '你看主线就好，节奏我帮你留一眼。',
  '有文件、队列或审批冒出来，我会轻轻提醒。',
  '我先在边上待命，需要时叫我一声就行。',
];
const IDLE_REMINDER_THRESHOLD_SECONDS = 180;

const HUBBY_NAMES = ['暖石', '锚点', '壁炉', '护城', '基石', '织网', '归港', '承托'];
const HUBBY_ARCHETYPES = [
  '团队守护者',
  '任务锚定员',
  '协作稳定器',
  '运行链护航员',
  '工作台守夜人',
  '团队粘合剂',
];
const HUBBY_NOTES = [
  '关注团队整体节奏，确保没有任务掉队。',
  '更偏向任务流和协作链的守护，而非单点提醒。',
  '在团队运行中提供稳定感，像锚一样托住节奏。',
  '擅长感知阻塞和卡点，比 Buddy 更主动地提醒风险。',
];
const HUBBY_TRAIT_SETS = [
  ['看任务', '看阻塞', '守护节奏'],
  ['看协作链', '看角色分工', '稳定输出'],
  ['看运行态', '看审批流', '主动提醒'],
  ['看团队健康', '看任务完成率', '风险预警'],
];
const HUBBY_PALETTES = [
  {
    accentColor: 'color-mix(in oklch, var(--warning) 82%, var(--fg-on-accent) 18%)',
    accentTint: 'color-mix(in oklch, var(--warning) 14%, transparent)',
  },
  {
    accentColor: 'color-mix(in oklch, var(--danger) 72%, var(--fg-on-accent) 28%)',
    accentTint: 'color-mix(in oklch, var(--danger) 12%, transparent)',
  },
  {
    accentColor: 'color-mix(in oklch, var(--accent) 72%, var(--warning) 28%)',
    accentTint: 'color-mix(in oklch, var(--accent) 10%, transparent)',
  },
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

function summarizeStreamError(message: string | null): string {
  const normalized = message?.trim();
  if (!normalized) {
    return '这轮请求遇到错误，我会先帮你稳住上下文，等恢复后继续跟进。';
  }
  return `${normalized.slice(0, 36)}${normalized.length > 36 ? '…' : ''}`;
}

function describeToolCall(snapshot: CompanionActivitySnapshot): string {
  const toolName = snapshot.lastToolName?.trim();
  if (!toolName) {
    return `${snapshot.toolCallCount} 个工具在跑，我看着就好。`;
  }
  return `${toolName} 在跑，我帮你盯一下。`;
}

function formatIdleMinutes(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60));
}

function describeToolForHuman(toolName: string | null | undefined): string | null {
  const normalized = toolName?.trim();
  if (!normalized) {
    return null;
  }

  const lower = normalized.toLowerCase();
  if (lower.includes('read') || lower.includes('file')) return '读文件';
  if (lower.includes('write') || lower.includes('edit')) return '改文件';
  if (lower.includes('bash') || lower.includes('shell') || lower.includes('command')) {
    return '跑命令';
  }
  if (lower.includes('search') || lower.includes('grep') || lower.includes('rg')) return '查东西';
  if (lower.includes('web') || lower.includes('browser')) return '看网页';
  if (lower.includes('test') || lower.includes('vitest')) return '跑测试';
  return normalized.replace(/[_-]+/g, ' ');
}

export function buildCompanionEventUtterance(input: {
  kind:
    | 'generationFinished'
    | 'permissionArrived'
    | 'toolStarted'
    | 'toolFinished'
    | 'streamError'
    | 'streamRecovered'
    | 'idleReminder';
  count?: number;
  lastToolName?: string | null;
  streamErrorMessage?: string | null;
}): CompanionUtteranceSeed {
  switch (input.kind) {
    case 'generationFinished':
      return {
        badge: '生成完成',
        spokenText: '写完了。你慢慢看，我在旁边。',
        text: '写完了。你不用马上接，我先把这轮稳稳放在这里。',
        tone: 'notice',
      };
    case 'permissionArrived': {
      const count = input.count ?? 1;
      return {
        badge: '新审批',
        spokenText: count === 1 ? '有一步需要你确认。' : `有 ${count} 步需要你确认。`,
        text:
          count === 1
            ? '有一步需要你确认。我先停住，不催你。'
            : `有 ${count} 步需要你确认。我先停住，不催你。`,
        tone: 'notice',
      };
    }
    case 'toolStarted': {
      const toolName = describeToolForHuman(input.lastToolName);
      const count = input.count ?? 1;
      return {
        badge: '工具启动',
        spokenText: toolName ? `它开始${toolName}了，我替你看着。` : '工具开始跑了，我替你看着。',
        text: toolName
          ? `它开始${toolName}了。我替你看着中间状态，你先不用分心。`
          : `${count} 个工具开始跑了。我替你看着中间状态，你先不用分心。`,
        tone: 'notice',
      };
    }
    case 'toolFinished':
      return {
        badge: '工具完成',
        spokenText: '跑完了，线索我收好了。',
        text: '跑完了，线索我收好了。你可以直接接着看结果。',
        tone: 'notice',
      };
    case 'streamError': {
      const errorText = summarizeStreamError(input.streamErrorMessage ?? null);
      return {
        badge: '错误提示',
        spokenText: '这轮卡住了。先别急，我在。',
        text: `${errorText} 这轮先卡住了。先别急，我帮你把上下文稳住，等你决定下一步。`,
        tone: 'notice',
      };
    }
    case 'streamRecovered':
      return {
        badge: '错误恢复',
        spokenText: '恢复了。我继续轻轻跟着。',
        text: '恢复了。我继续轻轻跟着，不打断你。',
        tone: 'notice',
      };
    case 'idleReminder':
      return {
        badge: '空闲提醒',
        spokenText: '你先歇着也行，我在。',
        text: '你先歇着也行。这轮我替你守着，回来还能接上，不会丢。',
        tone: 'ambient',
      };
    default:
      return {
        badge: '安静陪伴',
        text: '我在旁边，等你下一步。',
        tone: 'ambient',
      };
  }
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

export function createCompanionPreviewProfile(
  species: CompanionSpriteSpecies,
  seedInput: string,
): CompanionProfile {
  const normalizedSeed = `${seedInput.trim().toLowerCase() || 'guest'}:${species}:preview`;
  const seed = hashString(normalizedSeed);
  const palette = pickBySeed(COMPANION_PALETTES, seed, 1);
  const sprite = createCompanionSpriteBonesForSpecies(normalizedSeed, species);
  return {
    accentColor: palette.accentColor,
    accentTint: palette.accentTint,
    archetype: pickBySeed(COMPANION_ARCHETYPES, seed, 2),
    glyph: pickBySeed(COMPANION_GLYPHS, seed, 4),
    name: pickBySeed(COMPANION_NAMES, seed),
    note: pickBySeed(COMPANION_NOTES, seed, 5),
    rarityStars: spriteRarityStars(sprite.rarity),
    species: spriteDisplayLabel(sprite.species),
    sprite,
    traits: [...pickBySeed(COMPANION_TRAIT_SETS, seed, 3)],
  };
}

export function createHubbyProfile(seedInput: string): CompanionProfile {
  const normalizedSeed = `hubby:${seedInput.trim().toLowerCase() || 'default'}`;
  const seed = hashString(normalizedSeed);
  const palette = pickBySeed(HUBBY_PALETTES, seed, 1);
  const sprite = createCompanionSpriteBones(normalizedSeed);
  return {
    accentColor: palette.accentColor,
    accentTint: palette.accentTint,
    archetype: pickBySeed(HUBBY_ARCHETYPES, seed, 2),
    glyph: pickBySeed(COMPANION_GLYPHS, seed, 6),
    name: pickBySeed(HUBBY_NAMES, seed),
    note: pickBySeed(HUBBY_NOTES, seed, 3),
    rarityStars: spriteRarityStars(sprite.rarity),
    species: spriteDisplayLabel(sprite.species),
    sprite,
    traits: [...pickBySeed(HUBBY_TRAIT_SETS, seed, 2)],
  };
}

export function deriveCompanionReaction(snapshot: CompanionActivitySnapshot): CompanionReaction {
  if (snapshot.hasStreamError) {
    return {
      badge: '错误恢复',
      importance: 'notice',
      text: `${summarizeStreamError(snapshot.streamErrorMessage)} 先别急，我在这儿。`,
    };
  }

  if (snapshot.toolCallCount > 0) {
    return {
      badge: '工具执行中',
      importance: 'active',
      text: describeToolCall(snapshot),
    };
  }

  if (snapshot.streaming) {
    return {
      badge: '跟随生成',
      importance: 'active',
      text: '正在写，我先安静跟着。',
    };
  }

  if (snapshot.pendingPermissionCount > 0) {
    return {
      badge: '待确认',
      importance: 'notice',
      text: `${snapshot.pendingPermissionCount} 项要你点头，我先标着。`,
    };
  }

  if (snapshot.queuedCount > 0) {
    return {
      badge: '待发队列',
      importance: 'notice',
      text: `${snapshot.queuedCount} 条在队列里，我帮你看着节奏。`,
    };
  }

  if (snapshot.attachedCount > 0) {
    return {
      badge: '附件在场',
      importance: 'active',
      text: '附件我看到了，这轮会贴着上下文。',
    };
  }

  if (snapshot.showVoice) {
    return {
      badge: '语音输入',
      importance: 'active',
      text: '你说，我听着。需要时我只回短句。',
    };
  }

  if (snapshot.sessionBusyState === 'running') {
    return {
      badge: '会话运行中',
      importance: 'notice',
      text: '这轮还在跑，我先不插话。',
    };
  }

  if (snapshot.sessionBusyState === 'paused') {
    return {
      badge: '等待处理',
      importance: 'notice',
      text: '它在等你一步，我先陪着。',
    };
  }

  if (snapshot.input.includes('/buddy')) {
    return {
      badge: '被点名',
      importance: 'active',
      text: '我在。你继续，我轻声跟着。',
    };
  }

  if (snapshot.input.trim().startsWith('/')) {
    return {
      badge: '命令模式',
      importance: 'ambient',
      text: '看到命令了，我先退半步。',
    };
  }

  if (snapshot.input.includes('@')) {
    return {
      badge: '文件引用',
      importance: 'ambient',
      text: '文件我看到了，会贴着这轮上下文。',
    };
  }

  if (snapshot.todoCount > 0) {
    return {
      badge: '待办在前景',
      importance: 'ambient',
      text: `${snapshot.todoCount} 条待办在前面，我轻轻提醒就好。`,
    };
  }

  if (snapshot.rightOpen) {
    return {
      badge: '右侧已展开',
      importance: 'ambient',
      text: '右侧打开了，我把话收一点。',
    };
  }

  if (snapshot.input.trim().length > 84) {
    return {
      badge: '长输入',
      importance: 'ambient',
      text: '这段信息不少，我安静跟着。',
    };
  }

  if (snapshot.idleSeconds >= IDLE_REMINDER_THRESHOLD_SECONDS) {
    return {
      badge: '空闲提醒',
      importance: 'ambient',
      text: `停了约 ${formatIdleMinutes(snapshot.idleSeconds)} 分钟，没事，我把这轮先守着。`,
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
  if (snapshot.hasStreamError) {
    return '等待错误恢复';
  }
  if (snapshot.toolCallCount > 0) {
    return '跟随工具执行';
  }
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
  if (snapshot.idleSeconds >= IDLE_REMINDER_THRESHOLD_SECONDS) {
    return '等待下一步输入';
  }
  return '安静陪伴中';
}

export function deriveCompanionFocusTags(snapshot: CompanionActivitySnapshot): string[] {
  const tags = ['Web/Desktop'];

  if (snapshot.hasStreamError) {
    tags.push('错误');
  }
  if (snapshot.toolCallCount > 0) {
    tags.push('工具');
  }
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
  if (snapshot.idleSeconds >= IDLE_REMINDER_THRESHOLD_SECONDS) {
    tags.push('空闲');
  }

  return tags;
}

export function buildCompanionIntroText(
  profile: Pick<CompanionProfile, 'name' | 'species'>,
): string {
  return `${profile.name} 会以一只${profile.species}的身份坐在输入框旁边轻声陪跑。除非你点名，不然我会把话让给主助手。`;
}

export function deriveCompanionOutputPolicy(
  output: CompanionUtteranceSeed,
  options: { muted: boolean; quietMode: boolean },
): CompanionOutputPolicy {
  if (options.muted) {
    return {
      shouldShowLiveOutput: false,
      shouldSpeak: false,
    };
  }

  if (output.tone === 'intro') {
    return {
      shouldShowLiveOutput: true,
      shouldSpeak: false,
    };
  }

  if (output.tone === 'ambient') {
    return {
      shouldShowLiveOutput: !options.quietMode,
      shouldSpeak: false,
    };
  }

  if (output.tone === 'notice') {
    return {
      shouldShowLiveOutput: true,
      shouldSpeak: !options.quietMode,
    };
  }

  return {
    shouldShowLiveOutput: true,
    shouldSpeak: true,
  };
}
