import type { FileDiffContent, ToolCallObservabilityAnnotation } from './message-schema.js';

export type {
  TeamInitPhase,
  TeamInitProjectKind,
  TeamInitStepKey,
  TeamInitStepStatus,
  TeamInitStep,
  TeamInitLayerBinding,
  TeamInitBindings,
  TeamInitState,
} from './team-init.js';
export {
  TEAM_INIT_STATE_VERSION,
  TEAM_INIT_STEP_ORDER,
  isTeamInitFinished,
  deriveTeamInitPhase,
} from './team-init.js';

export type {
  AssistantReasoningBlockTiming,
  AssistantTracePart,
  AssistantTracePayload,
  AssistantTraceReasoningPart,
  AssistantTraceTextPart,
  AssistantTraceToolCall,
  AssistantTraceToolPart,
} from './assistant-trace.js';
export type { UpdateChannel } from './release-endpoints.js';
export {
  DESKTOP_PREVIEW_LATEST_TAG,
  normalizeUpdateChannel,
  OPENAWORK_GITHUB_REPO,
  primaryLatestJsonForChannel,
  RELEASE_ENDPOINTS,
  updaterJsonEndpointsForChannel,
} from './release-endpoints.js';
export {
  contentFromAssistantTraceParts,
  createAssistantTraceContent,
  parseAssistantTraceContent,
  partsFromAssistantTrace,
  readAssistantTracePayloadFromParts,
} from './assistant-trace.js';
export type {
  ImageGenerationBackground,
  ImageGenerationOutputFormat,
  ImageGenerationQuality,
  ImageGenerationSizeAspect,
  ImageGenerationSizePreset,
  ImageGenerationSizePresetGroup,
  ImageGenerationSizePresetId,
  ImageGenerationSizePresetTier,
} from './image-generation.js';
export {
  DEFAULT_IMAGE_GENERATION_SIZE,
  downgradeImageGenerationSizeFrom4K,
  getImageGenerationSizeTier,
  IMAGE_GENERATION_SIZE_PRESET_GROUPS,
  IMAGE_GENERATION_SIZE_PRESETS,
  IMAGE_GENERATION_TIMEOUT_MS_BY_TIER,
  normalizeImageGenerationSize,
  parseImageGenerationSize,
  requiresHighQualityForSize,
  resolveImageGenerationSizePresetId,
  resolveImageGenerationTimeoutMs,
  sizeForPreset,
  validateImageGenerationSize,
} from './image-generation.js';
export type {
  FileBackupKind,
  FileBackupRef,
  FileChangeGuaranteeLevel,
  FileChangeSourceKind,
  FileDiffContent,
  InputImageContent,
  Message,
  MessageContent,
  MessageRole,
  ModifiedFilesSummaryContent,
  TextContent,
  ToolCallContent,
  ToolCallObservabilityAnnotation,
  ToolResultContent,
} from './message-schema.js';

export type DialogueMode = 'clarify' | 'coding' | 'programmer';

export type CommandSurface = 'composer' | 'palette';

export type CapabilityKind = 'agent' | 'skill' | 'mcp' | 'tool' | 'command';

export type CoreRole = 'general' | 'leader' | 'researcher' | 'planner' | 'executor' | 'reviewer';

export type TeamCoreRole = Extract<
  CoreRole,
  'leader' | 'planner' | 'researcher' | 'executor' | 'reviewer'
>;

export const FIXED_TEAM_CORE_ROLE_BINDINGS: Record<TeamCoreRole, string> = {
  leader: 'zeus',
  planner: 'prometheus',
  researcher: 'librarian',
  executor: 'hephaestus',
  reviewer: 'momus',
};

export const FIXED_TEAM_CORE_ROLE_ORDER: TeamCoreRole[] = [
  'leader',
  'planner',
  'researcher',
  'executor',
  'reviewer',
];

export const FIXED_TEAM_CORE_AGENT_IDS = Array.from(
  new Set(Object.values(FIXED_TEAM_CORE_ROLE_BINDINGS)),
);

export function isFixedTeamCoreAgentId(agentId: string): boolean {
  return FIXED_TEAM_CORE_AGENT_IDS.includes(agentId);
}

export type TeamRuntimeLayer = 'reception' | 'pm1' | 'pm2' | 'executor' | 'reviewer';

/**
 * 推理强度等级（与聊天端 ReasoningEffort 保持一致）。
 * 用于团队模板中按成员/层独立配置思考模式。
 */
export type TeamReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type TeamMemberSpecialty =
  | 'intake'
  | 'product-planning'
  | 'task-planning'
  | 'tech-lead'
  | 'dispatch'
  | 'release'
  | 'frontend'
  | 'backend'
  | 'data'
  | 'workflow'
  | 'integration'
  | 'qa'
  | 'docs'
  | 'devops'
  | 'platform'
  | 'code-review'
  | 'security'
  | 'sre'
  | 'observability'
  | 'quality'
  /**
   * 用户自定义角色。与上面的预置 specialty 不同，custom 成员的「身份」由
   * displayName + personaKey + systemPrompt 表达，可在任意层新增多个
   * （personaKey 区分），运行时按其 systemPrompt 注入人物设定。
   */
  | 'custom';

