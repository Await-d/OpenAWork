import { randomUUID } from 'node:crypto';
import { getProviderDisplayName } from '@openAwork/agent-core';
import {
  DEFAULT_FIXED_TEAM_MEMBER_SLOTS,
  type FixedTeamMemberSlot,
  type TeamRuntimeLayer,
} from '@openAwork/shared';
import { sqliteAll, sqliteRun } from '../infra/db.js';
import {
  findMissingTeamTemplateDefaultBindingRoles,
  type TeamTemplateDefaultBindings,
  type TeamTemplateRole,
} from '../team/team-template-metadata.js';

interface UserRow {
  id: string;
}

interface WorkflowTemplateRow {
  id: string;
  metadata_json: string;
}

interface WorkflowNode {
  id: string;
  label: string;
  type: 'start' | 'end' | 'prompt' | 'tool' | 'condition' | 'subagent';
  x?: number;
  y?: number;
}

interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
}

interface DefaultWorkflowTemplateSeed {
  category: 'team-playbook';
  description: string;
  edges: WorkflowEdge[];
  metadata: {
    origin: 'seed';
    seedKey: string;
    teamTemplate: {
      defaultBindings: TeamTemplateDefaultBindings;
      defaultProvider: string | null;
      memberSlots: FixedTeamMemberSlot[];
      optionalAgentIds: string[];
      recommendedDefault?: boolean;
      requiredRoles: TeamTemplateRole[];
      recommendedFor?: string;
      templateFocus?: string;
      templatePriority?: number;
      templateScale?: 'full' | 'large' | 'medium' | 'small';
    };
    templateKind: 'default-dev';
  };
  name: string;
  nodes: WorkflowNode[];
  seedKey: string;
}

const ROLE_LABEL_MAP: Record<TeamTemplateRole, string> = {
  leader: '团队领导',
  planner: '团队负责人',
  researcher: '研究员',
  executor: '执行者',
  reviewer: '批评者',
};

const PROVIDER_LABEL_MAP: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gemini: 'Gemini',
  deepseek: 'DeepSeek',
  ollama: 'Ollama',
  openrouter: 'OpenRouter',
  qwen: 'Qwen',
  moonshot: 'Moonshot',
};

/** 平台显示名：优先 catalog(随新增平台自动可用)，回退到本地短名表。 */
function providerLabel(providerId: string): string {
  return getProviderDisplayName(providerId) ?? PROVIDER_LABEL_MAP[providerId] ?? providerId;
}

function buildSeedTemplateNodes(
  requiredRoles: TeamTemplateRole[],
  defaultBindings: TeamTemplateDefaultBindings,
): WorkflowNode[] {
  const nodes: WorkflowNode[] = [{ id: 'node-start', label: '开始', type: 'start', x: 40, y: 120 }];

  requiredRoles.forEach((role, index) => {
    const roleLabel = ROLE_LABEL_MAP[role] ?? role;
    const binding = defaultBindings[role];
    const bindingProviderLabel = binding?.providerId ? providerLabel(binding.providerId) : null;
    const modelSuffix = bindingProviderLabel ? ` · ${bindingProviderLabel}` : '';
    nodes.push({
      id: `node-role-${index + 1}`,
      label: `${roleLabel}${modelSuffix}`,
      type: 'subagent',
      x: 220 + index * 180,
      y: 120 + (index % 2 === 0 ? 0 : 96),
    });
  });

  nodes.push({
    id: 'node-end',
    label: '结束',
    type: 'end',
    x: 220 + requiredRoles.length * 180,
    y: 120,
  });

  return nodes;
}

function buildSeedTemplateEdges(requiredRoles: TeamTemplateRole[]): WorkflowEdge[] {
  const nodeIds = [
    'node-start',
    ...requiredRoles.map((_, index) => `node-role-${index + 1}`),
    'node-end',
  ];

  return nodeIds.slice(0, -1).map((source, index) => ({
    id: `edge-${source}-${nodeIds[index + 1]}`,
    source,
    target: nodeIds[index + 1]!,
  }));
}

