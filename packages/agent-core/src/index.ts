// 工具提示词模块
export * from './tools/prompts/index.js';

export type {
  MessageRole,
  TextContent,
  ToolCallContent,
  ToolResultContent,
  MessageContent,
  Message,
  StreamTextChunk,
  StreamToolCallChunk,
  StreamDoneChunk,
  StreamErrorChunk,
  StreamChunk,
  ApiError,
  TaskOwnership,
  TaskEntityRecord,
  TaskRunRecord,
  InteractionRecord,
  PlanTransitionRecord,
  SessionContextRecord,
  EventEnvelope,
  RunEventCursor,
} from '@openAwork/shared';

export { isRetryableError } from '@openAwork/shared';

export type {
  AgentStatus,
  IdleState,
  RunningState,
  ToolCallingState,
  RetryState,
  InterruptedState,
  ErrorState,
  AgentState,
  AgentEvent,
  ConversationSession,
  SessionCheckpoint,
} from './session/types.js';

export {
  createInitialState,
  transition,
  canTransition,
  isTerminal,
  isActive,
} from './workflow/state-machine.js';

export type { RetryOptions } from './error/retry.js';
export {
  DEFAULT_RETRY_OPTIONS,
  computeDelay,
  RetryAbortedError,
  RetryExhaustedError,
  withRetry,
  createCancellableTask,
} from './error/retry.js';

export type { ToolDefinition, ToolCallRequest, ToolCallResult } from './tools/tool-contract.js';
export {
  ToolValidationError,
  ToolNotFoundError,
  ToolTimeoutError,
  ToolRegistry,
} from './tools/tool-contract.js';
export { repairToolInput } from './tools/tool-input-repair.js';

// GUI Agent（computer-use）纯逻辑模块：坐标换算 / 动作类型 / Operator 接口 / 截图缩放。
// Phase 0 仅导出纯逻辑，平台实现由网关侧在 Phase 1 接入。
export * from './gui/index.js';

export type { SessionStore } from './session/session-store.js';
export { InMemorySessionStore, SessionNotFoundError } from './session/session-store.js';
export { SQLiteSessionStore } from './session/sqlite-session-store.js';

export type { AgentIgnoreManager, IgnoreRuleSet } from './filesystem/ignore.js';
export { createAgentIgnoreManager, defaultIgnoreManager } from './filesystem/ignore.js';
export {
  SYSTEM_DIRECTIVE_PREFIX,
  SystemDirectiveTypes,
  createSystemDirective,
  hasSystemReminder,
  isSystemDirective,
  removeSystemReminders,
} from './hooks/system-directive.js';

export { lspDiagnosticsTool, lspTouchTool, LSP_TOOLS } from './tools/lsp.js';
export type { LspToolMetadata, LspToolName } from './tools/lsp.js';
export {
  gotoDefinitionInputSchema,
  gotoImplementationInputSchema,
  findReferencesInputSchema,
  symbolsInputSchema,
  prepareRenameInputSchema,
  renameInputSchema,
  hoverInputSchema,
  callHierarchyInputSchema,
  lspGotoDefinitionMeta,
  lspGotoImplementationMeta,
  lspFindReferencesMeta,
  lspSymbolsMeta,
  lspPrepareRenameMeta,
  lspRenameMeta,
  lspHoverMeta,
  lspCallHierarchyMeta,
  LSP_RICHER_TOOL_METADATA,
  ALL_LSP_TOOL_NAMES,
  LSP_TOOL_USAGE_GUIDE,
  LSP_TOOLS_LIST,
} from './tools/lsp.js';
export {
  webSearchTool,
  WEB_SEARCH_TOOLS,
  searchMultiProvider,
  canonicaliseSearchUrl,
  type WebSearchMultiEntry,
  type WebSearchMultiConfig,
  type WebSearchRolloutMode,
  WEB_SEARCH_TOOL_USAGE_GUIDE,
  WEB_SEARCH_TOOLS_LIST,
  WEB_SEARCH_PROVIDERS,
} from './tools/web-search.js';
export * from './tools/hash-edit.js';
export type { LintResult } from './tools/post-write-lint.js';
export { lintFile, lintFiles, formatLintFeedback } from './tools/post-write-lint.js';
export {
  POST_WRITE_LINT_USAGE_GUIDE,
  POST_WRITE_LINT_TOOLS_LIST,
} from './tools/prompts/lint-prompt.js';

