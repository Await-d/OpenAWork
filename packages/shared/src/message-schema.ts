export type MessageRole = 'user' | 'assistant' | 'tool' | 'system';

export interface TextContent {
  type: 'text';
  text: string;
}

export interface InputImageContent {
  type: 'input_image';
  artifactId?: string;
  detail?: 'auto' | 'high' | 'low' | 'original';
  fileId?: string;
  fileName?: string;
  imageUrl?: string;
  mimeType?: string;
}

export interface ToolCallContent {
  type: 'tool_call';
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  rawArguments?: string;
}

export interface ToolCallObservabilityAnnotation {
  presentedToolName?: string;
  canonicalToolName?: string;
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
  rawOutput?: string;
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

export interface ReasoningContent {
  type: 'reasoning';
  text: string;
  /** For Responses API: the encrypted_content from the upstream response, needed for multi-turn. */
  encryptedContent?: string;
  /** For Responses API: the reasoning summary from the upstream response. */
  summary?: string;
  /** For Responses API: the response.id, used as previous_response_id for prompt caching. */
  responseId?: string;
  /** UNIX millis when the upstream first emitted thinking delta for this block. */
  startedAt?: number;
  /** UNIX millis when the upstream signalled (or fail-safe inferred) the block was complete. */
  endedAt?: number;
  /**
   * Anthropic extended-thinking signature for this block. Required to be
   * replayed verbatim on subsequent turns; without it Anthropic rejects the
   * assistant turn (`thinking ids found without signature` 400 error).
   */
  signature?: string;
}

export type MessageContent =
  | TextContent
  | InputImageContent
  | ReasoningContent
  | ToolCallContent
  | ToolResultContent
  | ModifiedFilesSummaryContent;

export interface Message {
  id: string;
  role: MessageRole;
  content: MessageContent[];
  createdAt: number;
  clientRequestId?: string;
  durationMs?: number;
  firstTokenLatencyMs?: number;
  providerUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    reasoningTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
}
