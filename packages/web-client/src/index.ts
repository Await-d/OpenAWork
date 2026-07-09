// allow: SIZE_OK — package barrel export surface; entries are intentionally centralized.
export { GatewayWebSocketClient } from './gateway/gateway-ws.js';
export { GatewaySSEClient } from './gateway/gateway-sse.js';
export { login, refreshAccessToken, logout } from './gateway/auth.js';
export type { TokenPair } from './gateway/auth.js';
export { getPairingQr, loginWithDesktopDefault, loginWithPairingToken } from './gateway/pairing.js';
export type { PairingQrResponse } from './gateway/pairing.js';
export type {
  GatewayStreamEvent,
  StreamChunkHandler,
  StreamEventHandler,
  SendMessageOptions,
} from './gateway/gateway-ws.js';
export { createCommandsClient } from './session/commands.js';
export type { CommandsClient } from './session/commands.js';
export { createNotificationsClient } from './infra/notifications.js';
export type {
  NotificationPreferenceChannel,
  NotificationPreferenceEventType,
  NotificationPreferenceRecord,
  NotificationRecord,
  NotificationsClient,
} from './infra/notifications.js';
export { createCapabilitiesClient } from './session/capabilities.js';
export type { CapabilitiesClient, CapabilitiesListResult } from './session/capabilities.js';
export { RESOURCE_USAGE_DEFAULTS, createResourcesClient } from './session/resources.js';
export type {
  ResourceAgentCatalogEntry,
  ResourceCatalog,
  ResourceCatalogEntry,
  ResourceCommandCatalogEntry,
  ResourceArea,
  ResourceExtensionCatalogEntry,
  ResourceFeature,
  ResourceIntegrationMode,
  ResourceMcpCatalogEntry,
  ResourcesClient,
  ResourcesListResult,
  ResourceSkillCatalogEntry,
  ResourceTextCatalogEntry,
  ResourceUsageKind,
  ResourceVisibility,
  UploadResourceInput,
} from './session/resources.js';
export { createAgentsClient } from './session/agents.js';
export type { AgentsClient, AgentsListResult } from './session/agents.js';
export { createTeamClient } from './team/team.js';
export type {
  CreateTeamSessionInput,
  CreateTeamThreadInput,
  ImportTeamWorkspaceSessionInput,
  TeamSessionTemplateSourceKind,
  CreateTeamWorkspaceInput,
  CreateTeamMemberInput,
  CreateTeamMessageInput,
  CreateTeamSessionShareInput,
  CreateTeamTaskInput,
  TeamAuditLogRecord,
  TeamClient,
  TeamMemberRecord,
  TeamMemberSlotInput,
  TeamMessageRecord,
  TeamRuntimeReadModel,
  TeamRuntimeLoadResult,
  TeamRuntimeDiagnostics,
  TeamRuntimeAlertControlActionResult,
  TeamRuntimeAlertControlRecord,
  TeamRuntimeReconcileStaleThreadsResult,
  TeamRuntimePauseAllResult,
  TeamRuntimeResumeAllResult,
  TeamRuntimeRoleInstanceRecord,
  TeamRuntimeTaskGroupRecord,
  TeamRuntimeSessionRecord,
  TeamToolCallRecord,
  TeamUsageRecord,
  SharedSessionDetailLoadResult,
  SharedSessionPresenceLoadResult,
  TeamWorkspaceDetailLoadResult,
  TeamWorkspaceListLoadResult,
  TeamWorkspaceSnapshotLoadResult,
  TeamInitActionResult,
  TeamSessionShareRecord,
  TeamTaskRecord,
  TeamWorkspaceDetail,
  TeamWorkspaceSnapshot,
  TeamWorkspaceSummary,
  TeamWorkspaceVisibility,
  UpdateTeamWorkspaceInput,
  UpdateTeamTaskInput,
} from './team/team.js';
export { createTeamPhaseAClient } from './team/team-phase-a.js';
export type {
  AgentPersonaRecord,
  ConstitutionRecord,
  ConstitutionLoadResult,
  ConstitutionTemplate,
  ConstitutionTemplatesLoadResult,
  ConvergeDeviation,
  ConvergeResult,
  DefaultSoul,
  ForceApplyStateLoadResult,
  ForceApplyState,
  InstructionStackPreviewLoadResult,
  InstructionStackPreview,
  LayerCapabilitySummary,
  LayerToolsetCategory,
  LayerCapabilitiesLoadResult,
  PersonaLoadResult,
  MemoryWriteBlocked,
  PersonaResponse,
  RateLimited,
  SoulRoleLayer,
  TeamArtifactsListResult,
  TeamPhaseAClient,
  TeamWorkspaceKnowledgeListResult,
  TeamWorkspaceKnowledgeRecord,
  TeamWorkspaceKnowledgeRoleLayer,
  TeamWorkspaceKnowledgeSource,
  TeamWorkspaceKnowledgeType,
  UpsertTeamWorkspaceKnowledgeInput,
  UpsertTeamWorkspaceKnowledgeResult,
  UserMemoryLoadResult,
  UserMemoryRecord,
  VersionConflict,
} from './team/team-phase-a.js';
export { createWorkflowsClient } from './infra/workflows.js';
export type {
  AssignTeamModelCandidate,
  AssignTeamModelsInput,
  AssignTeamModelsResult,
  CreateWorkflowTemplateInput,
  OptimizePromptInput,
  PromptCandidate,
  PromptOptimizerResult,
  TranslationResult,
  TranslationTaskInput,
  UpdateWorkflowTemplateInput,
  WorkflowTemplateMetadata,
  WorkflowTeamTemplateMetadata,
  WorkflowTeamTemplateModelRef,
  WorkflowTeamTemplateModelStrategy,
  WorkflowTeamTemplateRoleBinding,
  WorkflowTemplateRequiredRole,
  WorkflowTemplateScale,
  WorkflowEdgeRecord,
  WorkflowNodeRecord,
  WorkflowTemplateListResult,
  WorkflowTemplateRecord,
  WorkflowsClient,
} from './infra/workflows.js';
export { createPermissionsClient } from './session/permissions.js';
export type {
  CreatePermissionRequestPayload,
  PendingPermissionRequest,
  PermissionDecision,
  PermissionReplyPayload,
  PermissionRequestBase,
  PermissionsClient,
} from './session/permissions.js';
export {
  createPendingPermissionRequestSnapshot,
  dedupePendingPermissionRequests,
  findFirstPendingPermission,
  isPendingPermissionRequest,
  toPendingPermissionRequests,
} from './session/permissions.js';
export { createQuestionsClient } from './session/questions.js';
export type {
  PendingQuestionItem,
  PendingQuestionOption,
  PendingQuestionRequest,
  QuestionsClient,
} from './session/questions.js';
export { createSessionsClient, createMultiAttachStream } from './session/sessions.js';
export { getSessionWorkflowRuntime } from './session/workflow-runtime.js';
export type { SessionWorkflowRuntimeSource } from './session/workflow-runtime.js';
export type {
  DeleteSessionBlockReason,
  DeleteSessionErrorData,
  DeleteSessionResult,
  MultiAttachCallbacks,
  Session,
  SessionActiveStream,
  SessionBackupRestorePreviewResult,
  SessionFileBackupTarget,
  SessionFileChangesProjection,
  SessionFileChangesQueryOptions,
  SessionFileChangesSummary,
  SessionFileDiffEntry,
  SessionImportInput,
  SessionImportResult,
  SessionMessageRatingRecord,
  SessionMessageRatingValue,
  SessionLoadResult,
  SessionRecoveryReadModel,
  SessionRecoveryLoadResult,
  SessionStatusReadModel,
  SessionRestoreApplyInput,
  SessionRestoreApplyResult,
  SessionSearchResult,
  SessionRestoreHashValidation,
  SessionRestorePreviewInput,
  SessionRestorePreviewResult,
  SessionRestoreWorkspaceConflict,
  SessionRestoreWorkspaceReview,
  SessionSnapshot,
  SessionSnapshotCompareOptions,
  SessionSnapshotComparisonEntry,
  SessionSnapshotComparisonResult,
  SessionSnapshotQueryOptions,
  SessionSnapshotRestorePreviewDiff,
  SessionSnapshotRestorePreviewResult,
  SessionSnapshotScopeKind,
  SharedSessionCommentRecord,
  SharedSessionCommentActionResult,
  SharedSessionDetailActionResult,
  SharedSessionDetailRecord,
  SharedSessionPermission,
  SharedSessionPresenceRecord,
  SharedSessionSummaryRecord,
  SessionTask,
  SessionTodo,
  SessionTodoLanes,
  SessionTurnDiffFileSummary,
  SessionTurnDiffReadModel,
  SessionsClient,
  SessionsListOptions,
} from './session/sessions.js';
export { withTokenRefresh } from './gateway/token-refresh.js';
export type { TokenStore } from './gateway/token-refresh.js';
export { authHeader, jsonAuthHeaders, HttpError } from './gateway/http.js';

