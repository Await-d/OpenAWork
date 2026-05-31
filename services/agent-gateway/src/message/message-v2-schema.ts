/**
 * V2 Message Schema — opencode-style Session → Message → Part model.
 *
 * Key differences from V1:
 * - Message and Part are separate rows (not a single content_json blob)
 * - Tool call has its own state machine (pending → running → completed/error)
 * - Part-level incremental updates (PartDelta) instead of full content replacement
 * - Event sourcing via SyncEvent + Projector for all state mutations
 */

import { makeOrderedMessageId, makeOrderedPartId } from '../infra/ordered-id.js';

// ─── IDs ───

export type MessageID = string & { __brand: 'MessageID' };
export type PartID = string & { __brand: 'PartID' };

export function makeMessageId(): MessageID {
  return makeOrderedMessageId() as MessageID;
}

export function makePartId(): PartID {
  return makeOrderedPartId() as PartID;
}

// ─── Tool State Machine ───

export interface ToolStatePending {
  status: 'pending';
  input: Record<string, unknown>;
  raw: string;
}

export interface ToolStateRunning {
  status: 'running';
  input: Record<string, unknown>;
  title?: string;
  metadata?: Record<string, unknown>;
  time: { start: number };
}

export interface ToolStateCompleted {
  status: 'completed';
  input: Record<string, unknown>;
  output: string;
  title: string;
  metadata: Record<string, unknown>;
  time: { start: number; end: number; compacted?: number };
  attachments?: FilePart[];
}

export interface ToolStateError {
  status: 'error';
  input: Record<string, unknown>;
  error: string;
  metadata?: Record<string, unknown>;
  time: { start: number; end: number };
}

export type ToolState = ToolStatePending | ToolStateRunning | ToolStateCompleted | ToolStateError;

// ─── Part Types ───

interface PartBase {
  id: PartID;
  sessionID: string;
  messageID: MessageID;
}

export interface TextPart extends PartBase {
  type: 'text';
  text: string;
  synthetic?: boolean;
  ignored?: boolean;
  time?: { start: number; end?: number };
  metadata?: Record<string, unknown>;
}

export interface ReasoningPart extends PartBase {
  type: 'reasoning';
  text: string;
  metadata?: Record<string, unknown>;
  time: { start: number; end?: number };
  /** Response ID from Responses API, used as previous_response_id for caching. */
  responseId?: string;
}

export interface ToolPart extends PartBase {
  type: 'tool';
  callID: string;
  tool: string;
  state: ToolState;
  metadata?: Record<string, unknown>;
}

export interface StepStartPart extends PartBase {
  type: 'step-start';
  snapshot?: string;
}

export interface StepFinishPart extends PartBase {
  type: 'step-finish';
  reason: string;
  snapshot?: string;
  cost: number;
  tokens: {
    total?: number;
    input: number;
    output: number;
    reasoning: number;
    cache: { read: number; write: number };
  };
}

export interface CompactionPart extends PartBase {
  type: 'compaction';
  auto: boolean;
  overflow?: boolean;
  /**
   * Earliest message ID to retain after this compaction boundary.
   * When present, `filterCompacted` keeps messages from this ID forward
   * (inclusive) instead of cutting strictly at the compaction marker.
   * Mirrors opencode's `CompactionPart.tail_start_id`.
   */
  tailStartID?: MessageID;
}

export interface SubtaskPart extends PartBase {
  type: 'subtask';
  prompt: string;
  description: string;
  agent: string;
  model?: { providerID: string; modelID: string };
  command?: string;
}

export interface FilePart extends PartBase {
  type: 'file';
  artifactId?: string;
  detail?: 'auto' | 'high' | 'low' | 'original';
  fileId?: string;
  inputType?: 'generic' | 'input_image';
  mime: string;
  filename?: string;
  url: string;
  source?: {
    type: 'file' | 'symbol' | 'resource';
    path?: string;
    text?: { value: string; start: number; end: number };
    name?: string;
    kind?: number;
    clientName?: string;
    uri?: string;
    range?: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
  };
}

