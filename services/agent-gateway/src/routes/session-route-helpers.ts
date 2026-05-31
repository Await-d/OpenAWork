import type { FileDiffContent, Message, MessageContent, RunEvent } from '@openAwork/shared';
import type { SessionTodo } from '../tools/todo-tools.js';

const SLIM_STRING_MAX = 800;
const SLIM_INPUT_MAX = 2000;
const SLIM_DIFF_MAX = 3000;

function truncStr(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max) + `\n…[truncated, ${value.length - max} chars omitted]`;
}

function slimToolCallInput(input: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    result[key] =
      typeof value === 'string' && value.length > SLIM_INPUT_MAX
        ? truncStr(value, SLIM_INPUT_MAX)
        : value;
  }
  return result;
}

function slimDiffEntries(diffs: FileDiffContent[]): FileDiffContent[] {
  const capped =
    diffs.length > SLIM_DIFFS_MAX_ENTRIES ? diffs.slice(0, SLIM_DIFFS_MAX_ENTRIES) : diffs;
  return capped.map((diff) => ({
    ...diff,
    before: truncStr(diff.before, SLIM_DIFF_MAX),
    after: truncStr(diff.after, SLIM_DIFF_MAX),
  }));
}

const SLIM_OUTPUT_TOTAL_MAX = 4000;
const SLIM_DIFFS_MAX_ENTRIES = 5;

function slimDiffArray(diffs: unknown[]): unknown[] {
  const capped =
    diffs.length > SLIM_DIFFS_MAX_ENTRIES ? diffs.slice(0, SLIM_DIFFS_MAX_ENTRIES) : diffs;
  return capped.map((d) => {
    if (d && typeof d === 'object' && 'before' in d && 'after' in d) {
      const diff = d as Record<string, unknown>;
      return {
        ...diff,
        before:
          typeof diff.before === 'string' ? truncStr(diff.before, SLIM_DIFF_MAX) : diff.before,
        after: typeof diff.after === 'string' ? truncStr(diff.after, SLIM_DIFF_MAX) : diff.after,
      };
    }
    return d;
  });
}

function slimOutputValue(output: unknown): unknown {
  if (typeof output === 'string') {
    // Tools like `generate_image` return `JSON.stringify({ success, artifactId, … })`.
    // Truncating the whole string corrupts the JSON and loses the artifactId
    // reference the UI needs to fetch the actual artifact after recovery.
    // When the string is valid JSON-encoded object/array, recursively slim
    // its parsed form and re-serialize so structural fields survive while
    // long leaf strings (e.g. `revisedPrompt`) still get truncated.
    const trimmed = output.trim();
    const looksLikeJson =
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'));
    if (looksLikeJson) {
      try {
        const parsed = JSON.parse(output) as unknown;
        const slimmed = slimOutputValue(parsed);
        return JSON.stringify(slimmed);
      } catch {
        // Not parseable JSON — fall through to plain truncation below.
      }
    }
    return truncStr(output, SLIM_STRING_MAX);
  }
  if (!output || typeof output !== 'object') {
    return output;
  }
  if (Array.isArray(output)) {
    return output.map((item) => slimOutputValue(item));
  }
  const obj = output as Record<string, unknown>;
  const isBatchShape = Array.isArray(obj['results']);
  // Bash-style structured output (`{ command, cwd, exitCode, stdout, stderr,
  // diffs }`). The frontend `resolveBashTerminalView` reads these fields to
  // render the terminal card; collapsing the object into a truncated JSON
  // string would drop the exit-code badge / structured stdout/stderr panes.
  const isBashShape =
    typeof obj['command'] === 'string' ||
    typeof obj['exitCode'] === 'number' ||
    typeof obj['stdout'] === 'string' ||
    typeof obj['stderr'] === 'string';
  const slimmed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'diffs' && Array.isArray(value)) {
      slimmed[key] = slimDiffArray(value);
    } else if (key === 'results' && Array.isArray(value)) {
      slimmed[key] = value.map((item) => {
        if (item && typeof item === 'object' && 'output' in item) {
          return { ...item, output: slimOutputValue((item as Record<string, unknown>).output) };
        }
        return item;
      });
    } else if (typeof value === 'string' && value.length > SLIM_STRING_MAX) {
      slimmed[key] = truncStr(value, SLIM_STRING_MAX);
    } else {
      slimmed[key] = value;
    }
  }
  // Batch (`{ results: [...] }`) and bash (`{ command, exitCode, ... }`)
  // outputs MUST keep their object shape so the frontend cards can recover
  // per-sub status / terminal panes. The generic total-size guard below
  // collapses an over-cap object into a truncated JSON *string*, which
  // destroys that structure (batch sub-rows then spin forever; bash cards
  // lose their exit-code + stdout/stderr panes after a refresh). Long leaf
  // strings and diffs are already truncated above, so the payload stays
  // bounded without the string fallback.
  if (isBatchShape || isBashShape) {
    return slimmed;
  }
  const serialized = JSON.stringify(slimmed);
  if (serialized.length > SLIM_OUTPUT_TOTAL_MAX) {
    return truncStr(serialized, SLIM_OUTPUT_TOTAL_MAX);
  }
  return slimmed;
}