// 新增的资源域客户端
export { createWorkspaceClient } from './infra/workspace.js';
export type {
  FileTreeNode,
  WorkspaceClient,
  WorkspaceFileContent,
  WorkspaceRootsLoadResult,
  WorkspaceReviewChange,
  WorkspaceReviewDiffResponse,
  WorkspaceReviewStatusLoadResult,
  WorkspaceReviewStatusResponse,
  WorkspaceRootsResponse,
  WorkspaceSearchHit,
  WorkspaceTreeLoadResult,
  WorkspaceValidateResult,
  SessionWorkspaceUpdateResponse,
} from './infra/workspace.js';

export { createUsageClient } from './infra/usage.js';
export type {
  UsageBreakdownResponse,
  UsageClient,
  UsageCostBreakdownItem,
  UsageMonthlyRecord,
  UsageRecordsResponse,
} from './infra/usage.js';

export { createCronClient } from './infra/cron.js';
export type { CronClient, CronJobRecord, CronJobsResponse } from './infra/cron.js';

export { createHealthClient, isGatewayHealthy } from './infra/health.js';
export type { HealthClient } from './infra/health.js';

export { createDesktopAutomationClient } from './infra/desktop-automation.js';
export type {
  DesktopAutomationClient,
  DesktopAutomationContentResult,
  DesktopAutomationScrollDirection,
  DesktopAutomationScreenshotResult,
  DesktopAutomationSnapshot,
  DesktopAutomationSnapshotResult,
  DesktopAutomationStatus,
  DesktopAutomationWaitInput,
} from './infra/desktop-automation.js';

