export { GatewayWebSocketClient } from './gateway-ws.js';
export { GatewaySSEClient } from './gateway-sse.js';
export { login, refreshAccessToken, logout } from './auth.js';
export type { TokenPair } from './auth.js';
export { getPairingQr, loginWithDesktopDefault, loginWithPairingToken } from './pairing.js';
export type { PairingQrResponse } from './pairing.js';
export type {
  GatewayStreamEvent,
  StreamChunkHandler,
  StreamEventHandler,
  SendMessageOptions,
} from './gateway-ws.js';
export { createCommandsClient } from './commands.js';
export type { CommandsClient } from './commands.js';
export { createNotificationsClient } from './notifications.js';
export type {
  NotificationPreferenceChannel,
  NotificationPreferenceEventType,
  NotificationPreferenceRecord,
  NotificationRecord,
  NotificationsClient,
} from './notifications.js';
export { createCapabilitiesClient } from './capabilities.js';
export type { CapabilitiesClient } from './capabilities.js';
export { createAgentsClient } from './agents.js';
export type { AgentsClient } from './agents.js';
export { createTeamClient } from './team.js';
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
  TeamMessageRecord,
  TeamRuntimeReadModel,
  TeamRuntimeTaskGroupRecord,
  TeamRuntimeSessionRecord,
  TeamSessionShareRecord,
  TeamTaskRecord,
  TeamWorkspaceDetail,
  TeamWorkspaceSnapshot,
  TeamWorkspaceSummary,
  TeamWorkspaceVisibility,
  UpdateTeamWorkspaceInput,
  UpdateTeamTaskInput,
} from './team.js';
export { createTeamPhaseAClient } from './team-phase-a.js';
export type {
  AgentPersonaRecord,
  ConstitutionRecord,
  ConstitutionTemplate,
  DefaultSoul,
  ForceApplyState,
  InstructionStackPreview,
  MemoryWriteBlocked,
  PersonaResponse,
  RateLimited,
  SoulRoleLayer,
  TeamPhaseAClient,
  UserMemoryRecord,
  VersionConflict,
} from './team-phase-a.js';
export { createWorkflowsClient } from './workflows.js';
export type {
  CreateWorkflowTemplateInput,
  OptimizePromptInput,
  PromptCandidate,
  PromptOptimizerResult,
  TranslationResult,
  TranslationTaskInput,
  UpdateWorkflowTemplateInput,
  WorkflowTemplateMetadata,
  WorkflowTeamTemplateMetadata,
  WorkflowTemplateRequiredRole,
  WorkflowTemplateScale,
  WorkflowEdgeRecord,
  WorkflowNodeRecord,
  WorkflowTemplateRecord,
  WorkflowsClient,
} from './workflows.js';
export { createPermissionsClient } from './permissions.js';
export type {
  CreatePermissionRequestPayload,
  PendingPermissionRequest,
  PermissionDecision,
  PermissionReplyPayload,
  PermissionRequestBase,
  PermissionsClient,
} from './permissions.js';
export {
  createPendingPermissionRequestSnapshot,
  dedupePendingPermissionRequests,
  findFirstPendingPermission,
  isPendingPermissionRequest,
  toPendingPermissionRequests,
} from './permissions.js';
export { createQuestionsClient } from './questions.js';
export type {
  PendingQuestionItem,
  PendingQuestionOption,
  PendingQuestionRequest,
  QuestionsClient,
} from './questions.js';
export { createSessionsClient } from './sessions.js';
export type {
  DeleteSessionBlockReason,
  DeleteSessionErrorData,
  DeleteSessionResult,
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
  SessionRecoveryReadModel,
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
} from './sessions.js';
export { withTokenRefresh } from './token-refresh.js';
export type { TokenStore } from './token-refresh.js';
export { authHeader, jsonAuthHeaders, HttpError } from './http.js';

// 新增的资源域客户端
export { createWorkspaceClient } from './workspace.js';
export type {
  FileTreeNode,
  WorkspaceClient,
  WorkspaceFileContent,
  WorkspaceReviewChange,
  WorkspaceReviewDiffResponse,
  WorkspaceReviewStatusResponse,
  WorkspaceRootsResponse,
  WorkspaceSearchHit,
  WorkspaceValidateResult,
  SessionWorkspaceUpdateResponse,
} from './workspace.js';

export { createUsageClient } from './usage.js';
export type {
  UsageBreakdownResponse,
  UsageClient,
  UsageCostBreakdownItem,
  UsageMonthlyRecord,
  UsageRecordsResponse,
} from './usage.js';

export { createCronClient } from './cron.js';
export type { CronClient, CronJobRecord, CronJobsResponse } from './cron.js';

export { createHealthClient, isGatewayHealthy } from './health.js';
export type { HealthClient } from './health.js';

export { createDesktopAutomationClient } from './desktop-automation.js';
export type {
  DesktopAutomationClient,
  DesktopAutomationScreenshotResult,
  DesktopAutomationStatus,
} from './desktop-automation.js';

export { createSshClient } from './ssh.js';
export type {
  CreateSSHConnectionInput,
  SSHClient,
  SSHConnectionEntry,
  SSHFileEntry,
  SSHFilePreview,
} from './ssh.js';

export { createGitHubClient } from './github.js';
export type { CreateGitHubTriggerInput, GitHubClient, GitHubTrigger } from './github.js';

export { createChannelsClient } from './channels.js';
export type {
  ChannelDescriptorListResponse,
  ChannelListResponse,
  ChannelMutationResponse,
  ChannelTargetsResponse,
  ChannelsClient,
} from './channels.js';

export { createArtifactsClient } from './artifacts.js';
export type {
  ArtifactSessionArtifactsResponse,
  ArtifactVersionsResponse,
  ArtifactsClient,
  CreateArtifactInput,
  ImageGenerationInput,
  RevertArtifactInput,
  UpdateArtifactInput,
  UploadSessionArtifactInput,
} from './artifacts.js';

export { createSessionTerminalsClient } from './session-terminals.js';
export type {
  ListSessionTerminalsOptions,
  SessionTerminalView,
  SessionTerminalsClient,
} from './session-terminals.js';

export { createTeamRuntimeClient } from './team-runtime.js';
export type {
  InteractionAgentRewriteRequest,
  InteractionAgentRewriteResponse,
  TeamLeaderDispatchRequest,
  TeamLeaderDispatchResponse,
  TeamLeaderDispatchedTask,
  TeamLeaderRosterMember,
  TeamRuntimeClient,
} from './team-runtime.js';

export { createTeamInboundClient } from './team-inbound.js';
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
} from './team-inbound.js';

export { createTeamHandoffsClient } from './team-handoffs.js';
export type {
  HandoffCancelResult,
  HandoffRecord,
  HandoffRoleLayer,
  HandoffState,
  TeamHandoffsClient,
} from './team-handoffs.js';

export { createTeamWorkflowsClient } from './team-workflows.js';
export type {
  CreateTeamWorkflowResponse,
  TeamWorkflow,
  TeamWorkflowsClient,
  TeamWorkflowWithDbId,
  UpdateTeamWorkflowResponse,
  WorkflowGate,
  WorkflowRoleLayer,
  WorkflowSource,
  WorkflowStep,
} from './team-workflows.js';

export { createSettingsClient } from './settings.js';
export type { SettingsClient } from './settings.js';

export { createSkillsClient } from './skills.js';
export type { SkillsClient } from './skills.js';

export { createMemoriesClient } from './memories.js';
export type { MemoriesClient } from './memories.js';
