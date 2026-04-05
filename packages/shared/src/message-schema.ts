export type MessageRole = 'user' | 'assistant' | 'tool' | 'system';

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ToolCallContent {
  type: 'tool_call';
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export type ToolSurfaceProfile = 'openawork' | 'claude_code_simple' | 'claude_code_default';

export interface ToolCallObservabilityAnnotation {
  presentedToolName?: string;
  canonicalToolName?: string;
  toolSurfaceProfile?: ToolSurfaceProfile;
  adapterVersion?: string;
}

export type FileChangeGuaranteeLevel = 'strong' | 'medium' | 'weak';

export type FileChangeSourceKind =
  | 'structured_tool_diff'
  | 'session_snapshot'
  | 'restore_replay'
  | 'workspace_reconcile'
  | 'manual_revert';

export type FileBackupKind = 'before_write' | 'after_write' | 'snapshot_base';

export interface FileBackupRef {
  backupId: string;
  kind: FileBackupKind;
  storagePath?: string;
  artifactId?: string;
  contentHash?: string;
}

export interface FileDiffContent {
  file: string;
  before: string;
  after: string;
  additions: number;
  deletions: number;
  status?: 'added' | 'deleted' | 'modified';
  clientRequestId?: string;
  requestId?: string;
  toolName?: string;
  toolCallId?: string;
  sourceKind?: FileChangeSourceKind;
  guaranteeLevel?: FileChangeGuaranteeLevel;
  backupBeforeRef?: FileBackupRef;
  backupAfterRef?: FileBackupRef;
  observability?: ToolCallObservabilityAnnotation;
}

export interface ToolResultContent {
  type: 'tool_result';
  toolCallId: string;
  toolName?: string;
  clientRequestId?: string;
  output: unknown;
  isError: boolean;
  reason?: string;
  fileDiffs?: FileDiffContent[];
  pendingPermissionRequestId?: string;
  resumedAfterApproval?: boolean;
  observability?: ToolCallObservabilityAnnotation;
}

export interface ModifiedFilesSummaryContent {
  type: 'modified_files_summary';
  title: string;
  summary: string;
  files: FileDiffContent[];
}

export type MessageContent =
  | TextContent
  | ToolCallContent
  | ToolResultContent
  | ModifiedFilesSummaryContent;

export interface Message {
  id: string;
  role: MessageRole;
  content: MessageContent[];
  createdAt: number;
}