export { createDesktopControlClient } from './infra/desktop-control.js';
export type {
  DesktopControlActionResult,
  DesktopControlCapabilities,
  DesktopControlCapability,
  DesktopControlClickAction,
  DesktopControlClickInput,
  DesktopControlClient,
  DesktopControlHotkeyInput,
  DesktopControlKeyInput,
  DesktopControlMouseButton,
  DesktopControlScreenshotInput,
  DesktopControlScrollInput,
  DesktopControlStatus,
  DesktopControlTypeInput,
  DesktopControlWaitInput,
} from './infra/desktop-control.js';

export { createSshClient } from './infra/ssh.js';
export type {
  CreateSSHConnectionInput,
  SSHBindingEntry,
  SSHDialogEntry,
  SSHClient,
  SSHConnectionEntry,
  SSHFileEntry,
  SSHFilePreview,
  UpdateSSHConnectionInput,
  UpsertSSHDialogInput,
} from './infra/ssh.js';

export { createGitHubClient } from './infra/github.js';
export type { CreateGitHubTriggerInput, GitHubClient, GitHubTrigger } from './infra/github.js';

export { createChannelsClient } from './infra/channels.js';
export type {
  ChannelConversationSummary,
  ChannelConversationsResponse,
  ChannelDescriptorListResponse,
  ChannelListResponse,
  ChannelMutationResponse,
  ChannelTargetsResponse,
  ChannelsClient,
} from './infra/channels.js';

