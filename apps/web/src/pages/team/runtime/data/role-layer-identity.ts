/**
 * role-layer-identity · 团队角色层「展示身份」唯一事实源
 *
 * 背景：team 的对话/状态/图谱里到处都在把 roleLayer（reception/pm1/pm2/
 * executor/reviewer）映射成中文名 + 配色 + 字母代号，散落在 6+ 个文件里各写一份
 * （TeamSessionHeader / TeamSubstateProgressBar / TeamStatusBar / LayeredConversationView
 * / LayerConversationDrawer / build-knowledge-graph 等），措辞与配色互相不一致。
 *
 * 本模块把「一个角色层在 UI 上长什么样」收敛成单一来源：
 *   - label    完整中文名（如「执行层」）
 *   - short    紧凑名（如「执行」）
 *   - code     架构字母代号（b/c/d/e/g，对齐 L1 文档）
 *   - color    主配色（CSS 变量）
 *   - icon     emoji 图标（消息身份头 / 徽章用）
 *   - initials 头像圆点里的缩写（如「执」）
 *
 * 注意：团队运行时有两套 roleLayer 取值——
 *   - 权威 5 层（packages/shared TeamRuntimeLayer）：reception/pm1/pm2/executor/reviewer
 *   - 前端事件层（stores/team TeamRoleLayer）：额外含 user / tester
 * 本表覆盖两套的并集，未知值回退到「团队」中性身份。
 */

import { REFERENCE_AGENT_ROLE_METADATA, type CoreRole } from '@openAwork/shared';

export interface RoleLayerIdentity {
  /** 完整中文名，如「执行层」。 */
  label: string;
  /** 紧凑名，如「执行」。 */
  short: string;
  /** 架构字母代号（b/c/d/e/g）。reception=b、pm1=c、pm2=d、executor=e、reviewer=g。 */
  code: string | null;
  /** 主配色（CSS 变量）。 */
  color: string;
  /** emoji 图标。 */
  icon: string;
  /** 头像圆点缩写（1 个汉字）。 */
  initials: string;
}

const FALLBACK_IDENTITY: RoleLayerIdentity = {
  label: '团队',
  short: '团队',
  code: null,
  color: 'var(--fg-default)',
  icon: '🤖',
  initials: '队',
};

const USER_IDENTITY: RoleLayerIdentity = {
  label: '你',
  short: '你',
  code: null,
  color: 'var(--accent)',
  icon: '🧑',
  initials: '你',
};

const IDENTITY_BY_LAYER: Record<string, RoleLayerIdentity> = {
  user: USER_IDENTITY,
  reception: {
    label: '接待层',
    short: '接待',
    code: 'b',
    color: 'var(--accent)',
    icon: '🛎️',
    initials: '待',
  },
  pm1: {
    label: 'PM1 规划层',
    short: '规划',
    code: 'c',
    color: 'var(--chart-7)',
    icon: '🗺️',
    initials: '划',
  },
  pm2: {
    label: 'PM2 管控层',
    short: '管控',
    code: 'd',
    color: 'var(--chart-5)',
    icon: '🎛️',
    initials: '控',
  },
  executor: {
    label: '执行层',
    short: '执行',
    code: 'e',
    color: 'var(--success)',
    icon: '⚡',
    initials: '行',
  },
  // tester 在前端事件层存在，但权威 5 层把测试并入执行/评审；给一个独立身份兜底。
  tester: {
    label: '测试层',
    short: '测试',
    code: 'f',
    color: 'var(--aux)',
    icon: '🧪',
    initials: '测',
  },
  reviewer: {
    label: '评审层',
    short: '评审',
    code: 'g',
    color: 'var(--warning)',
    icon: '🔍',
    initials: '评',
  },
};

const ROLE_LAYER_BY_AGENT_ID: Record<string, keyof typeof IDENTITY_BY_LAYER> = {
  'interaction-agent': 'reception',
  interaction: 'reception',
  reception: 'reception',
  pm1: 'pm1',
  pm2: 'pm2',
  executor: 'executor',
  reviewer: 'reviewer',
  librarian: 'reception',
  metis: 'reception',
  oracle: 'reception',
  analyst: 'reception',
  architect: 'reception',
  debugger: 'reception',
  prometheus: 'pm1',
  cassandra: 'pm1',
  planner: 'pm1',
  plan: 'pm1',
  zeus: 'pm2',
  'team-leader': 'pm2',
  leader: 'pm2',
  hephaestus: 'executor',
  atlas: 'reviewer',
  momus: 'reviewer',
  critic: 'reviewer',
};

const CORE_ROLE_TO_LAYER: Partial<Record<CoreRole, keyof typeof IDENTITY_BY_LAYER>> = {
  leader: 'pm2',
  planner: 'pm1',
  researcher: 'reception',
  executor: 'executor',
  reviewer: 'reviewer',
};

const ROLE_LAYER_BY_BUILTIN_AGENT = Object.entries(REFERENCE_AGENT_ROLE_METADATA).reduce<
  Record<string, keyof typeof IDENTITY_BY_LAYER>
>((acc, [agentId, metadata]) => {
  const mappedLayer = CORE_ROLE_TO_LAYER[metadata.canonicalRole.coreRole];
  if (!mappedLayer) {
    return acc;
  }

  acc[agentId] = mappedLayer;
  for (const alias of metadata.aliases ?? []) {
    acc[alias] = mappedLayer;
  }
  return acc;
}, {});

/** 取某个 roleLayer 的展示身份；未知 / null 回退到中性「团队」身份。 */
export function getRoleLayerIdentity(roleLayer: string | null | undefined): RoleLayerIdentity {
  if (!roleLayer) return FALLBACK_IDENTITY;
  return IDENTITY_BY_LAYER[roleLayer] ?? FALLBACK_IDENTITY;
}

/** 优先按 agentId 反解到团队层级身份；找不到时回退到中性身份。 */
export function getRoleLayerIdentityFromAgentId(
  agentId: string | null | undefined,
): RoleLayerIdentity {
  if (!agentId) return FALLBACK_IDENTITY;
  const normalized = agentId.trim();
  if (!normalized) return FALLBACK_IDENTITY;
  const layer = ROLE_LAYER_BY_AGENT_ID[normalized] ?? ROLE_LAYER_BY_BUILTIN_AGENT[normalized];
  return layer ? (IDENTITY_BY_LAYER[layer] ?? FALLBACK_IDENTITY) : FALLBACK_IDENTITY;
}

/** 「代号 · 短名」一行展示，如「e · 执行」；无代号时只返回短名。 */
export function formatRoleLayerTag(roleLayer: string | null | undefined): string {
  const id = getRoleLayerIdentity(roleLayer);
  return id.code ? `${id.code} · ${id.short}` : id.short;
}