function assertCompleteDefaultBindings(template: DefaultWorkflowTemplateSeed): void {
  const missingRoles = findMissingTeamTemplateDefaultBindingRoles(
    template.metadata.teamTemplate.defaultBindings,
  );
  if (missingRoles.length > 0) {
    throw new Error(
      `Default workflow template '${template.seedKey}' is missing bindings for ${missingRoles.join(', ')}`,
    );
  }
}

const PURE_OPENAI_BINDINGS: TeamTemplateDefaultBindings = {
  leader: { agentId: 'zeus', providerId: 'openai', modelId: 'gpt-5.4', variant: 'xhigh' },
  planner: { agentId: 'prometheus', providerId: 'openai', modelId: 'gpt-5.4', variant: 'xhigh' },
  researcher: { agentId: 'librarian', providerId: 'openai', modelId: 'gpt-5.4', variant: 'medium' },
  executor: { agentId: 'hephaestus', providerId: 'openai', modelId: 'gpt-5.4', variant: 'high' },
  reviewer: { agentId: 'momus', providerId: 'openai', modelId: 'gpt-5.4', variant: 'medium' },
};

const PURE_ANTHROPIC_BINDINGS: TeamTemplateDefaultBindings = {
  leader: {
    agentId: 'zeus',
    providerId: 'anthropic',
    modelId: 'claude-opus-4-6',
    variant: 'xhigh',
  },
  planner: {
    agentId: 'prometheus',
    providerId: 'anthropic',
    modelId: 'claude-opus-4-6',
    variant: 'xhigh',
  },
  researcher: {
    agentId: 'librarian',
    providerId: 'anthropic',
    modelId: 'claude-haiku-4-5',
    variant: 'medium',
  },
  executor: {
    agentId: 'hephaestus',
    providerId: 'anthropic',
    modelId: 'claude-sonnet-4-6',
    variant: 'high',
  },
  reviewer: {
    agentId: 'momus',
    providerId: 'anthropic',
    modelId: 'claude-opus-4-6',
    variant: 'high',
  },
};

const MIXED_BINDINGS: TeamTemplateDefaultBindings = {
  leader: { agentId: 'zeus', providerId: 'openai', modelId: 'gpt-5.4', variant: 'high' },
  planner: {
    agentId: 'prometheus',
    providerId: 'anthropic',
    modelId: 'claude-opus-4-6',
    variant: 'xhigh',
  },
  researcher: {
    agentId: 'librarian',
    providerId: 'anthropic',
    modelId: 'claude-haiku-4-5',
    variant: 'medium',
  },
  executor: { agentId: 'hephaestus', providerId: 'openai', modelId: 'gpt-5.4', variant: 'high' },
  reviewer: { agentId: 'momus', providerId: 'openai', modelId: 'gpt-5.4', variant: 'medium' },
};

const REQUIRED_ROLES: TeamTemplateRole[] = [
  'leader',
  'planner',
  'researcher',
  'executor',
  'reviewer',
];

/* ── 每层模型映射 ────────────────────────────────────────────────────────
 * 种子模板的 memberSlots 需要把模型「盖」到每个成员上，运行时（含 reception/
 * pm1/pm2 辅助层的模型绑定）即可生效。下面每套映射对应一种供应商组合策略：
 * 纯单一供应商、双供应商混合、三渠道混合、国产渠道、推理模型主导等。
 *
 * variant（推理强度）仅对 OpenAI / Anthropic 等支持 reasoning effort 的供应商
 * 有意义；Gemini / DeepSeek / Qwen / Kimi 等渠道留空即可，运行时按模型自身默认。
 */
interface LayerModelBinding {
  providerId: string;
  modelId: string;
  variant?: string;
}
type LayerModelMap = Record<TeamRuntimeLayer, LayerModelBinding>;