function slimContentItem(item: MessageContent): MessageContent {
  if (item.type === 'tool_result') {
    const slimmedOutput = slimOutputValue(item.output);
    const slimmedDiffs = item.fileDiffs ? slimDiffEntries(item.fileDiffs) : undefined;
    const slimmedRaw =
      typeof item.rawOutput === 'string' && item.rawOutput.length > SLIM_STRING_MAX
        ? truncStr(item.rawOutput, SLIM_STRING_MAX)
        : item.rawOutput;
    return {
      ...item,
      output: slimmedOutput,
      ...(slimmedDiffs ? { fileDiffs: slimmedDiffs } : {}),
      ...(slimmedRaw !== undefined ? { rawOutput: slimmedRaw } : {}),
    };
  }
  if (item.type === 'tool_call') {
    return { ...item, input: slimToolCallInput(item.input) };
  }
  return item;
}

export function slimMessagesForRecovery(messages: Message[]): Message[] {
  return messages.map((message) => ({
    ...message,
    content: message.content.map(slimContentItem),
  }));
}

interface SessionResponseLike {
  id: string;
  state_status: string;
  metadata_json: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  /** 团队会话语义层级（reception/pm1/pm2/executor/reviewer）。chat 会话为 null/缺失。 */
  role_layer?: string | null;
  /** 团队会话子状态机位置（L1.3）。 */
  substate?: string | null;
}

export interface PublicSessionResponse extends SessionResponseLike {
  messages: Message[];
  runEvents: RunEvent[];
  todos: SessionTodo[];
}

export const MAX_IMPORTED_MESSAGES = 500;
export const MAX_IMPORTED_MESSAGES_BYTES = 512 * 1024;

export function toPublicSessionResponse(
  session: SessionResponseLike,
  messages: Message[],
  todos: SessionTodo[] = [],
  runEvents: RunEvent[] = [],
): PublicSessionResponse {
  return {
    id: session.id,
    state_status: session.state_status,
    metadata_json: session.metadata_json,
    title: session.title,
    created_at: session.created_at,
    updated_at: session.updated_at,
    // 团队会话语义字段：透传给前端（reception 空态卡片 / 初始化清单依赖
    // role_layer === 'reception' 才渲染）。chat 会话缺失时为 null。
    ...(session.role_layer !== undefined ? { role_layer: session.role_layer } : {}),
    ...(session.substate !== undefined ? { substate: session.substate } : {}),
    messages,
    runEvents,
    todos,
  };
}

export function validateImportedMessagesPayload(
  messages: unknown[],
): { ok: true; serializedMessages: string } | { error: string; ok: false } {
  if (messages.length > MAX_IMPORTED_MESSAGES) {
    return { ok: false, error: `导入消息数量超过上限（最多 ${MAX_IMPORTED_MESSAGES} 条）` };
  }

  const serializedMessages = JSON.stringify(messages);
  if (Buffer.byteLength(serializedMessages, 'utf8') > MAX_IMPORTED_MESSAGES_BYTES) {
    return { ok: false, error: `导入内容大小超过上限（最多 ${MAX_IMPORTED_MESSAGES_BYTES} 字节）` };
  }

  return { ok: true, serializedMessages };
}