export interface FixedTeamMemberSlot {
  id: string;
  layer: TeamRuntimeLayer;
  specialty: TeamMemberSpecialty;
  displayName: string;
  personaKey: string;
  toolsets: string[];
  required: boolean;
  /**
   * 该成员运行时使用的模型绑定（可选，向后兼容）。
   * 未指定时运行时回退到层默认 → 模板 defaultProvider → 用户全局 active 选择。
   * 与「智能分配模型」功能配合：模板可一键按层填充，用户再逐槽微调。
   */
  providerId?: string;
  modelId?: string;
  variant?: string;
  /**
   * 该成员运行时是否启用思考模式（可选，向后兼容）。
   * 未指定时运行时回退到全局默认设置。
   * 仅对支持思考的模型（supportsThinking=true）生效。
   */
  thinkingEnabled?: boolean;
  /**
   * 思考强度等级（可选，向后兼容）。
   * 仅在 thinkingEnabled=true 时生效；未指定时默认 'medium'。
   */
  reasoningEffort?: TeamReasoningEffort;
  /**
   * 自定义角色专属字段（specialty === 'custom' 时有意义）：
   *   - custom: 标记这是用户自定义成员（UI / 运行时据此走自定义路径）
   *   - systemPrompt: 该角色的人物设定提示词（可由 AI 优化），运行时注入
   */
  custom?: boolean;
  systemPrompt?: string;
  /**
   * 模板初始绑定的能力（可选，向后兼容）：
   *   - skillIds: 该成员默认启用的 skill id 列表（运行时注入 metadata.requestedSkills）
   *   - mcpServerIds: 该成员默认可用的 MCP server id 列表
   * 仅列出用户已安装/启用的项；运行时仍按实际安装情况二次过滤。
   */
  skillIds?: string[];
  mcpServerIds?: string[];
  /**
   * 路由关键词（可选）：该成员「擅长处理什么」的关键词 / 领域词。
   *
   * 用于让上游派发（PM2 resolveAssignedMember）**动态识别**该成员的专长 ——
   * 尤其是自定义角色（specialty='custom' 本身不在预置关键词表里）。任务文本
   * 命中这里任一关键词时，该成员在同层候选中获得更高匹配分，从而被优先派发。
   * 预置角色一般无需填（已由 specialty 关键词表覆盖），自定义角色强烈建议填。
   */
  routingKeywords?: string[];
  /**
   * 派发优先级（可选）：同层多个候选打分相同时的排序权重。
   *   - high：优先派发
   *   - normal（默认）：常规
   *   - low：兜底，其他都不合适时才用
   * 仅影响「分数相同」时的次序，不会突破关键词 / specialty 的强匹配。
   */
  dispatchPriority?: 'high' | 'normal' | 'low';
}

export const DEFAULT_FIXED_TEAM_MEMBER_SLOTS: FixedTeamMemberSlot[] = [
  {
    id: 'reception-intake',
    layer: 'reception',
    specialty: 'intake',
    displayName: '接待官 / 需求澄清官',
    personaKey: 'reception:intake',
    toolsets: ['read'],
    required: true,
  },
  {
    id: 'pm1-product-planner',
    layer: 'pm1',
    specialty: 'product-planning',
    displayName: '产品规划师',
    personaKey: 'pm1:product-planning',
    toolsets: ['read'],
    required: true,
  },
  {
    id: 'pm1-task-planner',
    layer: 'pm1',
    specialty: 'task-planning',
    displayName: '任务拆解师',
    personaKey: 'pm1:task-planning',
    toolsets: ['read'],
    required: true,
  },
  {
    id: 'pm2-tech-lead',
    layer: 'pm2',
    specialty: 'tech-lead',
    displayName: '技术负责人',
    personaKey: 'pm2:tech-lead',
    toolsets: ['read', 'lsp', 'review'],
    required: true,
  },
  {
    id: 'pm2-dispatcher',
    layer: 'pm2',
    specialty: 'dispatch',
    displayName: '调度派发官',
    personaKey: 'pm2:dispatch',
    toolsets: ['read'],
    required: true,
  },
  {
    id: 'pm2-release-manager',
    layer: 'pm2',
    specialty: 'release',
    displayName: '发布经理',
    personaKey: 'pm2:release',
    toolsets: ['read', 'review'],
    required: false,
  },
  {
    id: 'executor-frontend',
    layer: 'executor',
    specialty: 'frontend',
    displayName: '前端开发者',
    personaKey: 'executor:frontend',
    toolsets: ['read', 'write', 'shell', 'lsp', 'test'],
    required: true,
  },
  {
    id: 'executor-backend',
    layer: 'executor',
    specialty: 'backend',
    displayName: '后端开发者',
    personaKey: 'executor:backend',
    toolsets: ['read', 'write', 'shell', 'lsp', 'test'],
    required: true,
  },
  {
    id: 'executor-data',
    layer: 'executor',
    specialty: 'data',
    displayName: '数据工程师',
    personaKey: 'executor:data',
    toolsets: ['read', 'write', 'shell', 'lsp', 'test'],
    required: false,
  },
  {
    id: 'executor-workflow',
    layer: 'executor',
    specialty: 'workflow',
    displayName: '工作流工程师',
    personaKey: 'executor:workflow',
    toolsets: ['read', 'write', 'shell', 'lsp', 'test'],
    required: false,
  },
  {
    id: 'executor-integration',
    layer: 'executor',
    specialty: 'integration',
    displayName: '集成工程师',
    personaKey: 'executor:integration',
    toolsets: ['read', 'write', 'shell', 'lsp', 'test', 'web'],
    required: false,
  },
  {
    id: 'executor-qa',
    layer: 'executor',
    specialty: 'qa',
    displayName: '测试验证工程师',
    personaKey: 'executor:qa',
    toolsets: ['read', 'write', 'shell', 'lsp', 'test'],
    required: false,
  },
  {
    id: 'executor-docs',
    layer: 'executor',
    specialty: 'docs',
    displayName: '文档工程师',
    personaKey: 'executor:docs',
    toolsets: ['read', 'write'],
    required: false,
  },
  {
    id: 'executor-devops',
    layer: 'executor',
    specialty: 'devops',
    displayName: 'DevOps 工程师',
    personaKey: 'executor:devops',
    toolsets: ['read', 'write', 'shell', 'test'],
    required: false,
  },
  {
    id: 'executor-platform',
    layer: 'executor',
    specialty: 'platform',
    displayName: '平台工程师',
    personaKey: 'executor:platform',
    toolsets: ['read', 'write', 'shell', 'lsp', 'test'],
    required: false,
  },
  {
    id: 'reviewer-code',
    layer: 'reviewer',
    specialty: 'code-review',
    displayName: '代码评审员',
    personaKey: 'reviewer:code-review',
    toolsets: ['read', 'lsp', 'review'],
    required: true,
  },
  {
    id: 'reviewer-security',
    layer: 'reviewer',
    specialty: 'security',
    displayName: '安全评审员',
    personaKey: 'reviewer:security',
    toolsets: ['read', 'lsp', 'review'],
    required: false,
  },
  {
    id: 'reviewer-sre',
    layer: 'reviewer',
    specialty: 'sre',
    displayName: 'SRE / 运维评审员',
    personaKey: 'reviewer:sre',
    toolsets: ['read', 'shell', 'review'],
    required: false,
  },
  {
    id: 'reviewer-observability',
    layer: 'reviewer',
    specialty: 'observability',
    displayName: '可观测性评审员',
    personaKey: 'reviewer:observability',
    toolsets: ['read', 'review'],
    required: false,
  },
  {
    id: 'reviewer-quality',
    layer: 'reviewer',
    specialty: 'quality',
    displayName: '质量评审员',
    personaKey: 'reviewer:quality',
    toolsets: ['read', 'lsp', 'test', 'review'],
    required: false,
  },
];