const MIXED_LAYER_MODELS: LayerModelMap = {
  reception: { providerId: 'openai', modelId: 'gpt-5.4', variant: 'medium' },
  pm1: { providerId: 'anthropic', modelId: 'claude-opus-4-6', variant: 'xhigh' },
  pm2: { providerId: 'openai', modelId: 'gpt-5.4', variant: 'high' },
  executor: { providerId: 'openai', modelId: 'gpt-5.4', variant: 'high' },
  reviewer: { providerId: 'anthropic', modelId: 'claude-opus-4-6', variant: 'high' },
};

const PURE_ANTHROPIC_LAYER_MODELS: LayerModelMap = {
  reception: { providerId: 'anthropic', modelId: 'claude-haiku-4-5', variant: 'medium' },
  pm1: { providerId: 'anthropic', modelId: 'claude-opus-4-6', variant: 'xhigh' },
  pm2: { providerId: 'anthropic', modelId: 'claude-opus-4-6', variant: 'high' },
  executor: { providerId: 'anthropic', modelId: 'claude-sonnet-4-6', variant: 'high' },
  reviewer: { providerId: 'anthropic', modelId: 'claude-opus-4-6', variant: 'high' },
};

const PURE_OPENAI_LAYER_MODELS: LayerModelMap = {
  reception: { providerId: 'openai', modelId: 'gpt-5.4', variant: 'medium' },
  pm1: { providerId: 'openai', modelId: 'gpt-5.4', variant: 'xhigh' },
  pm2: { providerId: 'openai', modelId: 'gpt-5.4', variant: 'high' },
  executor: { providerId: 'openai', modelId: 'gpt-5.4', variant: 'high' },
  reviewer: { providerId: 'openai', modelId: 'gpt-5.4', variant: 'medium' },
};

/**
 * 三渠道混合：接待用 Gemini Flash（快/省）做意图路由，规划用 Claude Opus 深思，
 * 管控/执行用 GPT 快速推进，评审用 Claude Opus 严格把关。覆盖「速度+深度+成本」三角。
 */
const TRI_PROVIDER_LAYER_MODELS: LayerModelMap = {
  reception: { providerId: 'gemini', modelId: 'gemini-2.5-flash' },
  pm1: { providerId: 'anthropic', modelId: 'claude-opus-4-6', variant: 'xhigh' },
  pm2: { providerId: 'openai', modelId: 'gpt-5.4', variant: 'high' },
  executor: { providerId: 'openai', modelId: 'gpt-5.4', variant: 'high' },
  reviewer: { providerId: 'anthropic', modelId: 'claude-opus-4-6', variant: 'high' },
};

/**
 * 经济高效：全部使用高性价比渠道。接待用 Qwen Turbo，规划/评审用 DeepSeek Reasoner
 * （强推理、低价），管控用 DeepSeek Chat，执行用 Qwen Plus。适合预算敏感的常规开发。
 */
const BUDGET_LAYER_MODELS: LayerModelMap = {
  reception: { providerId: 'qwen', modelId: 'qwen-turbo' },
  pm1: { providerId: 'deepseek', modelId: 'deepseek-reasoner' },
  pm2: { providerId: 'deepseek', modelId: 'deepseek-chat' },
  executor: { providerId: 'qwen', modelId: 'qwen-plus' },
  reviewer: { providerId: 'deepseek', modelId: 'deepseek-reasoner' },
};

/**
 * 国产渠道团队：DeepSeek + Qwen + Kimi 混合。接待 Kimi Turbo，规划 DeepSeek Reasoner，
 * 管控 Qwen Max，执行 Kimi K2.5，评审 DeepSeek Reasoner。数据合规/国产化优先场景。
 */
const DOMESTIC_LAYER_MODELS: LayerModelMap = {
  reception: { providerId: 'moonshot', modelId: 'kimi-k2-turbo-preview' },
  pm1: { providerId: 'deepseek', modelId: 'deepseek-reasoner' },
  pm2: { providerId: 'qwen', modelId: 'qwen-max' },
  executor: { providerId: 'moonshot', modelId: 'kimi-k2.5' },
  reviewer: { providerId: 'deepseek', modelId: 'deepseek-reasoner' },
};