export type {
  WorkspacePermissionAction,
  PermissionCategoryMeta,
  WorkspacePermissionConfig,
  WorkspacePermissionRule,
} from './permission/workspace-permission-config.js';
export {
  WORKSPACE_PERMISSION_FILE,
  evaluateWorkspacePermissionRules,
  hasWorkspacePersistentPermission,
  listEffectiveWorkspacePermissionRules,
  loadWorkspacePermissionConfig,
  loadWorkspacePermissionRules,
  resolveWorkspacePermissionAction,
  upsertWorkspacePermanentPermission,
  wildcardMatch,
  PERMISSION_CATEGORIES,
  resolvePermissionCategory,
  writeWorkspacePermissionConfig,
} from './permission/workspace-permission-config.js';

export {
  ALLOW_BY_DEFAULT_TOOL_NAMES,
  TOOL_TO_PERMISSION_CATEGORY,
} from './permission/tool-category-map.js';

export type { SessionPermissionMode } from './permission/session-permission-mode.js';
export {
  AUTO_EDIT_EXCLUDED_TOOLS,
  AUTO_EDIT_PERMISSION_CATEGORIES,
  resolveSessionPermissionMode,
} from './permission/session-permission-mode.js';

export type {
  BrowserPermissionLevel,
  TrustedDomain,
  BrowserPermissionManager,
  ScreenshotFeedback,
  BrowserAction,
  BrowserActionResult,
  BrowserAutomationTool,
} from './browser/index.js';
export { BrowserPermissionManagerImpl, BrowserAutomationToolImpl } from './browser/index.js';

export type {
  CompactionStrategy,
  ContextCompactor,
  ContextCompactorOptions,
} from './context/compact.js';
export {
  createContextCompactor,
  AUTO_COMPACT_THRESHOLD,
  COMPACT_TARGET_RATIO,
} from './context/compact.js';

export {
  buildClarificationQuestions,
  evaluate,
  recordClarification,
  canProceedWithoutClarification,
  createSessionContext,
  isSubAgentPrompt,
  buildSubAgentPrompt,
  SUB_AGENT_PROMPT_PREFIX,
} from './context/routing.js';
export type {
  RouteLevel,
  RoutingDimensions,
  RoutingDecision,
  ClarificationQuestion,
  ClarificationDimension,
  SessionContext,
} from './context/routing.js';

export {
  applyAnswer,
  buildConfirmNode,
  computeFrontier,
  computeNodeStatus,
  confirmGrill,
  CONFIRM_ANSWER,
  CONFIRM_AFFIRMATIVE_PATTERN,
  CONFIRM_NODE_ID,
  createGrillState,
  GRILL_MAX_ROUNDS,
  grillRejectionCount,
  isConfirmAffirmative,
  isFrontierEmpty,
  isGrillExhausted,
  listConsensusItemIds,
  needsConfirmation,
  parseGrillState,
  parseMultiGrillReply,
  REJECT_ANSWER,
  seedGrillState,
  serializeGrillState,
} from './context/clarification-tree.js';
export type {
  ClarificationNode,
  ClarificationNodeOption,
  ClarificationNodeStatus,
  GrillAmbiguityReason,
  GrillHistoryEntry,
  GrillMultiAnswerParse,
  GrillRejection,
  GrillSeedOptions,
  GrillState,
} from './context/clarification-tree.js';

export {
  findRecommendedOption,
  normalizeRecommendedOptions,
} from './context/clarification-recommendation.js';