export interface AgentPart extends PartBase {
  type: 'agent';
  name: string;
  source?: { value: string; start: number; end: number };
}

export interface RetryPart extends PartBase {
  type: 'retry';
  attempt: number;
  error: string;
  time: { created: number };
}

export interface SnapshotPart extends PartBase {
  type: 'snapshot';
  snapshot: string;
}

export interface PatchPart extends PartBase {
  type: 'patch';
  hash: string;
  files: string[];
}

export interface ModifiedFilesSummaryPart extends PartBase {
  type: 'modified_files_summary';
  title: string;
  summary: string;
  files: Array<{
    file: string;
    before: string;
    after: string;
    additions: number;
    deletions: number;
    status?: 'added' | 'deleted' | 'modified';
  }>;
}

export type MessagePart =
  | TextPart
  | ReasoningPart
  | ToolPart
  | StepStartPart
  | StepFinishPart
  | CompactionPart
  | SubtaskPart
  | FilePart
  | AgentPart
  | RetryPart
  | SnapshotPart
  | PatchPart
  | ModifiedFilesSummaryPart;

// ─── Message Info (discriminated union by role) ───

interface MessageBase {
  id: MessageID;
  sessionID: string;
  clientRequestId?: string;
  status?: 'final' | 'error' | 'streaming';
}

export interface UserMessage extends MessageBase {
  role: 'user';
  time: { created: number };
  format?: { type: 'text' } | { type: 'json'; schema: unknown };
  summary?: {
    title?: string;
    body?: string;
    diffs: Array<{ file: string; before: string; after: string }>;
  };
  agent?: string;
  model?: { providerID: string; modelID: string; variant?: string };
  system?: string;
  tools?: Record<string, boolean>;
}

/**
 * Structured error attached to an assistant message.
 *
 * Modelled after opencode's NamedError discriminated union
 * (`AbortedError | AuthError | ContextOverflowError | OutputLengthError
 *  | APIError | UnknownError`). Every variant keeps the legacy
 * `{ name; message }` shape so existing truthy checks and bus payloads
 * remain wire-compatible while new code can narrow on `name` for
 * retry / compaction / surfacing decisions.
 */
export type AssistantErrorObject =
  | AssistantAbortedError
  | AssistantAuthError
  | AssistantContextOverflowError
  | AssistantOutputLengthError
  | AssistantAPIError
  | AssistantUnknownError;

export interface AssistantAbortedError {
  name: 'AbortedError';
  message: string;
}

export interface AssistantAuthError {
  name: 'AuthError';
  message: string;
  providerID?: string;
}

export interface AssistantContextOverflowError {
  name: 'ContextOverflowError';
  message: string;
  statusCode?: number;
}

export interface AssistantOutputLengthError {
  name: 'OutputLengthError';
  message: string;
}

export interface AssistantAPIError {
  name: 'APIError';
  message: string;
  /** HTTP status from the upstream when available (e.g. 429, 500). */
  statusCode?: number;
  /** True for transient classes (5xx, network resets, decompression errors). */
  isRetryable?: boolean;
  /** SystemError-style code such as `ECONNRESET`, `ETIMEDOUT`, `ZlibError`. */
  code?: string;
}

export interface AssistantUnknownError {
  name: 'UnknownError';
  message: string;
}

export interface AssistantMessage extends MessageBase {
  role: 'assistant';
  time: { created: number; completed?: number; firstContent?: number };
  error?: AssistantErrorObject;
  parentID?: MessageID;
  modelID?: string;
  providerID?: string;
  mode?: string;
  agent?: string;
  path?: { cwd: string; root: string };
  summary?: boolean;
  cost: number;
  tokens: {
    total?: number;
    input: number;
    output: number;
    reasoning: number;
    cache: { read: number; write: number };
  };
  structured?: unknown;
  variant?: string;
  finish?: string;
}

