import type {
  FileDiffContent,
  InputImageContent,
  Message,
  ModifiedFilesSummaryContent,
  ToolCallObservabilityAnnotation,
} from '@openAwork/shared';

// ---------------------------------------------------------------------------
// Parts-based message model (inspired by opencode MessageV2.Part).
// Each part has a stable `id` so reconciliation can simply find-by-id.
// ---------------------------------------------------------------------------

export interface ChatTextPart {
  id: string;
  type: 'text';
  text: string;
}

export interface ChatReasoningPart {
  id: string;
  type: 'reasoning';
  text: string;
  /** Wall-clock time the reasoning block first started streaming. */
  startedAt?: number;
  /** Wall-clock time the reasoning block was closed (thinking_end). */
  endedAt?: number;
}

export interface ChatToolPart {
  id: string;
  type: 'tool';
  toolCallId: string;
  toolName: string;
  /**
   * tool result 的图片附件通道（`StreamToolResultChunk.attachments`）。
   *
   * 目前只有 `computer_use` 的最终截图走这里（网关刻意不把 base64 塞进
   * `output`）；其余工具保持 undefined，渲染行为与既有实现一致。
   */
  attachments?: InputImageContent[];
  kind?: 'agent' | 'mcp' | 'skill' | 'tool';
  input: Record<string, unknown>;
  clientRequestId?: string;
  durationMs?: number;
  fileDiffs?: FileDiffContent[];
  isError?: boolean;
  observability?: ToolCallObservabilityAnnotation;
  output?: unknown;
  pendingPermissionRequestId?: string;
  resumedAfterApproval?: boolean;
  status?: 'running' | 'paused' | 'completed' | 'failed';
}

export interface ChatEventPart {
  id: string;
  type: 'event';
  payload: AssistantEventPayload;
}

export type ChatMessagePart = ChatTextPart | ChatReasoningPart | ChatToolPart | ChatEventPart;

// ---------------------------------------------------------------------------

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  clientRequestId?: string;
  /** Structured parts — source of truth for reconciliation. */
  parts?: ChatMessagePart[];
  rawContent?: Message['content'];
  model?: string;
  providerId?: string;
  /** Agent ID that generated this message (for per-agent color rendering). */
  agentId?: string;
  createdAt?: number | string;
  durationMs?: number;
  firstTokenLatencyMs?: number;
  stopReason?: 'end_turn' | 'tool_use' | 'max_tokens' | 'error' | string;
  tokenEstimate?: number;
  providerUsage?: Message['providerUsage'];
  toolCallCount?: number;
  modifiedFilesSummary?: ModifiedFilesSummaryContent;
  status?: 'streaming' | 'completed' | 'error' | 'cancelled';
  /**
   * Transient flag (live-streaming only): one boolean per `reasoningBlocks`
   * entry — true once the corresponding `thinking_end` event has been seen.
   * Not persisted; finalized assistant messages either omit this or treat all
   * reasoning blocks as ended by default.
   */
  reasoningBlocksEndedFlags?: boolean[];
  /**
   * Transient durations (live-streaming only): one number-of-millis per
   * `reasoningBlocks` entry. -1 indicates "duration unknown" (block hasn't
   * ended yet, or backend did not provide startedAt). Not persisted on the
   * client; for finalized messages durations come from the server payload.
   */
  reasoningBlocksDurationsMs?: number[];
}

export interface ChatInputImageItem {
  artifactId?: string;
  detail?: 'auto' | 'high' | 'low' | 'original';
  fileId?: string;
  fileName?: string;
  imageUrl?: string;
  mimeType?: string;
}

export type AssistantEventKind =
  'agent' | 'audit' | 'compaction' | 'mcp' | 'permission' | 'question' | 'skill' | 'task' | 'tool';

export type AssistantEventStatus = 'error' | 'paused' | 'running' | 'success';

export interface AssistantEventPayload {
  kind: AssistantEventKind;
  message: string;
  requestId?: string;
  status: AssistantEventStatus;
  title: string;
}

export interface ChatUsageDetails {
  requestIndex: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  estimatedCostUsd?: number;
  durationMs?: number;
  firstTokenLatencyMs?: number;
  tokensPerSecond?: number;
}

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