export type {
  ProviderType,
  ThinkingConfig,
  RequestOverrides,
  OAuthConfig,
  AIModelConfig,
  AIProvider,
  ActiveSelection,
  ProviderConfig,
  ProviderManager,
} from './provider/types.js';
export {
  BUILTIN_PROVIDER_TYPES,
  getAllBuiltinPresets,
  getBuiltinProviderPreset,
} from './provider/presets.js';
export {
  PROVIDER_CATALOG,
  getCatalogEntry,
  getDefaultUpstream,
  resolveThinkingStyle,
  catalogModelSupportsThinking,
  inferProviderTypeFromHostname,
  normalizeProviderAlias,
  inferProviderLabelFromModelId,
  getProviderDisplayName,
  getProviderCatalogUi,
} from './provider/catalog.js';
export type {
  ProviderCatalogEntry,
  ProviderUpstreamVariant,
  ProviderUiMeta,
  ProviderThinkingStyle,
  ProviderCatalogUiEntry,
  CatalogUpstreamProtocol,
} from './provider/catalog.js';
export { ProviderManagerImpl } from './provider/manager.js';
export {
  get as getModelsDevData,
  getSync as getModelsDevDataSync,
  refresh as refreshModelsDevData,
  refreshOrThrow as refreshModelsDevDataOrThrow,
  startPeriodicRefresh as startModelsDevRefresh,
  stopPeriodicRefresh as stopModelsDevRefresh,
  mapModelsDevModel,
  resolveModelsDevProvider,
} from './provider/models-dev.js';
export type { ModelsDevData, ModelsDevProvider, ModelsDevModel } from './provider/models-dev.js';
export {
  get as getCanonicalModelsData,
  getSync as getCanonicalModelsDataSync,
  refresh as refreshCanonicalModelsData,
} from './provider/canonical-models.js';
export type { CanonicalModelsData, CanonicalModelEntry } from './provider/canonical-models.js';
export {
  applyCanonicalModelAliases,
  buildCanonicalAliasIndex,
  deriveCanonicalLab,
  isOfficialProviderHost,
  resolveCanonicalModelId,
} from './provider/canonical-alias.js';
export type { CanonicalAliasIndex } from './provider/canonical-alias.js';
export type { OAuthFlowManager, OAuthTokens, PlatformOAuthAdapter } from './provider/oauth.js';
export { OAuthFlowManagerImpl } from './provider/oauth.js';
export type { ProviderPersistenceAdapter } from './provider/persistence.js';
export { InMemoryPersistenceAdapter } from './provider/persistence.js';
export {
  normalizeProviderBaseUrl,
  mergeBuiltinModels,
  buildRequestOverrides,
  calculateTokenCost,
  calculateTokenUsageCost,
  MAX_PRICE_PER_MILLION,
  MAX_USAGE_TOKENS,
  normalizeOptionalTokenPrice,
  normalizeTokenCount,
} from './provider/utils.js';
export type { TokenUsageCostInput } from './provider/utils.js';
export * from './oauth/index.js';

export type { StreamCheckpoint, StreamRecoveryManager } from './stream/recovery.js';
export { createStreamRecoveryManager } from './stream/recovery.js';

export type {
  AgentErrorCategory,
  AgentError,
  ErrorAction,
  ErrorActionType,
} from './error/index.js';
export {
  createAgentError,
  classifyHttpError,
  classifyNetworkError,
  formatRetryMessage,
} from './error/index.js';

export type { AuditEntry, AuditEntryType, AuditLogFilter, AuditLogManager } from './audit/index.js';
export { createInMemoryAuditLogManager } from './audit/index.js';

export type { PlanStatus, Plan, PlanManager } from './plan/index.js';
export { PlanManagerImpl } from './plan/index.js';

export type { AppSettings, SettingsManager } from './settings/index.js';
export { DEFAULT_SETTINGS, SettingsManagerImpl } from './settings/index.js';