export const TEAM_RUNTIME_LAYER_ORDER = [
  'reception',
  'pm1',
  'pm2',
  'executor',
  'reviewer',
] as const;

export const TEAM_RUNTIME_LAYER_LABELS: Record<TeamRuntimeLayer, string> = {
  reception: '接待层',
  pm1: 'PM1 规划层',
  pm2: 'PM2 管控层',
  executor: '执行层',
  reviewer: '评审层',
};

export type RolePreset =
  | 'default'
  | 'coordinator'
  | 'explore'
  | 'analyst'
  | 'librarian'
  | 'architect'
  | 'debugger'
  | 'critic'
  | 'code-review'
  | 'test'
  | 'verifier';

export type RoleOverlay = 'writer' | 'multimodal';

export type RoleAliasConfidence = 'low' | 'medium' | 'high';

export type AgentCategory = 'exploration' | 'specialist' | 'advisor' | 'utility';

export type AgentCost = 'FREE' | 'CHEAP' | 'EXPENSIVE';

export interface DelegationTrigger {
  domain: string;
  trigger: string;
}

export interface RolePresetPack {
  description: string;
  supportedCoreRoles: CoreRole[];
  overlays?: RoleOverlay[];
}

export interface CanonicalRoleDescriptor {
  coreRole: CoreRole;
  preset?: RolePreset;
  overlays?: RoleOverlay[];
  confidence?: RoleAliasConfidence;
}

export interface RoleAliasMapping extends CanonicalRoleDescriptor {
  alias: string;
  notes?: string;
}

export const REFERENCE_AGENT_ROLE_METADATA: Record<
  string,
  {
    aliases?: string[];
    canonicalRole: CanonicalRoleDescriptor;
    category?: AgentCategory;
    cost?: AgentCost;
    triggers?: DelegationTrigger[];
    keyTrigger?: string;
    useWhen?: string[];
    avoidWhen?: string[];
  }
> = {
  build: {
    canonicalRole: {
      coreRole: 'general',
      preset: 'default',
      confidence: 'high',
    },
    category: 'specialist',
    cost: 'FREE',
  },
  zeus: {
    canonicalRole: {
      coreRole: 'leader',
      preset: 'coordinator',
      confidence: 'high',
    },
    aliases: ['leader', 'team-leader', 'coordinator', '/prompts:team-leader'],
    category: 'advisor',
    cost: 'EXPENSIVE',
    triggers: [
      {
        domain: '任务拆解',
        trigger: '意图需要分解为多个子任务并分派给团队角色',
      },
    ],
  },
  plan: {
    canonicalRole: {
      coreRole: 'planner',
      preset: 'default',
      confidence: 'high',
    },
    aliases: ['planner', '/prompts:planner', '/ccg:team-plan'],
    category: 'specialist',
    cost: 'FREE',
  },
  general: {
    canonicalRole: {
      coreRole: 'general',
      preset: 'default',
      confidence: 'high',
    },
    aliases: ['default', 'general-purpose'],
    category: 'specialist',
    cost: 'FREE',
  },
  explore: {
    canonicalRole: {
      coreRole: 'researcher',
      preset: 'explore',
      confidence: 'high',
    },
    aliases: ['explorer', 'codebase-explorer', 'repository-explorer'],
    category: 'exploration',
    cost: 'FREE',
    keyTrigger: '2+ 模块涉及 → 启动 explore 后台',
    triggers: [{ domain: 'Explore', trigger: '查找现有代码库结构、模式和风格' }],
    useWhen: ['需要多角度搜索', '不熟悉的模块结构', '跨层模式发现'],
    avoidWhen: ['确切知道搜索什么', '单个关键词/模式足够', '已知文件位置'],
  },
  sisyphus: {
    canonicalRole: {
      coreRole: 'general',
      preset: 'default',
      confidence: 'low',
    },
    aliases: ['sisyphus'],
    category: 'specialist',
    cost: 'EXPENSIVE',
    triggers: [{ domain: '编排', trigger: '复杂任务需要规划、委派、验证、交付' }],
  },
  hephaestus: {
    canonicalRole: {
      coreRole: 'executor',
      preset: 'default',
      confidence: 'high',
    },
    aliases: ['executor', '/prompts:executor', '/ccg:team-exec'],
    category: 'specialist',
    cost: 'EXPENSIVE',
    triggers: [{ domain: '实施', trigger: '代码实现、工程落地、深度修改' }],
  },
  prometheus: {
    canonicalRole: {
      coreRole: 'planner',
      preset: 'default',
      confidence: 'high',
    },
    aliases: ['planner'],
    category: 'advisor',
    cost: 'EXPENSIVE',
    triggers: [{ domain: '规划', trigger: '战略规划、工作计划设计、需求访谈' }],
  },
  oracle: {
    canonicalRole: {
      coreRole: 'researcher',
      preset: 'architect',
      confidence: 'high',
    },
    aliases: ['architect', 'debugger', 'code-reviewer', 'init-architect'],
    category: 'advisor',
    cost: 'EXPENSIVE',
    keyTrigger: '架构决策/困难调试 → 咨询 Oracle',
    triggers: [{ domain: '架构', trigger: '架构决策、困难调试、战略审查' }],
    useWhen: ['架构决策需要深度分析', '困难 bug 需要诊断', '代码审查需要战略视角'],
    avoidWhen: ['简单实现任务', '已知方案的直接执行'],
  },
  librarian: {
    canonicalRole: {
      coreRole: 'researcher',
      preset: 'librarian',
      confidence: 'high',
    },
    aliases: ['librarian', 'docs-librarian', 'research-librarian'],
    category: 'exploration',
    cost: 'CHEAP',
    keyTrigger: '外部库/文档提及 → 启动 librarian',
    triggers: [{ domain: 'Librarian', trigger: '搜索外部文档、官方 API、OSS 实现' }],
    useWhen: ['不熟悉的库需要查文档', '需要官方 API 用法', '需要 OSS 实现示例'],
    avoidWhen: ['搜索自己的代码库', '已知文件位置'],
  },
  metis: {
    canonicalRole: {
      coreRole: 'researcher',
      preset: 'analyst',
      confidence: 'high',
    },
    aliases: ['analyst', '/prompts:analyst', '/ccg:team-research'],
    category: 'advisor',
    cost: 'CHEAP',
    triggers: [{ domain: '预规划', trigger: '规划前分析请求，检测歧义和 AI-slop 风险' }],
  },
  momus: {
    canonicalRole: {
      coreRole: 'reviewer',
      preset: 'critic',
      confidence: 'high',
    },
    aliases: [
      'critic',
      'reviewer',
      'lazycodex-gate-reviewer',
      '/prompts:critic',
      '/ccg:team-review',
    ],
    category: 'advisor',
    cost: 'CHEAP',
    triggers: [{ domain: '审查', trigger: '工作计划审查，捕捉缺口、歧义和缺失上下文' }],
  },
  atlas: {
    canonicalRole: {
      coreRole: 'reviewer',
      preset: 'verifier',
      confidence: 'low',
    },
    aliases: ['verifier', 'verification-reviewer', '/prompts:verifier'],
    category: 'advisor',
    cost: 'EXPENSIVE',
    triggers: [{ domain: '验证', trigger: '编排验证，委派任务并验证完成证据' }],
  },
  'multimodal-looker': {
    canonicalRole: {
      coreRole: 'researcher',
      overlays: ['multimodal'],
      confidence: 'medium',
    },
    aliases: ['multimodal', 'ui-ux-designer'],
    category: 'utility',
    cost: 'CHEAP',
  },
  'sisyphus-junior': {
    canonicalRole: {
      coreRole: 'executor',
      preset: 'default',
      confidence: 'high',
    },
    aliases: ['junior', 'qa-executor', 'qa_executor', 'test-executor'],
    category: 'specialist',
    cost: 'CHEAP',
  },
};