/**
 * 深度推理主导：规划/管控/评审都用顶级推理模型（Claude Opus xhigh + DeepSeek Reasoner +
 * Kimi Thinking），执行层用 GPT 兼顾速度。适合架构权衡多、需要严密论证的复杂任务。
 */
const REASONING_LAYER_MODELS: LayerModelMap = {
  reception: { providerId: 'openai', modelId: 'gpt-5.4', variant: 'medium' },
  pm1: { providerId: 'anthropic', modelId: 'claude-opus-4-6', variant: 'xhigh' },
  pm2: { providerId: 'deepseek', modelId: 'deepseek-reasoner' },
  executor: { providerId: 'openai', modelId: 'gpt-5.4', variant: 'high' },
  reviewer: { providerId: 'moonshot', modelId: 'kimi-k2-thinking' },
};

/**
 * 极速原型：全部轻量快速模型，最低延迟最快出活。接待/规划 Gemini Flash，管控/执行 GPT，
 * 评审 Claude Haiku。适合 demo、脚本、一次性小工具等「快糙猛」场景。
 */
const RAPID_LAYER_MODELS: LayerModelMap = {
  reception: { providerId: 'gemini', modelId: 'gemini-2.5-flash-lite' },
  pm1: { providerId: 'gemini', modelId: 'gemini-2.5-flash' },
  pm2: { providerId: 'openai', modelId: 'gpt-5.4', variant: 'low' },
  executor: { providerId: 'openai', modelId: 'gpt-5.4', variant: 'medium' },
  reviewer: { providerId: 'anthropic', modelId: 'claude-haiku-4-5' },
};

/* ── 规模 → 成员集合 ──────────────────────────────────────────────────────
 * 与前端 template-roster-state.ts 的 SCALE_PRESETS 保持一致，使内置模板的
 * roster 在「规模」维度上真正分化（小 6 人 / 中 8 人 / 大 14 人 / 全 21 人），
 * 而不是全部回退到完整花名册。键格式为 `${layer}:${specialty}`。
 */
type SeedScale = 'full' | 'large' | 'medium' | 'small';

const SCALE_MEMBER_KEYS: Record<SeedScale, string[]> = {
  small: [
    'reception:intake',
    'pm1:task-planning',
    'pm2:dispatch',
    'executor:frontend',
    'executor:backend',
    'reviewer:code-review',
  ],
  medium: [
    'reception:intake',
    'pm1:product-planning',
    'pm1:task-planning',
    'pm2:tech-lead',
    'pm2:dispatch',
    'executor:frontend',
    'executor:backend',
    'reviewer:code-review',
  ],
  large: [
    'reception:intake',
    'pm1:product-planning',
    'pm1:task-planning',
    'pm2:tech-lead',
    'pm2:dispatch',
    'pm2:release',
    'executor:frontend',
    'executor:backend',
    'executor:data',
    'executor:qa',
    'executor:devops',
    'reviewer:code-review',
    'reviewer:security',
    'reviewer:sre',
  ],
  full: DEFAULT_FIXED_TEAM_MEMBER_SLOTS.map((slot) => `${slot.layer}:${slot.specialty}`),
};

const CATALOG_BY_KEY = new Map<string, FixedTeamMemberSlot>(
  DEFAULT_FIXED_TEAM_MEMBER_SLOTS.map((slot) => [`${slot.layer}:${slot.specialty}`, slot]),
);