export interface ToolMessage extends MessageBase {
  role: 'tool';
  time: { created: number };
}

export interface SystemMessage extends MessageBase {
  role: 'system';
  time: { created: number };
}

export type MessageInfo = UserMessage | AssistantMessage | ToolMessage | SystemMessage;

// ─── WithParts (read model) ───

export interface MessageWithParts {
  info: MessageInfo;
  parts: MessagePart[];
}

export interface PageResult {
  items: MessageWithParts[];
  more: boolean;
  cursor?: string;
}

export interface MessageCursor {
  id: MessageID;
  time: number;
}

// ─── DB Row Types ───

export interface MessageV2Row {
  id: string;
  session_id: string;
  user_id: string;
  time_created: number;
  data: string; // JSON of Omit<MessageInfo, 'id' | 'sessionID'>
  created_at: string;
  updated_at: string;
}

export interface PartV2Row {
  id: string;
  message_id: string;
  session_id: string;
  user_id: string;
  time_created: number;
  data: string; // JSON of Omit<MessagePart, 'id' | 'sessionID' | 'messageID'>
  created_at: string;
  updated_at: string;
}

// ─── Row ↔ Domain Conversion ───

type MessageInfoData = Omit<MessageInfo, 'id' | 'sessionID'>;
type PartData = Omit<MessagePart, 'id' | 'sessionID' | 'messageID'>;

export function messageInfoFromRow(row: MessageV2Row): MessageInfo {
  const data = JSON.parse(row.data) as MessageInfoData;
  return {
    ...data,
    id: row.id as MessageID,
    sessionID: row.session_id,
  } as MessageInfo;
}

export function messageInfoToRowData(info: MessageInfo): string {
  const { id: _, sessionID: __, ...data } = info;
  return JSON.stringify(data);
}

export function partFromRow(row: PartV2Row): MessagePart {
  const data = JSON.parse(row.data) as PartData;
  return {
    ...data,
    id: row.id as PartID,
    sessionID: row.session_id,
    messageID: row.message_id as MessageID,
  } as MessagePart;
}

export function partToRowData(part: MessagePart): string {
  const { id: _, sessionID: __, messageID: ___, ...data } = part;
  return JSON.stringify(data);
}

// ─── Corrupt-row tolerance (read side) ───
// `data` is persisted via `JSON.stringify`, but a crash mid-write, a disk
// error, or a hand-edited DB can leave a column that is not valid JSON. The
// read model is the live source of truth for the chat UI, and most callers do
// `rows.map(...)`, so a single corrupt row would otherwise throw and make an
// entire page / session of messages unreadable. These `try*` variants return
// `null` + warn instead; list callers skip the bad row, single-row getters
// degrade to `undefined`. Same fail-the-whole-read class hardened for the
// agent-core SQLite session store and the artifacts index.

export function tryMessageInfoFromRow(row: MessageV2Row): MessageInfo | null {
  try {
    return messageInfoFromRow(row);
  } catch (error) {
    console.warn(
      `[message-v2] message ${row.id} data 列 JSON 解析失败，已跳过：${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

export function tryPartFromRow(row: PartV2Row): MessagePart | null {
  try {
    return partFromRow(row);
  } catch (error) {
    console.warn(
      `[message-v2] part ${row.id} data 列 JSON 解析失败，已跳过：${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

/** Map message rows to domain objects, skipping (and warning on) corrupt rows. */
export function mapMessageInfoRows(rows: MessageV2Row[]): MessageInfo[] {
  const out: MessageInfo[] = [];
  for (const row of rows) {
    const info = tryMessageInfoFromRow(row);
    if (info !== null) out.push(info);
  }
  return out;
}

/** Map part rows to domain objects, skipping (and warning on) corrupt rows. */
export function mapPartRows(rows: PartV2Row[]): MessagePart[] {
  const out: MessagePart[] = [];
  for (const row of rows) {
    const part = tryPartFromRow(row);
    if (part !== null) out.push(part);
  }
  return out;
}