export type { ProviderQuota, QuotaManager } from './quota/index.js';
export { QuotaManagerImpl } from './quota/index.js';

export type { ContextItemType, ContextItem, ContextManager } from './context/index.js';
export { ContextManagerImpl } from './context/index.js';

export type { ModelEntry, CatwalkRegistry, CatwalkOptions } from './catwalk/index.js';
export { CatwalkRegistryImpl } from './catwalk/index.js';

export type {
  ContextTransferStatus,
  ModelSwitchRecord,
  ModelSwitchManager,
} from './model-switcher/index.js';
export { ModelSwitchManagerImpl } from './model-switcher/index.js';

export type { CrushIgnoreManager } from './crush-ignore/index.js';
export { CrushIgnoreManagerImpl } from './crush-ignore/index.js';

export type {
  AttributionStyle,
  AttributionConfig,
  AttributionManager,
} from './attribution/index.js';
export { AttributionManagerImpl, DEFAULT_ATTRIBUTION_CONFIG } from './attribution/index.js';

export type {
  SlashCommand,
  SlashCommandHandler,
  SlashCommandRouter,
  HandoffDocument,
} from './slash-command/index.js';
export {
  SlashCommandRouterImpl,
  buildHandoffDocument,
  formatHandoffMarkdown,
} from './slash-command/index.js';

export type {
  PlanStepStatus,
  PlanStep,
  ToolCallRecord,
  TaskPlan,
  TaskPlanEvent,
  TaskPlanEventHandler,
  TaskPlanManager,
} from './plan/index.js';
export { TaskPlanManagerImpl } from './plan/index.js';

export type { PluginHooks, Plugin, PluginLifecycleManager } from './plugin/index.js';
export type {
  PluginManifestVersion,
  PluginPermission,
  PluginManifest,
  PluginManifestValidator,
} from './plugin/index.js';
export { PluginLifecycleManagerImpl, PluginManifestValidatorImpl } from './plugin/index.js';

// worker 子系统当前尚未接入 services/agent-gateway（仓库内零消费者）：
// 这里仅为未来使用保留导出，不代表云 worker / 沙箱能力已可用；
// 缺少协议规格时云 worker 连接会直接抛错，不会伪造成功状态。
// CloudWorkerTransport 为未来注入云 worker 远端传输的接口类型。
export type {
  WorkerStatus,
  WorkerMode,
  WorkerInfo,
  WorkerSession,
  WorkerLaunchConfig,
  WorkerSessionManager,
  SandboxConfig,
  WorkerManager,
  CloudWorkerTransport,
} from './worker/index.js';
export { WorkerManagerImpl, createWorkerSessionManager } from './worker/index.js';

export type {
  CLICommand,
  CLICommandResult,
  OrchestratorCLI,
  DaemonConfig,
  DaemonManager,
} from './orchestrator-cli/index.js';
export { OrchestratorCLIImpl, DaemonManagerImpl } from './orchestrator-cli/index.js';

export type { ScheduleKind, ScheduledTask, ScheduleManager } from './schedule/index.js';
export { ScheduleManagerImpl } from './schedule/index.js';

export type {
  TokenUsageRecord,
  MonthlyUsageSummary,
  TokenUsageManager,
} from './token-usage/index.js';
export { TokenUsageManagerImpl } from './token-usage/index.js';

export * from './task-system/index.js';

export type {
  WorkflowNodeType,
  WorkflowVariable,
  WorkflowNode,
  WorkflowEdge,
  WorkflowTemplate,
  WorkflowExecution,
  WorkflowTemplateManager,
} from './workflow/types.js';
export { WorkflowTemplateManagerImpl } from './workflow/types.js';