/** 按规模挑选成员，并把对应层的模型绑定盖到每个成员槽位上。 */
function buildSeedMemberSlots(scale: SeedScale, layerModels: LayerModelMap): FixedTeamMemberSlot[] {
  return SCALE_MEMBER_KEYS[scale]
    .map((key) => CATALOG_BY_KEY.get(key))
    .filter((slot): slot is FixedTeamMemberSlot => slot !== undefined)
    .map((slot) => {
      const model = layerModels[slot.layer];
      return {
        ...slot,
        toolsets: [...slot.toolsets],
        providerId: model.providerId,
        modelId: model.modelId,
        ...(model.variant ? { variant: model.variant } : {}),
      };
    });
}

/**
 * 把每层模型映射转换成 defaultBindings（核心 5 角色）。新增的多渠道模板用它
 * 自动派生 defaultBindings，避免每个模板手写一份；core role 与 layer 的对应：
 *   leader→pm2 · planner→pm1 · researcher→reception · executor→executor · reviewer→reviewer
 */
const CORE_ROLE_TO_LAYER: Record<TeamTemplateRole, TeamRuntimeLayer> = {
  leader: 'pm2',
  planner: 'pm1',
  researcher: 'reception',
  executor: 'executor',
  reviewer: 'reviewer',
};

function bindingsFromLayerModels(layerModels: LayerModelMap): TeamTemplateDefaultBindings {
  const agentByRole: Record<TeamTemplateRole, string> = {
    leader: 'zeus',
    planner: 'prometheus',
    researcher: 'librarian',
    executor: 'hephaestus',
    reviewer: 'momus',
  };
  const result = {} as TeamTemplateDefaultBindings;
  for (const role of REQUIRED_ROLES) {
    const model = layerModels[CORE_ROLE_TO_LAYER[role]];
    result[role] = {
      agentId: agentByRole[role],
      providerId: model.providerId,
      modelId: model.modelId,
      ...(model.variant ? { variant: model.variant } : {}),
    };
  }
  return result;
}