export const ROLE_PRESET_PACKS: Record<RolePreset, RolePresetPack> = {
  default: {
    description: '通用兜底执行与基础编排',
    supportedCoreRoles: ['general', 'planner', 'executor'],
  },
  coordinator: {
    description: '团队任务拆解、角色分派与协作编排',
    supportedCoreRoles: ['leader'],
  },
  explore: {
    description: '代码库探索与模式检索',
    supportedCoreRoles: ['researcher'],
  },
  analyst: {
    description: '需求澄清、范围分析与约束提炼',
    supportedCoreRoles: ['researcher'],
  },
  librarian: {
    description: '外部文档与参考实现检索',
    supportedCoreRoles: ['researcher'],
  },
  architect: {
    description: '架构设计、系统边界与方案评审',
    supportedCoreRoles: ['planner'],
  },
  debugger: {
    description: '故障定位、根因分析与修复落地',
    supportedCoreRoles: ['executor'],
  },
  critic: {
    description: '计划/方案挑战与风险挑刺',
    supportedCoreRoles: ['reviewer'],
  },
  'code-review': {
    description: '代码质量、安全与一致性审查',
    supportedCoreRoles: ['reviewer'],
  },
  test: {
    description: '测试设计、TDD 与回归验证',
    supportedCoreRoles: ['reviewer'],
  },
  verifier: {
    description: '完成证明、证据校验与验收把关',
    supportedCoreRoles: ['reviewer'],
  },
};

export function formatCanonicalRole(descriptor: CanonicalRoleDescriptor): string {
  const preset = descriptor.preset ? `/${descriptor.preset}` : '';
  const overlays = descriptor.overlays?.length ? `+${descriptor.overlays.join('+')}` : '';
  return `${descriptor.coreRole}${preset}${overlays}`;
}

export type CapabilitySource =
  'builtin' | 'installed' | 'configured' | 'runtime' | 'reference' | 'custom';

export interface CapabilityDescriptor {
  id: string;
  kind: CapabilityKind;
  label: string;
  description: string;
  source: CapabilitySource;
  tags?: string[];
  enabled?: boolean;
  callable?: boolean;
  canonicalRole?: CanonicalRoleDescriptor;
  aliases?: string[];
}

export type ManagedAgentOrigin = 'builtin' | 'custom';

export interface ManagedAgentBody {
  label: string;
  description: string;
  aliases: string[];
  canonicalRole?: CanonicalRoleDescriptor;
  model?: string;
  variant?: string;
  fallbackModels?: string[];
  systemPrompt?: string;
  /** Hex accent color for this agent (e.g. "#FF6347"). Ported from oh-my-opencode agent color system. */
  color?: string;
  note?: string;
  /** When true, tools are sent with defer_loading and tool_search is enabled (Responses API only). */
  deferToolLoading?: boolean;
}