export { createArtifactsClient } from './infra/artifacts.js';
export type {
  ArtifactSessionArtifactsResponse,
  ArtifactVersionsResponse,
  ArtifactsClient,
  CreateArtifactInput,
  ImageGenerationInput,
  RevertArtifactInput,
  UpdateArtifactInput,
  UploadSessionArtifactInput,
} from './infra/artifacts.js';

export { createSessionTerminalsClient } from './session/session-terminals.js';
export type {
  ListSessionTerminalsOptions,
  SessionTerminalView,
  SessionTerminalsClient,
} from './session/session-terminals.js';

export { createTeamRuntimeClient } from './team/team-runtime.js';
export type {
  InteractionAgentRewriteRequest,
  InteractionAgentRewriteResponse,
  TeamLeaderDispatchRequest,
  TeamLeaderDispatchResponse,
  TeamLeaderDispatchedTask,
  TeamLeaderRosterMember,
  TeamRuntimeClient,
} from './team/team-runtime.js';

export { createTeamInboundClient } from './team/team-inbound.js';
export type {
  CancelSignalPayload,
  ClarificationAnswerPayload,
  EscalationRequestPayload,
  InboundMessageType,
  InboundPayloadByType,
  InboundSubmitRequest,
  InboundSubmitResponse,
  PauseSignalPayload,
  ProgressReportPayload,
  TeamInboundClient,
  UserInputPayload,
} from './team/team-inbound.js';

export {
  createTeamHandoffsClient,
  getEffectiveReviewDisposition,
  getStructuredReviewDisposition,
  inferReviewDispositionFromFailureReason,
  isHandledReviewDispositionPayload,
} from './team/team-handoffs.js';
export type {
  HandoffCancelResult,
  HandoffControlResult,
  HandoffRecord,
  HandoffPauseResult,
  HandoffReviewDisposition,
  HandoffReviewDispositionStatus,
  HandoffReviewAction,
  HandoffReviewActionResult,
  HandoffRoleLayer,
  HandoffResumeResult,
  HandoffState,
  TeamHandoffListBySessionResult,
  TeamHandoffsClient,
} from './team/team-handoffs.js';

export { createTeamWorkflowsClient } from './team/team-workflows.js';
export type {
  CreateTeamWorkflowResponse,
  TeamWorkflow,
  TeamWorkflowsListResult,
  TeamWorkflowsClient,
  TeamWorkflowWithDbId,
  UpdateTeamWorkflowResponse,
  WorkflowGate,
  WorkflowRoleLayer,
  WorkflowSource,
  WorkflowStep,
} from './team/team-workflows.js';

export { createSettingsClient } from './infra/settings.js';
export type { SettingsClient, SettingsProvidersLoadResult } from './infra/settings.js';

export { createSkillsClient } from './infra/skills.js';
export type { SkillsClient } from './infra/skills.js';

export { createMemoriesClient } from './infra/memories.js';
export type { MemoriesClient } from './infra/memories.js';

export { createPromptSnippetsClient } from './infra/prompt-snippets.js';
export type {
  CreateGroupInput,
  CreateSnippetInput,
  PromptSnippet,
  PromptSnippetGroup,
  PromptSnippetsClient,
  UpdateGroupInput,
  UpdateSnippetInput,
} from './infra/prompt-snippets.js';

export { createSnapshotTreesClient } from './session/snapshot-trees.js';
export type {
  RestoreApplyResult,
  RestorePreviewFile,
  RestorePreviewResult,
  RestoreResult,
  SnapshotTreeChainNode,
  SnapshotTreeDetail,
  SnapshotTreeEntry,
  SnapshotTreeFileEntry,
  SnapshotTreeScopeKind,
  SnapshotTreesClient,
} from './session/snapshot-trees.js';
