export { GatewayWebSocketClient } from './gateway-ws.js';
export { GatewaySSEClient } from './gateway-sse.js';
export { login, refreshAccessToken, logout } from './auth.js';
export type { TokenPair } from './auth.js';
export type {
  GatewayStreamEvent,
  StreamChunkHandler,
  StreamEventHandler,
  SendMessageOptions,
} from './gateway-ws.js';
export { createCommandsClient } from './commands.js';
export type { CommandsClient } from './commands.js';
export { createCapabilitiesClient } from './capabilities.js';
export type { CapabilitiesClient } from './capabilities.js';
export { createAgentsClient } from './agents.js';
export type { AgentsClient } from './agents.js';
export { createPermissionsClient } from './permissions.js';
export type {
  PendingPermissionRequest,
  PermissionDecision,
  PermissionsClient,
} from './permissions.js';
export { createSessionsClient, HttpError } from './sessions.js';
export type {
  DeleteSessionBlockReason,
  DeleteSessionErrorData,
  DeleteSessionResult,
  Session,
  SessionBackupRestorePreviewResult,
  SessionFileBackupTarget,
  SessionFileChangesProjection,
  SessionFileChangesQueryOptions,
  SessionFileChangesSummary,
  SessionFileDiffEntry,
  SessionRestoreApplyInput,
  SessionRestoreApplyResult,
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
  SessionTask,
  SessionTodo,
  SessionTodoLanes,
  SessionTurnDiffFileSummary,
  SessionTurnDiffReadModel,
  SessionsClient,
} from './sessions.js';
export { withTokenRefresh } from './token-refresh.js';
export type { TokenStore } from './token-refresh.js';
