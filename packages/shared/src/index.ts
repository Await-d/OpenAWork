import type { FileDiffContent, ToolCallObservabilityAnnotation } from './message-schema.js';

export type {
  FileBackupKind,
  FileBackupRef,
  FileChangeGuaranteeLevel,
  FileChangeSourceKind,
  FileDiffContent,
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
    canonicalRole: { coreRole: 'general', preset: 'default', confidence: 'high' },
    category: 'specialist',
    cost: 'FREE',
  },
  zeus: {
    canonicalRole: { coreRole: 'leader', preset: 'coordinator', confidence: 'high' },
    aliases: ['leader', 'team-leader', 'coordinator', '/prompts:team-leader'],
    category: 'advisor',
    cost: 'EXPENSIVE',
    triggers: [{ domain: '任务拆解', trigger: '意图需要分解为多个子任务并分派给团队角色' }],
  },
  plan: {
    canonicalRole: { coreRole: 'planner', preset: 'default', confidence: 'high' },
    aliases: ['planner', '/prompts:planner', '/ccg:team-plan'],
    category: 'specialist',
    cost: 'FREE',
  },
  general: {
    canonicalRole: { coreRole: 'general', preset: 'default', confidence: 'high' },
    aliases: ['default', 'general-purpose'],
    category: 'specialist',
    cost: 'FREE',
  },
  explore: {
    canonicalRole: { coreRole: 'researcher', preset: 'explore', confidence: 'high' },
    aliases: ['explorer'],
    category: 'exploration',
    cost: 'FREE',
    keyTrigger: '2+ 模块涉及 → 启动 explore 后台',
    triggers: [{ domain: 'Explore', trigger: '查找现有代码库结构、模式和风格' }],
    useWhen: ['需要多角度搜索', '不熟悉的模块结构', '跨层模式发现'],
    avoidWhen: ['确切知道搜索什么', '单个关键词/模式足够', '已知文件位置'],
  },
  sisyphus: {
    canonicalRole: { coreRole: 'general', preset: 'default', confidence: 'low' },
    aliases: ['sisyphus'],
    category: 'specialist',
    cost: 'EXPENSIVE',
    triggers: [{ domain: '编排', trigger: '复杂任务需要规划、委派、验证、交付' }],
  },
  hephaestus: {
    canonicalRole: { coreRole: 'executor', preset: 'default', confidence: 'high' },
    aliases: ['executor', '/prompts:executor', '/ccg:team-exec'],
    category: 'specialist',
    cost: 'EXPENSIVE',
    triggers: [{ domain: '实施', trigger: '代码实现、工程落地、深度修改' }],
  },
  prometheus: {
    canonicalRole: { coreRole: 'planner', preset: 'default', confidence: 'high' },
    aliases: ['planner'],
    category: 'advisor',
    cost: 'EXPENSIVE',
    triggers: [{ domain: '规划', trigger: '战略规划、工作计划设计、需求访谈' }],
  },
  oracle: {
    canonicalRole: { coreRole: 'researcher', preset: 'architect', confidence: 'high' },
    aliases: ['architect', 'debugger', 'code-reviewer', 'init-architect'],
    category: 'advisor',
    cost: 'EXPENSIVE',
    keyTrigger: '架构决策/困难调试 → 咨询 Oracle',
    triggers: [{ domain: '架构', trigger: '架构决策、困难调试、战略审查' }],
    useWhen: ['架构决策需要深度分析', '困难 bug 需要诊断', '代码审查需要战略视角'],
    avoidWhen: ['简单实现任务', '已知方案的直接执行'],
  },
  librarian: {
    canonicalRole: { coreRole: 'researcher', preset: 'librarian', confidence: 'high' },
    aliases: ['librarian'],
    category: 'exploration',
    cost: 'CHEAP',
    keyTrigger: '外部库/文档提及 → 启动 librarian',
    triggers: [{ domain: 'Librarian', trigger: '搜索外部文档、官方 API、OSS 实现' }],
    useWhen: ['不熟悉的库需要查文档', '需要官方 API 用法', '需要 OSS 实现示例'],
    avoidWhen: ['搜索自己的代码库', '已知文件位置'],
  },
  metis: {
    canonicalRole: { coreRole: 'researcher', preset: 'analyst', confidence: 'high' },
    aliases: ['analyst', '/prompts:analyst', '/ccg:team-research'],
    category: 'advisor',
    cost: 'CHEAP',
    triggers: [{ domain: '预规划', trigger: '规划前分析请求，检测歧义和 AI-slop 风险' }],
  },
  momus: {
    canonicalRole: { coreRole: 'reviewer', preset: 'critic', confidence: 'high' },
    aliases: ['critic', '/prompts:critic', '/ccg:team-review'],
    category: 'advisor',
    cost: 'CHEAP',
    triggers: [{ domain: '审查', trigger: '工作计划审查，捕捉缺口、歧义和缺失上下文' }],
  },
  atlas: {
    canonicalRole: { coreRole: 'reviewer', preset: 'verifier', confidence: 'low' },
    aliases: ['verifier', '/prompts:verifier'],
    category: 'advisor',
    cost: 'EXPENSIVE',
    triggers: [{ domain: '验证', trigger: '编排验证，委派任务并验证完成证据' }],
  },
  'multimodal-looker': {
    canonicalRole: { coreRole: 'researcher', overlays: ['multimodal'], confidence: 'medium' },
    aliases: ['multimodal', 'ui-ux-designer'],
    category: 'utility',
    cost: 'CHEAP',
  },
  'sisyphus-junior': {
    canonicalRole: { coreRole: 'executor', preset: 'default', confidence: 'high' },
    aliases: ['junior'],
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
  | 'builtin'
  | 'installed'
  | 'configured'
  | 'runtime'
  | 'reference'
  | 'custom';

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
  note?: string;
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
  note?: string;
  enabled?: boolean;
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
  | { kind: 'start_work' };

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
    | 'pending'
    | 'running'
    | 'waiting'
    | 'cancel_requested'
    | 'completed'
    | 'failed'
    | 'cancelled';
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

export interface StreamTextChunk {
  type: 'text_delta';
  delta: string;
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

export interface StreamToolCallChunk {
  type: 'tool_call_delta';
  toolCallId: string;
  toolName: string;
  inputDelta: string;
  eventId?: string;
  runId?: string;
  occurredAt?: number;
}

export interface StreamDoneChunk {
  type: 'done';
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'error' | 'cancelled' | 'tool_permission';
  eventId?: string;
  runId?: string;
  occurredAt?: number;
}

export interface StreamErrorChunk {
  type: 'error';
  code: string;
  message: string;
  eventId?: string;
  runId?: string;
  occurredAt?: number;
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

export interface StreamPermissionAskedChunk {
  type: 'permission_asked';
  requestId: string;
  toolName: string;
  scope: string;
  reason: string;
  riskLevel: 'low' | 'medium' | 'high';
  previewAction?: string;
  eventId?: string;
  runId?: string;
  occurredAt?: number;
}

export interface StreamPermissionRepliedChunk {
  type: 'permission_replied';
  requestId: string;
  decision: 'once' | 'session' | 'permanent' | 'reject';
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
  effectiveDeadline?: number;
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

export type StreamChunk =
  | StreamTextChunk
  | StreamThinkingChunk
  | StreamToolCallChunk
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
  | StreamAuditRefChunk;

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