export type { WorkflowEngine } from './workflow/engine.js';
export { WorkflowEngineImpl } from './workflow/engine.js';
export {
  PromptOptimizerError,
  PromptOptimizerImpl,
  PromptOptimizerResultParseError,
  PromptOptimizerUpstreamError,
  type PromptOptimizer,
  type PromptOptimizerErrorKind,
  type PromptOptimizerOptions,
  type PromptOptimizerResult,
  type PromptCandidate,
} from './workflow/prompt-optimizer.js';
export {
  TranslationWorkflowImpl,
  type TranslationWorkflow,
  type TranslationTask,
  type TranslationResult,
  type TranslationStatus,
} from './workflow/translation-workflow.js';

export type { AttachmentType, Attachment, MultimodalInputManager } from './multimodal/index.js';
export { MultimodalInputManagerImpl } from './multimodal/index.js';

export type { ChunkOptions, FileChunk, FileChunker } from './multimodal/chunker.js';
export { FileChunkerImpl } from './multimodal/chunker.js';

export * from './security/index.js';
export * from './hooks/keyword-detector.js';
export * from './hooks/runtime-fallback.js';
export * from './hooks/directory-agents-injector.js';
export * from './agent-viz/index.js';
export * from './ralph-loop/index.js';
export * from './cli/index.js';

export {
  SSHConnectionManagerImpl,
  type SSHConnection,
  type ExecResult,
  type SSHExecOptions,
  type SSHFileBytes,
  type SSHFileEntry,
  type SSHFilePreview,
  type SSHConnectionManager,
} from './ssh/ssh-connection-manager.js';
export type { SSHBoundSession, SSHToolProxy } from './ssh/ssh-session-binding.js';
export {
  createSSHToolProxy,
  SSHSessionBindingRegistry,
  sshSessionBindings,
} from './ssh/ssh-session-binding.js';

export type {
  MemoryType,
  MemorySource,
  MemoryRoleLayer,
  MemoryEntry,
  CreateMemoryInput,
  UpdateMemoryInput,
  MemoryListFilter,
  MemoryStats,
  MemoryInjectionConfig,
  MemorySettings,
  ExtractedMemoryCandidate,
  MemoryCandidateDecision,
  MemoryCandidateDecisionReason,
  MemoryCandidateDecisionStatus,
  MemoryCandidatePersistencePolicy,
  MemoryExtractionLog,
  DeduplicationResult,
} from './memory/index.js';
export {
  MEMORY_TYPES,
  MEMORY_SOURCES,
  MEMORY_ROLE_LAYERS,
  memoryTypeSchema,
  memorySourceSchema,
  memoryRoleLayerSchema,
  memoryRoleLayersSchema,
  createMemorySchema,
  updateMemorySchema,
  memoryListQuerySchema,
  memorySettingsSchema,
  DEFAULT_MEMORY_SETTINGS,
  MEMORY_SETTINGS_KEY,
  estimateTokenCount,
  parseMemorySettings,
  normalizeMemoryKey,
  deduplicateMemories,
  buildMemoryInjectionBlock,
  extractMemoriesFromText,
  evaluateMemoryCandidateForPersistence,
} from './memory/index.js';

// 跨平台 Shell 执行
export type { Platform } from './utils/platform.js';
export {
  getPlatform,
  getWslVersion,
  isWindowsEnvironment,
  supportsPosixShell,
} from './utils/platform.js';

export type {
  ShellType,
  ShellProvider,
  ShellExecOptions,
  ShellCommandResult,
  ShellExecuteOptions,
  ShellExecuteResult,
} from './utils/shell/index.js';
export {
  createBashShellProvider,
  createPowerShellProvider,
  buildPowerShellArgs,
  findSuitableShell,
  findPowerShell,
  isPowerShellAvailable,
  executeShellCommand,
  getDefaultShellType,
  resetProviderCache,
} from './utils/shell/index.js';
export { SSHTerminalError, type SSHTerminalOptions } from './ssh/ssh-terminal.js';
export { SSHConnectionError, type SSHConnectionEvent } from './ssh/ssh-connection-events.js';