export interface ManagedAgentRecord extends ManagedAgentBody {
  id: string;
  origin: ManagedAgentOrigin;
  source: CapabilitySource;
  enabled: boolean;
  removable: boolean;
  resettable: boolean;
  hasOverrides: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateManagedAgentInput extends ManagedAgentBody {
  id?: string;
  enabled?: boolean;
}

export interface UpdateManagedAgentInput {
  label?: string;
  description?: string;
  aliases?: string[];
  canonicalRole?: CanonicalRoleDescriptor;
  model?: string;
  variant?: string;
  fallbackModels?: string[];
  systemPrompt?: string;
  color?: string;
  note?: string;
  enabled?: boolean;
  deferToolLoading?: boolean;
}

export interface AgentPreferenceRecord {
  agentId: string;
  displayNameOverride?: string;
  note?: string;
  favorite: boolean;
  hidden: boolean;
  updatedAt: string;
}

export type CompanionThemeVariant = 'default' | 'playful';

export type CompanionVerbosity = 'minimal' | 'normal';

export type CompanionInjectionMode = 'off' | 'mention_only' | 'always';

export type CompanionBehaviorTone = 'supportive' | 'focused' | 'playful';

export type CompanionVoiceOutputMode = 'off' | 'buddy_only' | 'important_only';

export type CompanionVoiceVariant = 'system' | 'bright' | 'calm';

export type CompanionSpecies =
  | 'duck'
  | 'goose'
  | 'blob'
  | 'cat'
  | 'dragon'
  | 'octopus'
  | 'owl'
  | 'penguin'
  | 'turtle'
  | 'snail'
  | 'ghost'
  | 'axolotl'
  | 'capybara'
  | 'cactus'
  | 'robot'
  | 'rabbit'
  | 'mushroom'
  | 'chonk';

export interface CompanionAgentBinding {
  displayName?: string;
  species: CompanionSpecies;
  themeVariant?: CompanionThemeVariant;
  behaviorTone?: CompanionBehaviorTone;
  injectionMode?: CompanionInjectionMode;
  verbosity?: CompanionVerbosity;
  voiceOutputMode?: CompanionVoiceOutputMode;
  voiceRate?: number;
  voiceVariant?: CompanionVoiceVariant;
}

export interface UpdateAgentPreferenceInput {
  displayNameOverride?: string;
  note?: string;
  favorite?: boolean;
  hidden?: boolean;
}

export type CommandExecutionMode = 'client' | 'server';

export type CommandAction =
  | { kind: 'navigate'; to: '/chat' | '/sessions' | '/settings' }
  | { kind: 'open_companion_panel' }
  | { kind: 'create_session' }
  | { kind: 'create_child_session' }
  | { kind: 'open_workspace_picker' }
  | { kind: 'open_model_picker' }
  | { kind: 'show_help' }
  | { kind: 'set_dialogue_mode'; mode: DialogueMode }
  | { kind: 'set_yolo_mode'; enabled: boolean }
  | { kind: 'toggle_thinking' }
  | { kind: 'compact_session' }
  | { kind: 'toggle_theme' }
  | { kind: 'generate_handoff' }
  | { kind: 'init_deep' }
  | { kind: 'start_ralph_loop' }
  | { kind: 'start_ulw_loop' }
  | { kind: 'verify_ulw_loop' }
  | { kind: 'cancel_ralph_loop' }
  | { kind: 'stop_continuation' }
  | { kind: 'refactor_session' }
  | { kind: 'remove_deadcode' }
  | { kind: 'start_work' }
  | { kind: 'submit_start_work_done_claim' }
  | { kind: 'review_start_work_done_claim' };

export interface CommandDescriptor {
  id: string;
  label: string;
  description?: string;
  shortcut?: string;
  contexts: CommandSurface[];
  execution: CommandExecutionMode;
  action: CommandAction;
}

export interface StatusCommandResultCard {
  type: 'status';
  title: string;
  message: string;
  tone: 'info' | 'success' | 'warning' | 'error';
}

export interface CompactionCommandResultCard {
  type: 'compaction';
  title: string;
  summary: string;
  trigger: 'manual' | 'automatic';
}

export type CommandResultCard = StatusCommandResultCard | CompactionCommandResultCard;

export interface CommandExecutionResult {
  events: RunEvent[];
  card?: CommandResultCard;
  sessionId?: string;
}

export type WorkflowRuntimeMode = 'normal' | 'planning' | 'execution' | 'ulw';

export type WorkflowRuntimeVerificationStatus = 'none' | 'pending' | 'passed' | 'failed';

export type WorkflowRuntimeEvidenceStatus = 'none' | 'pending' | 'available';

export interface WorkflowRuntimePlanState {
  readonly path?: string;
  readonly progress?: string;
  readonly requestedWorktreePath?: string;
  readonly title?: string;
  readonly worktreePath?: string;
}

export interface WorkflowRuntimeLoopState {
  readonly completionPromise?: string;
  readonly kind: 'ralph' | 'ulw';
  readonly startedAt?: number;
  readonly strategy?: 'continue' | 'reset';
  readonly taskDescription?: string;
  readonly taskId?: string;
  readonly verificationRequired: boolean;
  readonly verificationStatus: WorkflowRuntimeVerificationStatus;
}

export interface WorkflowRuntimeEvidenceState {
  readonly artifactRefs: readonly string[];
  readonly status: WorkflowRuntimeEvidenceStatus;
}

export interface WorkflowRuntimeState {
  readonly activeLoop?: WorkflowRuntimeLoopState;
  readonly activePlan?: WorkflowRuntimePlanState;
  readonly evidence: WorkflowRuntimeEvidenceState;
  readonly mode: WorkflowRuntimeMode;
}

export interface TaskOwnership {
  principalKind: 'user' | 'agent' | 'system' | 'service' | 'session' | 'tool';
  principalId: string;
  scope?: string;
}

export interface TaskEntityRecord {
  id: string;
  kind: string;
  subject: string;
  description?: string;
  status: string;
  ownership?: TaskOwnership;
  createdBy?: TaskOwnership;
  assignedBy?: TaskOwnership;
  executor?: TaskOwnership;
  parentTaskId?: string;
  blockedBy: string[];
  blocks?: string[];
  revision: number;
  idempotencyKey?: string;
  causationId?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface TaskRunRecord {
  runId: string;
  taskId?: string;
  mode: 'sync' | 'async' | 'background' | 'remote' | 'worktree';
  presentationMode: 'foreground' | 'background';
  executorType: 'subagent' | 'shell' | 'remote' | 'teammate';
  sessionRef: string;
  status:
    'pending' | 'running' | 'waiting' | 'cancel_requested' | 'completed' | 'failed' | 'cancelled';
  deliveryState: 'pending_delivery' | 'delivered' | 'suppressed';
  outputRef?: string;
  outputOffset: number;
  revision: number;
  idempotencyKey?: string;
  causationId?: string;
  bindTaskPolicy?: 'bind-immediately' | 'bind-later' | 'ephemeral-only';
  startedAt?: number;
  finishedAt?: number;
}

export interface InteractionRecord {
  interactionId: string;
  taskId?: string;
  runId: string;
  type: 'question' | 'permission' | 'approval' | 'rejection' | 'clarification';
  toolCallRef?: string;
  channel: 'local' | 'mailbox' | 'leader-relay' | 'api';
  payload?: Record<string, unknown>;
  feedback?: string;
  approvalId?: string;
  approver?: TaskOwnership;
  decision?: 'approved' | 'rejected' | 'dismissed' | 'expired';
  planVersion?: string;
  planHash?: string;
  causationId?: string;
  status: 'pending' | 'answered' | 'rejected' | 'expired' | 'dismissed';
  answeredAt?: number;
}

export interface PlanTransitionRecord {
  planRef: string;
  prePlanMode: boolean;
  permissionSnapshot?: Record<string, unknown>;
  approvalChannel?: InteractionRecord['channel'];
  approvalId?: string;
  planVersion?: string;
  planHash?: string;
  metadata?: Record<string, unknown>;
  occurredAt?: number;
}

export interface SessionContextRecord {
  sessionId: string;
  parentSessionId?: string;
  rootSessionId?: string;
  status: 'idle' | 'busy' | 'retry' | 'paused';
  currentRunId?: string;
  planRef?: string;
  clientSurface?: string;
  revision: number;
  updatedAt: number;
}

export type PermissionRiskLevel = 'low' | 'medium' | 'high';

export type PermissionDecision = 'once' | 'session' | 'permanent' | 'reject';

export type PermissionRequestStatus = 'pending' | 'approved' | 'rejected';

export interface PermissionRequestBase {
  requestId: string;
  toolName: string;
  scope: string;
  reason: string;
  riskLevel: PermissionRiskLevel;
  previewAction?: string;
  /**
   * Broad-approval patterns computed at request time (mirrors opencode's
   * ctx.ask `always` array — e.g. `["ls *"]` for `bash ls -la`). When the
   * user picks "本会话允许" or "永久允许", every subsequent same-category
   * request whose scope wildcard-matches one of these patterns auto-resolves
   * without re-prompting. Surfacing them in the UI lets the user understand
   * exactly what the broad approval covers before clicking through.
   */
  always?: string[];
}

export interface PendingPermissionRequest extends PermissionRequestBase {
  sessionId: string;
  status: PermissionRequestStatus;
  decision?: PermissionDecision;
  createdAt: string;
}

export interface PermissionReplyPayload {
  requestId: string;
  decision: PermissionDecision;
  feedback?: string;
  alwaysOverride?: string[];
}

export interface StreamTextChunk {
  type: 'text_delta';
  delta: string;
  eventId?: string;
  runId?: string;
  /** Agent ID that generated this text (for per-agent color rendering). */
  agentId?: string;
  occurredAt?: number;
}

export interface StreamThinkingStartChunk {
  type: 'thinking_start';
  itemId?: string;
  outputIndex?: number;
  summaryIndex?: number;
  eventId?: string;
  runId?: string;
  occurredAt?: number;
}

export interface StreamThinkingChunk {
  type: 'thinking_delta';
  delta: string;
  itemId?: string;
  outputIndex?: number;
  summaryIndex?: number;
  eventId?: string;
  runId?: string;
  occurredAt?: number;
}

export interface StreamThinkingEndChunk {
  type: 'thinking_end';
  itemId?: string;
  outputIndex?: number;
  summaryIndex?: number;
  eventId?: string;
  runId?: string;
  occurredAt?: number;
  /**
   * Provider-specific opaque payload bound to this reasoning block. Currently
   * used to carry per-block multi-turn data such as Responses API
   * `encrypted_content` so subsequent turns can replay reasoning on the
   * upstream side without leaking decrypted content to the client.
   */
  providerMetadata?: {
    encryptedContent?: string;
    summary?: string;
    responseId?: string;
    /**
     * Anthropic extended-thinking signature for this reasoning block.
     * Required for replaying thinking blocks on subsequent turns
     * (without it Anthropic rejects the assistant turn).
     */
    signature?: string;
  };
}

export interface StreamToolCallChunk {
  type: 'tool_call_delta';
  toolCallId: string;
  toolName: string;
  inputDelta: string;
  requestId?: string;
  eventId?: string;
  runId?: string;
  occurredAt?: number;
  /**
   * Provider-attached metadata forwarded from the AI SDK
   * `tool-call.providerMetadata`. The OpenAI Responses API in particular
   * emits an `openai.itemId` (`fc_xxx`) that is *separate* from the call
   * id surfaced as `toolCallId` (`call_xxx`); persisting and replaying
   * it on subsequent rounds is required for the prompt-cache prefix to
   * stay byte-stable across turns. Only the final `tool_call_delta`
   * emitted at the end of the call (after `tool-input-end`) carries
   * this — the streaming opener and per-delta chunks leave it
   * undefined and downstream consumers must treat absence as "no
   * additional provider metadata".
   */
  providerMetadata?: Record<string, Record<string, unknown>>;
}

export type ToolSearchStatus = 'in_progress' | 'searching' | 'completed';

export interface StreamToolSearchChunk {
  type: 'tool_search';
  status: ToolSearchStatus;
  eventId?: string;
  runId?: string;
  occurredAt?: number;
}

export interface UpstreamRouteDescriptor {
  modelId: string;
  providerId?: string;
}

export interface StreamUpstreamRouteChunk extends UpstreamRouteDescriptor {
  type: 'upstream_route';
  requestId?: string;
  eventId?: string;
  runId?: string;
  occurredAt?: number;
}

/**
 * Per-session cancellation summary surfaced on the terminal `done`
 * event when `stopReason === 'cancelled'`. Generated by the cascade
 * helper that propagates the abort to descendant `delegate_task` /
 * `look_at` streams so the UI can show a meaningful "stopped 1 task
 * + 2 children" toast instead of a bare "cancelled". Mirrors opencode
 * #25798 follow-up.
 */
export interface StreamCancellationSummary {
  /** High-level reason tag — what triggered the cancel locally. */
  reason: 'user_aborted' | 'parent_aborted' | 'ancestor_aborted';
  /** Number of descendant sessions that received a cascade signal. */
  descendantSessions: number;
  /** Total in-flight stream slots cancelled across descendants. */
  cancelledStreams: number;
  /** Wall-clock cost of the cascade, milliseconds. */
  cascadeDurationMs: number;
  /** True when the cascade exhausted its budget before completing. */
  timedOut: boolean;
}

export interface StreamDoneChunk {
  type: 'done';
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'error' | 'cancelled' | 'tool_permission';
  requestId?: string;
  eventId?: string;
  runId?: string;
  /** Agent ID that generated this response round (for per-agent color rendering). */
  agentId?: string;
  occurredAt?: number;
  /** Cascade summary; only present when `stopReason === 'cancelled'`. */
  cancellation?: StreamCancellationSummary;
  upstreamSummary?: UpstreamStreamSummary;
}

export interface UpstreamStreamSummary {
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'error' | 'cancelled' | 'tool_permission';
  textDeltaCount: number;
  reasoningDeltaCount: number;
  toolCallDeltaCount: number;
  modelId?: string;
  providerId?: string;
  sawDone: boolean;
  sawError: boolean;
  stalled: boolean;
}

export interface StreamErrorChunk {
  type: 'error';
  code: string;
  message: string;
  requestId?: string;
  eventId?: string;
  runId?: string;
  occurredAt?: number;
  upstreamSummary?: UpstreamStreamSummary;
}

export interface StreamToolResultChunk {
  type: 'tool_result';
  toolCallId: string;
  toolName: string;
  clientRequestId?: string;
  output: unknown;
  isError: boolean;
  reason?: string;
  fileDiffs?: FileDiffContent[];
  pendingPermissionRequestId?: string;
  resumedAfterApproval?: boolean;
  observability?: ToolCallObservabilityAnnotation;
  eventId?: string;
  runId?: string;
  occurredAt?: number;
}

export type BatchSubToolStatus = 'running' | 'completed' | 'error' | 'skipped';

export interface BatchSubToolProgress {
  index: number;
  tool: string;
  status: BatchSubToolStatus;
  output?: unknown;
  /**
   * Live, growing stdout/stderr snapshot for sub-tools that support
   * streaming (currently bash). Populated only while `status === 'running'`
   * — once the sub-tool finishes it is cleared and the final value lands
   * in `output`. Throttled emission keeps SSE volume bounded.
   */
  partialOutput?: string;
  isError?: boolean;
  durationMs?: number;
}

export interface StreamToolProgressChunk {
  type: 'tool_progress';
  toolCallId: string;
  toolName: string;
  subTools: BatchSubToolProgress[];
  completedCount: number;
  totalCount: number;
  clientRequestId?: string;
  eventId?: string;
  runId?: string;
  occurredAt?: number;
}

export interface StreamPermissionAskedChunk extends PermissionRequestBase {
  type: 'permission_asked';
  eventId?: string;
  runId?: string;
  occurredAt?: number;
}

export interface StreamPermissionRepliedChunk {
  type: 'permission_replied';
  requestId: string;
  decision: PermissionDecision;
  feedback?: string;
  eventId?: string;
  runId?: string;
  occurredAt?: number;
}

export interface StreamQuestionAskedChunk {
  type: 'question_asked';
  requestId: string;
  toolName: string;
  title: string;
  eventId?: string;
  runId?: string;
  occurredAt?: number;
}

export interface StreamQuestionRepliedChunk {
  type: 'question_replied';
  requestId: string;
  status: 'answered' | 'dismissed';
  eventId?: string;
  runId?: string;
  occurredAt?: number;
}

/** The only timeout source still produced automatically by the current runtime. */
export type TaskTimeoutSource = 'first_response';

export interface StreamTaskUpdateChunk {
  type: 'task_update';
  taskId: string;
  label: string;
  status: 'pending' | 'in_progress' | 'done' | 'failed' | 'cancelled';
  assignedAgent?: string;
  category?: string;
  requestedSkills?: string[];
  result?: string;
  errorMessage?: string;
  reason?: string;
  timeoutSource?: TaskTimeoutSource;
  sessionId?: string;
  parentTaskId?: string;
  parentSessionId?: string;
  eventId?: string;
  runId?: string;
  occurredAt?: number;
}

export interface StreamSessionChildChunk {
  type: 'session_child';
  sessionId: string;
  parentSessionId: string;
  title?: string;
  eventId?: string;
  runId?: string;
  occurredAt?: number;
}

export interface StreamCompactionChunk {
  type: 'compaction';
  summary: string;
  trigger: 'manual' | 'automatic';
  phase?: 'started' | 'completed' | 'failed';
  cause?: 'manual' | 'usage_overflow' | 'provider_overflow' | 'proactive_near_overflow';
  strategy?: 'summary_only' | 'replay' | 'synthetic_continue';
  compactedMessages?: number;
  representedMessages?: number;
  eventId?: string;
  runId?: string;
  occurredAt?: number;
}

export interface StreamUsageChunk {
  type: 'usage';
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  round: number;
  eventId?: string;
  runId?: string;
  occurredAt?: number;
}

export interface StreamAuditRefChunk {
  type: 'audit_ref';
  auditLogId: string;
  toolName?: string;
  eventId?: string;
  runId?: string;
  occurredAt?: number;
}

/**
 * Lifecycle status of a tracked terminal in a chat session. See
 * `.agentdocs/workflow/260512-session-terminal-tracking-spec.md` for the
 * authoritative state machine. `tmux-spawned` / `tmux-killed` are pseudo
 * terminal states emitted by interactive_bash lifecycle commands — the
 * underlying tmux session has no pid we own, so there is no `running`
 * transient state for them.
 */
export type SessionTerminalStatus =
  | 'running'
  | 'idle'
  | 'exited'
  | 'aborted'
  | 'timeout'
  | 'spawn_error'
  | 'killed'
  | 'stale'
  | 'tmux-spawned'
  | 'tmux-killed';

export type SessionTerminalKind = 'foreground' | 'background' | 'tmux';

export interface SessionTerminalSummary {
  terminalId: string;
  sessionId: string;
  clientRequestId?: string;
  toolName: string;
  kind: SessionTerminalKind;
  command: string;
  description?: string;
  /** User-defined display name for the terminal tab. */
  name?: string;
  cwd: string;
  pid?: number;
  status: SessionTerminalStatus;
  exitCode?: number;
  startedAtMs: number;
  endedAtMs?: number;
  lastActivityMs: number;
  outputBytesTotal: number;
  outputTail: string;
  outputPath?: string;
}

export interface StreamTerminalStartedChunk {
  type: 'terminal_started';
  terminalId: string;
  sessionId: string;
  toolName: string;
  kind: SessionTerminalKind;
  command: string;
  description?: string;
  cwd: string;
  startedAtMs: number;
  clientRequestId?: string;
  toolCallId?: string;
  eventId?: string;
  runId?: string;
  occurredAt?: number;
}

export interface StreamTerminalOutputChunk {
  type: 'terminal_output';
  terminalId: string;
  outputTail: string;
  outputBytesTotal: number;
  occurredAt?: number;
  eventId?: string;
  runId?: string;
}

export interface StreamTerminalExitedChunk {
  type: 'terminal_exited';
  terminalId: string;
  status: SessionTerminalStatus;
  exitCode?: number;
  endedAtMs: number;
  occurredAt?: number;
  eventId?: string;
  runId?: string;
}

export type StreamChunk =
  | StreamTextChunk
  | StreamThinkingStartChunk
  | StreamThinkingChunk
  | StreamThinkingEndChunk
  | StreamToolCallChunk
  | StreamToolSearchChunk
  | StreamUpstreamRouteChunk
  | StreamDoneChunk
  | StreamErrorChunk;

export type RunEvent =
  | StreamChunk
  | StreamToolResultChunk
  | StreamPermissionAskedChunk
  | StreamPermissionRepliedChunk
  | StreamQuestionAskedChunk
  | StreamQuestionRepliedChunk
  | StreamTaskUpdateChunk
  | StreamSessionChildChunk
  | StreamCompactionChunk
  | StreamUsageChunk
  | StreamAuditRefChunk
  | StreamToolProgressChunk
  | StreamTerminalStartedChunk
  | StreamTerminalOutputChunk
  | StreamTerminalExitedChunk;

export interface RunEventCursor {
  clientRequestId: string;
  seq: number;
}

export type RunEventBookend =
  | {
      kind: 'run_completed';
      terminal: true;
      replayable: true;
      stopReason: StreamDoneChunk['stopReason'];
    }
  | {
      kind: 'run_cancelled';
      terminal: true;
      replayable: true;
      stopReason: 'cancelled';
      /**
       * Optional cancellation summary mirroring the matching `done`
       * chunk. Persisted alongside the envelope so a UI replaying
       * historical run events (timeline, transcript) can still
       * reconstruct "stopped by parent / cascade hit N children"
       * information after the live stream is gone (T-CANCEL-07,
       * workflow 260509).
       */
      cancellation?: StreamCancellationSummary;
    }
  | {
      kind: 'run_failed';
      terminal: true;
      replayable: true;
    }
  | {
      kind: 'interaction_wait';
      terminal: false;
      replayable: true;
      interactionType: 'permission' | 'question';
      requestId: string;
    }
  | {
      kind: 'interaction_resumed';
      terminal: false;
      replayable: false;
      interactionType: 'permission' | 'question';
      requestId: string;
    }
  | {
      kind: 'tool_handoff';
      terminal: false;
      replayable: false;
      stopReason: 'tool_use';
    }
  | {
      kind: 'permission_paused';
      terminal: false;
      replayable: true;
      stopReason: 'tool_permission';
    };

export interface EventEnvelope<TPayload = unknown, TAggregateType extends string = string> {
  eventId: string;
  aggregateType: TAggregateType;
  aggregateId: string;
  seq: number;
  version: number;
  causationId?: string;
  timestamp: number;
  payload: TPayload;
}

export interface RunEventEnvelopePayload {
  clientRequestId?: string;
  cursor?: RunEventCursor;
  deliveryState: TaskRunRecord['deliveryState'];
  outputOffset: number;
  bookend?: RunEventBookend;
  event: RunEvent;
}

export type RunEventEnvelope = EventEnvelope<RunEventEnvelopePayload, 'run'>;

export interface ApiError {
  code: string;
  message: string;
  retryable: boolean;
  statusCode?: number;
}

export function isRetryableError(error: ApiError): boolean {
  return error.retryable;
}

// ---------------------------------------------------------------------------
/**
 * 关联模型：将一次工具调用追踪条目锚定到 session + request + toolCall 三元组。
 *
 * sessionId        —— 会话唯一 ID（来自 sessions 表）
 * clientRequestId  —— 客户端请求 ID（session_messages.client_request_id 或
 *                      session_run_events.client_request_id）
 * requestId        —— 网关侧请求 ID（request_workflow_logs.request_id）
 * toolCallId       —— 工具调用 ID（ToolCallContent.toolCallId）
 *
 * 三元组完整时可做精确跨表 JOIN；部分缺失时按已有字段降级查询。
 */
export interface ToolCallTraceKey {
  sessionId: string;
  toolCallId: string;
  clientRequestId?: string;
  requestId?: string;
}

/**
 * 可被可观测性层消费的工具调用追踪条目（完整描述一次工具调用）。
 */
export interface ToolCallTraceEntry extends ToolCallTraceKey, ToolCallObservabilityAnnotation {
  /** 工具调用发生的毫秒时间戳（来源：session_run_events.occurred_at_ms）*/
  occurredAt?: number;
}

export {
  buildReasoningBlockKey,
  cleanReasoningInlineText,
  extractReasoningHeading,
  extractReasoningPreview,
  getReasoningHint,
  getReasoningLabel,
  REASONING_COLOR_TOKENS,
  REASONING_UI_TOKENS,
} from './reasoning-ui.js';
