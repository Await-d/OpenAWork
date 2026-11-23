export type MemoryType =
  'preference' | 'fact' | 'instruction' | 'project_context' | 'learned_pattern';

export type MemorySource = 'manual' | 'auto_extracted' | 'api';

export type MemoryRoleLayer = 'reception' | 'pm1' | 'pm2' | 'executor' | 'reviewer';

export interface MemoryEntry {
  id: string;
  userId: string;
  type: MemoryType;
  key: string;
  value: string;
  source: MemorySource;
  confidence: number;
  priority: number;
  workspaceRoot: string | null;
  teamWorkspaceId: string | null;
  /**
   * null 表示全部团队层级可读；数组表示只注入给指定团队层级。
   * 非团队记忆保持 null。
   */
  roleLayers: MemoryRoleLayer[] | null;
  enabled: boolean;
  /** 作用域。缺省 `{ type: 'user', id: userId }`（历史行为）。 */
  scope: MemoryScope;
  lifecycle: MemoryLifecycle;
  /** 版本号：每次确认后的内容变更 +1，用于冲突检测与回滚。 */
  revision: number;
  /** 记录变更来源：人工保存 or 提议确认。legacy 行为 null。 */
  confirmationKind: MemoryConfirmationKind | null;
  confirmedAt: string | null;
  /** 维护任务增量扫描水位。每次变更取全局自增。 */
  changeSeq: number;
  /** 到期后停止注入（需在原确认时说明）。 */
  validUntil: string | null;
  supersededBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMemoryInput {
  type: MemoryType;
  key: string;
  value: string;
  source?: MemorySource;
  confidence?: number;
  priority?: number;
  workspaceRoot?: string | null;
  teamWorkspaceId?: string | null;
  roleLayers?: MemoryRoleLayer[] | null;
  /**
   * 创建时的启用态，缺省为 `true`。
   *
   * 允许直接创建停用记忆（`enabled: false`）是必要的：`memories` 表有
   * `(user_id, type, key) WHERE enabled = 1` 唯一索引，「先创建启用再停用」在
   * 同键已存在启用记忆时会直接撞索引，无法表达「同键的停用记忆」。
   */
  enabled?: boolean;
  scope?: MemoryScope;
  /** 变更来源；由可信提交器设置，业务调用方不得用它绕过确认。 */
  confirmationKind?: MemoryConfirmationKind | null;
  confirmedAt?: string | null;
  validUntil?: string | null;
}

export interface UpdateMemoryInput {
  type?: MemoryType;
  key?: string;
  value?: string;
  source?: MemorySource;
  confidence?: number;
  priority?: number;
  workspaceRoot?: string | null;
  teamWorkspaceId?: string | null;
  roleLayers?: MemoryRoleLayer[] | null;
  enabled?: boolean;
  scope?: MemoryScope;
  lifecycle?: MemoryLifecycle;
  validUntil?: string | null;
  supersededBy?: string | null;
  /** 变更来源；由可信提交器设置。 */
  confirmationKind?: MemoryConfirmationKind | null;
  confirmedAt?: string | null;
  /** 乐观并发：期望的当前版本，不匹配则拒绝更新。 */
  expectedRevision?: number;
}

export interface MemoryListFilter {
  type?: MemoryType;
  source?: MemorySource;
  /** 作用域过滤；不传为「所有作用域」（仅供管理端列表使用）。 */
  scope?: MemoryScope;
  lifecycle?: MemoryLifecycle;
  workspaceRoot?: string | null;
  teamWorkspaceId?: string | null;
  roleLayer?: MemoryRoleLayer;
  enabled?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface MemoryStats {
  total: number;
  enabled: number;
  disabled: number;
  byType: Record<MemoryType, number>;
  bySource: Record<MemorySource, number>;
}

export interface MemoryInjectionConfig {
  enabled: boolean;
  maxTokenBudget: number;
  minConfidence: number;
  workspaceRoot: string | null;
  teamWorkspaceId?: string | null;
  roleLayer?: MemoryRoleLayer | null;
  /**
   * 允许注入的作用域键集合（`memoryScopeKey()` 产物）。
   *
   * `null` / `undefined` = 保持历史行为（按 workspace / team / roleLayer 过滤，
   * 供既有调用方与测试零改动使用）。数组 = 白名单语义：只注入命中集合的条目，
   * 渠道会话据此把 owner 个人记忆挡在上下文之外。
   */
  allowedScopes?: readonly string[] | null;
  /** 用于补全历史条目缺失的 user 作用域；不传则不参与作用域白名单判定。 */
  userId?: string;
}

export interface MemorySettings {
  enabled: boolean;
  autoExtract: boolean;
  maxTokenBudget: number;
  minConfidence: number;
  autoWriteMinConfidence: number;
  reviewLowConfidence: boolean;
  semanticMaintenance?: boolean;
}

export interface ExtractedMemoryCandidate {
  type: MemoryType;
  key: string;
  value: string;
  confidence: number;
}

export type MemoryCandidateDecisionStatus = 'persist' | 'review' | 'reject';

export type MemoryCandidateDecisionReason =
  | 'eligible'
  | 'empty_value'
  | 'low_confidence'
  | 'sensitive_information'
  | 'transient_context'
  | 'unsupported_type';

export interface MemoryCandidateDecision {
  candidate: ExtractedMemoryCandidate;
  status: MemoryCandidateDecisionStatus;
  reason: MemoryCandidateDecisionReason;
  detail: string;
}

export interface MemoryCandidatePersistencePolicy {
  autoWriteMinConfidence: number;
  reviewLowConfidence: boolean;
}

export interface MemoryExtractionLog {
  id: number;
  userId: string;
  sessionId: string;
  clientRequestId: string;
  extractedCount: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// 记忆治理（261101-记忆确认写入与周期整理）
//
// 正式记忆的每一次变更都必须经过「明确确认」。自动抽取 / 模型工具 / 团队初始化
// 一律只产生 `MemoryProposal`，由 `memory_proposals` 表承载，确认后才写入
// `memories`。这套类型是 gateway 治理模块与前端确认界面的公共契约。
// ---------------------------------------------------------------------------

/** 记忆作用域。正式条目与查重、唯一键、注入过滤都必须带作用域。 */
export type MemoryScopeType = 'user' | 'workspace' | 'team' | 'channel_chat';

export interface MemoryScope {
  type: MemoryScopeType;
  /**
   * 作用域实例标识：user 为用户 id，workspace 为规范化工作区路径，
   * team 为团队工作区 id，channel_chat 为 `memoryChannelScopeKey()` 的产物。
   */
  id: string;
}

/** 条目生命周期。归档不删除，可回滚。 */
export type MemoryLifecycle = 'active' | 'archived' | 'superseded';

/** 记录这条正式记忆是「人工点保存」还是「确认了一条提议」。 */
export type MemoryConfirmationKind = 'manual' | 'proposal';

export type MemoryProposalAction = 'create' | 'update' | 'archive' | 'restore' | 'merge' | 'rule';

export type MemoryProposalStatus =
  'pending' | 'applied' | 'rejected' | 'expired' | 'conflicted' | 'cancelled';

export type MemoryProposalOrigin =
  'auto_extract' | 'manual_extract' | 'tool' | 'team_init' | 'maintenance' | 'channel' | 'api';

/** 提议载荷。`rule` 动作用 `name` / `body`，其余动作用记忆字段。 */
export interface MemoryProposalPayload {
  type?: MemoryType;
  key?: string;
  value?: string;
  priority?: number;
  confidence?: number;
  roleLayers?: MemoryRoleLayer[] | null;
  workspaceRoot?: string | null;
  teamWorkspaceId?: string | null;
  enabled?: boolean;
  name?: string;
  body?: string;
  ruleId?: string;
  ruleRevision?: number;
  mergeIntoId?: string;
  dependencies?: Array<{ memoryId: string; revision: number }>;
}

export interface MemoryProposal {
  id: string;
  userId: string;
  action: MemoryProposalAction;
  scope: MemoryScope;
  targetMemoryId: string | null;
  expectedRevision: number | null;
  payload: MemoryProposalPayload;
  payloadDigest: string;
  reason: string | null;
  origin: MemoryProposalOrigin;
  confidence: number | null;
  status: MemoryProposalStatus;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  resultMemoryId: string | null;
  revision: number;
}

/** 入站渠道消息来源（在消息到达时冻结，不从会话最新 metadata 反推）。 */
export interface MemorySourceProvenance {
  platform: string;
  channelInstanceId: string;
  chatId: string;
  /** `private` | `group` | `unknown`；未知一律按 group 处理（更保守）。 */
  chatType: 'private' | 'group' | 'unknown';
  senderId: string | null;
  senderName: string | null;
  platformMessageId: string | null;
}

/** 提议在某个作用域内的重复/冲突关系，供界面展示与用户抉择。 */
export type MemoryProposalRelationKind = 'duplicate' | 'conflict' | 'supersedes';

export interface MemoryProposalRelation {
  kind: MemoryProposalRelationKind;
  memoryId: string;
  key: string;
  value: string;
}

export interface MemoryReviewDecisionRecord {
  userId: string;
  scope: MemoryScope;
  fingerprint: string;
  decision: 'rejected' | 'kept';
}

export interface MemoryRevisionRecord {
  id: string;
  memoryId: string;
  userId: string;
  revision: number;
  operation: 'create' | 'update' | 'archive' | 'restore' | 'merge';
  before: MemoryEntry | null;
  after: MemoryEntry | null;
  proposalId: string | null;
  actorKind: 'user' | 'maintenance';
  actorId: string | null;
  createdAt: string;
}

export type MemoryJobKind = 'daily_patrol' | 'weekly_semantic' | 'monthly_review';

export type MemoryJobStatus =
  'queued' | 'running' | 'succeeded' | 'retry_wait' | 'failed' | 'cancelled';

export interface MemoryMaintenanceJob {
  id: string;
  kind: MemoryJobKind;
  scopeKey: string;
  userId: string;
  status: MemoryJobStatus;
  dueAt: string;
  periodKey: string;
  attempts: number;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryMaintenanceSummary {
  kind: MemoryJobKind;
  scope: MemoryScope;
  checked: number;
  proposalsCreated: number;
  expiredProposals: number;
  duplicates: number;
  conflicts: number;
  transient: number;
  notes: string[];
}

/** 结构化渠道/项目规则。正规规则以 DB 为权威，文件发布本期关闭。 */
export interface MemoryRuleEntry {
  id: string;
  userId: string;
  scope: MemoryScope;
  name: string;
  body: string;
  revision: number;
  enabled: boolean;
  confirmedAt: string;
  createdAt: string;
  updatedAt: string;
}
