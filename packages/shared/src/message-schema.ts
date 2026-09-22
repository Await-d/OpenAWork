/**
 * Message role.
 *
 * `synthetic` marks gateway-authored messages that are injected into a session
 * by the gateway itself rather than authored by the end user. The canonical
 * producer is subagent completion delivery (a finished child session reports
 * back into its parent), mirroring opencode's first-class `synthetic` message
 * type (`packages/schema/src/session-inbox.ts` → `SyntheticPayload`).
 *
 * Semantics:
 *   - visible to the model (lowered to the upstream `user` role when building
 *     the provider request),
 *   - never rendered as user input in any client,
 *   - carries `description` + `metadata` so clients can render a compact notice
 *     (opencode renders `metadata.source === 'subagent'` as a one-line notice
 *     that links to the child session).
 */
export type MessageRole = 'user' | 'assistant' | 'tool' | 'system' | 'synthetic';

/**
 * Completion state of a subagent notice. Mirrors the `metadata.state` values
 * produced by the gateway's task-job settlement, which in turn map onto
 * opencode's `Job.Status` (`completed | error | cancelled`).
 */
export type SubagentNoticeState = 'done' | 'failed' | 'cancelled';

/**
 * Notice contract for `role: 'synthetic'` messages whose
 * `metadata.source === 'subagent'`.
 *
 * Mirrors opencode's `SubagentCompletion.deliver` metadata
 * (`packages/core/src/session/subagent-completion.ts`). Clients render it as a
 * compact notice row that links to the child session — never as user input.
 */
export type SubagentNoticeMetadata = {
  source: 'subagent';
  /** Child session id; presence makes the notice navigable. */
  childID?: string;
  /** Subagent name (e.g. `explore`). */
  agent?: string;
  state?: SubagentNoticeState;
};

export interface TextContent {
  type: 'text';
  text: string;
  /**
   * Synthetic content authored by the gateway (e.g. capability context,
   * keyword-detector reminder, companion prompt) rather than the user.
   * Persisting this as a separate part with a stable marker keeps the
   * upstream Anthropic / OpenAI prompt-cache prefix byte-stable across
   * turns: each user message carries its own snapshot of the synthetic
   * block instead of having it re-prepended to whichever message
   * currently happens to be the latest user turn.
   *
   * Mirrors opencode's `synthetic: true` text-part flag (see
   * `temp/opencode/packages/opencode/src/session/prompt.ts insertReminders`,
   * which writes synthetic parts back through `sessions.updatePart()`).
   */
  synthetic?: boolean;
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
  /**
   * Provider-attached metadata captured from the upstream `tool-call`
   * stream chunk's `providerMetadata`. The OpenAI Responses API in
   * particular emits an `openai.itemId` (`fc_xxx`) that is *separate*
   * from the call_id surfaced as `toolCallId` (`call_xxx`); both must
   * round-trip across turns or the AI SDK falls back to using the
   * call_id as the function_call.id, OpenAI re-keys the item, and
   * the entire prompt-cache prefix from that function_call onward
   * misses on every subsequent request.
   *
   * Persisted as-is (a free-form record keyed by provider name)
   * mirroring AI SDK 5's `tool-call.providerMetadata` shape.
   */
  providerMetadata?: Record<string, Record<string, unknown>>;
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
  attachments?: InputImageContent[];
  fileDiffs?: FileDiffContent[];
  pendingPermissionRequestId?: string;
  resumedAfterApproval?: boolean;
  observability?: ToolCallObservabilityAnnotation;
  outputKind?: 'binary-reference' | 'html' | 'image-reference' | 'json' | 'log' | 'table' | 'text';
  outputSummary?: string;
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
  /** For Responses API: the reasoning output item id needed for replay. */
  itemId?: string;
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

export interface InputAudioContent {
  type: 'input_audio';
  artifactId?: string;
  fileId?: string;
  fileName?: string;
  audioUrl?: string;
  mimeType?: string;
  duration?: number;
  transcript?: string;
}

export interface InputVideoContent {
  type: 'input_video';
  artifactId?: string;
  fileId?: string;
  fileName?: string;
  videoUrl?: string;
  mimeType?: string;
  duration?: number;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
}

export type MessageContent =
  | TextContent
  | InputImageContent
  | InputAudioContent
  | InputVideoContent
  | ReasoningContent
  | ToolCallContent
  | ToolResultContent
  | ModifiedFilesSummaryContent;

export interface Message {
  id: string;
  role: MessageRole;
  content: MessageContent[];
  createdAt: number;
  agentId?: string;
  clientRequestId?: string;
  /**
   * Short human-readable label. For `role: 'synthetic'` this is the notice
   * label (e.g. the subagent task description). Aligns with opencode's
   * `message.description` on synthetic messages.
   */
  description?: string;
  /**
   * Structured notice payload. For `role: 'synthetic'` with
   * `metadata.source === 'subagent'` the shape is
   * `{ source, childID, agent, state }`, matching opencode's
   * `SubagentCompletion.deliver` metadata and the client notice contract.
   */
  metadata?: Record<string, unknown>;
  model?: string;
  providerId?: string;
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