export const DEFAULT_WORKFLOW_TEMPLATE_SEEDS: DefaultWorkflowTemplateSeed[] = [
  {
    seedKey: 'dev-team-full',
    name: '完整开发团队（OpenAI + Anthropic 混合）',
    description:
      '适合复杂功能开发、方案设计、实现与严格评审的完整开发闭环。规划与调研用 Claude 深度思考，领导与执行用 GPT 快速推进。',
    category: 'team-playbook',
    metadata: {
      origin: 'seed',
      seedKey: 'dev-team-full',
      templateKind: 'default-dev',
      teamTemplate: {
        defaultProvider: 'openai',
        defaultBindings: MIXED_BINDINGS,
        memberSlots: buildSeedMemberSlots('full', MIXED_LAYER_MODELS),
        optionalAgentIds: ['atlas', 'metis', 'sisyphus-junior'],
        recommendedDefault: false,
        requiredRoles: REQUIRED_ROLES,
        recommendedFor: '复杂跨模块需求、需要完整交付闭环的开发任务',
        templateFocus: '全流程交付 · 混合供应商',
        templatePriority: 2,
        templateScale: 'full',
      },
    },
    nodes: buildSeedTemplateNodes(REQUIRED_ROLES, MIXED_BINDINGS),
    edges: buildSeedTemplateEdges(REQUIRED_ROLES),
  },
  {
    seedKey: 'dev-team-large',
    name: '大型开发团队（纯 Anthropic）',
    description:
      '适合复杂需求拆解与多阶段交付，强调分析、执行与质量审阅。全部角色使用 Claude 系列。',
    category: 'team-playbook',
    metadata: {
      origin: 'seed',
      seedKey: 'dev-team-large',
      templateKind: 'default-dev',
      teamTemplate: {
        defaultProvider: 'anthropic',
        defaultBindings: PURE_ANTHROPIC_BINDINGS,
        memberSlots: buildSeedMemberSlots('large', PURE_ANTHROPIC_LAYER_MODELS),
        optionalAgentIds: ['atlas', 'metis'],
        recommendedDefault: false,
        requiredRoles: REQUIRED_ROLES,
        recommendedFor: '复杂功能开发、多阶段交付推进与里程碑管理',
        templateFocus: '复杂交付推进 · 纯 Claude',
        templatePriority: 4,
        templateScale: 'large',
      },
    },
    nodes: buildSeedTemplateNodes(REQUIRED_ROLES, PURE_ANTHROPIC_BINDINGS),
    edges: buildSeedTemplateEdges(REQUIRED_ROLES),
  },
  {
    seedKey: 'dev-team-medium',
    name: '中型开发团队（纯 OpenAI）',
    description: '适合常规功能开发、缺陷修复和中等范围重构。全部角色使用 GPT 系列。',
    category: 'team-playbook',
    metadata: {
      origin: 'seed',
      seedKey: 'dev-team-medium',
      templateKind: 'default-dev',
      teamTemplate: {
        defaultProvider: 'openai',
        defaultBindings: PURE_OPENAI_BINDINGS,
        memberSlots: buildSeedMemberSlots('medium', PURE_OPENAI_LAYER_MODELS),
        optionalAgentIds: ['atlas'],
        recommendedDefault: true,
        requiredRoles: REQUIRED_ROLES,
        recommendedFor: '常规功能开发、缺陷修复与中等范围重构',
        templateFocus: '日常功能开发 · 纯 GPT',
        templatePriority: 1,
        templateScale: 'medium',
      },
    },
    nodes: buildSeedTemplateNodes(REQUIRED_ROLES, PURE_OPENAI_BINDINGS),
    edges: buildSeedTemplateEdges(REQUIRED_ROLES),
  },
  {
    seedKey: 'dev-team-small',
    name: '小型开发团队（OpenAI + Anthropic 混合）',
    description: '适合小需求、明确任务和快速交付的轻量开发模板。规划用 Claude，执行用 GPT。',
    category: 'team-playbook',
    metadata: {
      origin: 'seed',
      seedKey: 'dev-team-small',
      templateKind: 'default-dev',
      teamTemplate: {
        defaultProvider: 'anthropic',
        defaultBindings: MIXED_BINDINGS,
        memberSlots: buildSeedMemberSlots('small', MIXED_LAYER_MODELS),
        optionalAgentIds: [],
        recommendedDefault: false,
        requiredRoles: REQUIRED_ROLES,
        recommendedFor: '小需求、快速迭代与明确任务的直接落地',
        templateFocus: '快速小步迭代 · 混合供应商',
        templatePriority: 3,
        templateScale: 'small',
      },
    },
    nodes: buildSeedTemplateNodes(REQUIRED_ROLES, MIXED_BINDINGS),
    edges: buildSeedTemplateEdges(REQUIRED_ROLES),
  },
  {
    seedKey: 'dev-team-tri-provider',
    name: '三渠道协同团队（Gemini + Claude + GPT）',
    description:
      '接待用 Gemini Flash 快速路由，规划与评审用 Claude Opus 深度思考，管控与执行用 GPT 高效推进。兼顾速度、深度与成本的全能配置。',
    category: 'team-playbook',
    metadata: {
      origin: 'seed',
      seedKey: 'dev-team-tri-provider',
      templateKind: 'default-dev',
      teamTemplate: {
        defaultProvider: 'openai',
        defaultBindings: bindingsFromLayerModels(TRI_PROVIDER_LAYER_MODELS),
        memberSlots: buildSeedMemberSlots('large', TRI_PROVIDER_LAYER_MODELS),
        optionalAgentIds: ['atlas', 'metis'],
        recommendedDefault: false,
        requiredRoles: REQUIRED_ROLES,
        recommendedFor: '希望各层用最合适渠道、追求速度/深度/成本平衡的团队',
        templateFocus: '三渠道协同 · Gemini+Claude+GPT',
        templatePriority: 5,
        templateScale: 'large',
      },
    },
    nodes: buildSeedTemplateNodes(REQUIRED_ROLES, bindingsFromLayerModels(TRI_PROVIDER_LAYER_MODELS)),
    edges: buildSeedTemplateEdges(REQUIRED_ROLES),
  },
  {
    seedKey: 'dev-team-budget',
    name: '经济高效团队（DeepSeek + Qwen 混合）',
    description:
      '全部采用高性价比渠道：规划与评审用 DeepSeek Reasoner 强推理，执行用 Qwen，接待用 Qwen Turbo。预算敏感场景下的常规开发首选。',
    category: 'team-playbook',
    metadata: {
      origin: 'seed',
      seedKey: 'dev-team-budget',
      templateKind: 'default-dev',
      teamTemplate: {
        defaultProvider: 'deepseek',
        defaultBindings: bindingsFromLayerModels(BUDGET_LAYER_MODELS),
        memberSlots: buildSeedMemberSlots('medium', BUDGET_LAYER_MODELS),
        optionalAgentIds: ['atlas'],
        recommendedDefault: false,
        requiredRoles: REQUIRED_ROLES,
        recommendedFor: '预算敏感、追求性价比的常规功能开发与迭代',
        templateFocus: '高性价比 · DeepSeek+Qwen',
        templatePriority: 6,
        templateScale: 'medium',
      },
    },
    nodes: buildSeedTemplateNodes(REQUIRED_ROLES, bindingsFromLayerModels(BUDGET_LAYER_MODELS)),
    edges: buildSeedTemplateEdges(REQUIRED_ROLES),
  },
  {
    seedKey: 'dev-team-domestic',
    name: '国产渠道团队（DeepSeek + Qwen + Kimi）',
    description:
      '全部使用国产大模型渠道：接待 Kimi，规划与评审 DeepSeek Reasoner，管控 Qwen Max，执行 Kimi K2.5。数据合规与国产化优先场景。',
    category: 'team-playbook',
    metadata: {
      origin: 'seed',
      seedKey: 'dev-team-domestic',
      templateKind: 'default-dev',
      teamTemplate: {
        defaultProvider: 'deepseek',
        defaultBindings: bindingsFromLayerModels(DOMESTIC_LAYER_MODELS),
        memberSlots: buildSeedMemberSlots('large', DOMESTIC_LAYER_MODELS),
        optionalAgentIds: ['atlas', 'metis'],
        recommendedDefault: false,
        requiredRoles: REQUIRED_ROLES,
        recommendedFor: '数据合规、国产化优先与多阶段复杂交付',
        templateFocus: '国产渠道 · DeepSeek+Qwen+Kimi',
        templatePriority: 7,
        templateScale: 'large',
      },
    },
    nodes: buildSeedTemplateNodes(REQUIRED_ROLES, bindingsFromLayerModels(DOMESTIC_LAYER_MODELS)),
    edges: buildSeedTemplateEdges(REQUIRED_ROLES),
  },
  {
    seedKey: 'dev-team-reasoning',
    name: '深度推理团队（顶级推理模型主导）',
    description:
      '规划/管控/评审全部用顶级推理模型（Claude Opus 超高强度 + DeepSeek Reasoner + Kimi Thinking），执行层用 GPT 兼顾速度。适合架构权衡多、需严密论证的复杂任务。',
    category: 'team-playbook',
    metadata: {
      origin: 'seed',
      seedKey: 'dev-team-reasoning',
      templateKind: 'default-dev',
      teamTemplate: {
        defaultProvider: 'anthropic',
        defaultBindings: bindingsFromLayerModels(REASONING_LAYER_MODELS),
        memberSlots: buildSeedMemberSlots('full', REASONING_LAYER_MODELS),
        optionalAgentIds: ['atlas', 'metis', 'sisyphus-junior'],
        recommendedDefault: false,
        requiredRoles: REQUIRED_ROLES,
        recommendedFor: '复杂架构决策、算法设计与需要严密论证的高难任务',
        templateFocus: '深度推理 · 多渠道推理模型',
        templatePriority: 8,
        templateScale: 'full',
      },
    },
    nodes: buildSeedTemplateNodes(REQUIRED_ROLES, bindingsFromLayerModels(REASONING_LAYER_MODELS)),
    edges: buildSeedTemplateEdges(REQUIRED_ROLES),
  },
  {
    seedKey: 'dev-team-rapid',
    name: '极速原型团队（轻量快速模型）',
    description:
      '全部使用轻量快速模型，最低延迟最快出活：接待/规划 Gemini Flash，管控/执行 GPT，评审 Claude Haiku。适合 demo、脚本与一次性小工具。',
    category: 'team-playbook',
    metadata: {
      origin: 'seed',
      seedKey: 'dev-team-rapid',
      templateKind: 'default-dev',
      teamTemplate: {
        defaultProvider: 'gemini',
        defaultBindings: bindingsFromLayerModels(RAPID_LAYER_MODELS),
        memberSlots: buildSeedMemberSlots('small', RAPID_LAYER_MODELS),
        optionalAgentIds: [],
        recommendedDefault: false,
        requiredRoles: REQUIRED_ROLES,
        recommendedFor: 'demo、脚本、一次性小工具等追求最快出活的场景',
        templateFocus: '极速原型 · 轻量快速模型',
        templatePriority: 9,
        templateScale: 'small',
      },
    },
    nodes: buildSeedTemplateNodes(REQUIRED_ROLES, bindingsFromLayerModels(RAPID_LAYER_MODELS)),
    edges: buildSeedTemplateEdges(REQUIRED_ROLES),
  },
];

