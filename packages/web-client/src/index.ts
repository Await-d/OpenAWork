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
export type { CapabilitiesClient } from './session/capabilities.js';
export { createAgentsClient } from './session/agents.js';
export type { AgentsClient } from './session/agents.js';
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
} from './team/team.js';
export { createTeamPhaseAClient } from './team/team-phase-a.js';
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
} from './team/team-phase-a.js';
export { createWorkflowsClient } from './infra/workflows.js';
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
export { createSessionsClient } from './session/sessions.js';
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
  WorkspaceReviewChange,
  WorkspaceReviewDiffResponse,
  WorkspaceReviewStatusResponse,
  WorkspaceRootsResponse,
  WorkspaceSearchHit,
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
  DesktopAutomationScreenshotResult,
  DesktopAutomationStatus,
} from './infra/desktop-automation.js';

export { createSshClient } from './infra/ssh.js';
export type {
  CreateSSHConnectionInput,
  SSHClient,
  SSHConnectionEntry,
  SSHFileEntry,
  SSHFilePreview,
} from './infra/ssh.js';

export { createGitHubClient } from './infra/github.js';
export type { CreateGitHubTriggerInput, GitHubClient, GitHubTrigger } from './infra/github.js';

export { createChannelsClient } from './infra/channels.js';
export type {
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

export { createTeamHandoffsClient } from './team/team-handoffs.js';
export type {
  HandoffCancelResult,
  HandoffRecord,
  HandoffRoleLayer,
  HandoffState,
  TeamHandoffsClient,
} from './team/team-handoffs.js';

export { createTeamWorkflowsClient } from './team/team-workflows.js';
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
} from './team/team-workflows.js';

export { createSettingsClient } from './infra/settings.js';
export type { SettingsClient } from './infra/settings.js';

export { createSkillsClient } from './infra/skills.js';
export type { SkillsClient } from './infra/skills.js';

export { createMemoriesClient } from './infra/memories.js';
export type { MemoriesClient } from './infra/memories.js';