for (const template of DEFAULT_WORKFLOW_TEMPLATE_SEEDS) {
  assertCompleteDefaultBindings(template);
}

function parseSeedKey(metadataJson: string): string | null {
  try {
    const parsed = JSON.parse(metadataJson) as { seedKey?: unknown };
    return typeof parsed.seedKey === 'string' ? parsed.seedKey : null;
  } catch {
    return null;
  }
}

export function ensureDefaultWorkflowTemplates(userId: string): void {
  const existingRows = sqliteAll<WorkflowTemplateRow>(
    'SELECT id, metadata_json FROM workflow_templates WHERE user_id = ?',
    [userId],
  );

  const existingBySeedKey = new Map<string, string>();
  for (const row of existingRows) {
    const seedKey = parseSeedKey(row.metadata_json);
    if (seedKey) {
      existingBySeedKey.set(seedKey, row.id);
    }
  }

  for (const template of DEFAULT_WORKFLOW_TEMPLATE_SEEDS) {
    const existingId = existingBySeedKey.get(template.seedKey);
    if (existingId) {
      sqliteRun(
        `UPDATE workflow_templates
         SET name = ?, description = ?, category = ?, metadata_json = ?, nodes_json = ?, edges_json = ?, updated_at = datetime('now')
         WHERE id = ? AND user_id = ?`,
        [
          template.name,
          template.description,
          template.category,
          JSON.stringify(template.metadata),
          JSON.stringify(template.nodes),
          JSON.stringify(template.edges),
          existingId,
          userId,
        ],
      );
      continue;
    }

    sqliteRun(
      `INSERT INTO workflow_templates (id, user_id, name, description, category, metadata_json, nodes_json, edges_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        userId,
        template.name,
        template.description,
        template.category,
        JSON.stringify(template.metadata),
        JSON.stringify(template.nodes),
        JSON.stringify(template.edges),
      ],
    );
  }
}

export function ensureDefaultWorkflowTemplatesForAllUsers(): void {
  const users = sqliteAll<UserRow>('SELECT id FROM users');
  for (const user of users) {
    // Per-user resilience: one user's seed write throwing (constraint error,
    // corrupt existing row, disk error) must not skip default-template seeding
    // for every subsequent user. This runs at gateway boot, so an unguarded
    // throw here would also abort startup. Isolate per user + warn.
    try {
      ensureDefaultWorkflowTemplates(user.id);
    } catch (error) {
      console.warn(
        `[default-workflow-templates] 为用户 ${user.id} 播种默认工作流模板失败，已跳过：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
