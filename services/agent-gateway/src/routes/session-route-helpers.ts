import type {
  FileDiffContent,
  Message,
  MessageContent,
  RunEvent,
  WorkflowRuntimeState,
} from '@openAwork/shared';
import { formatToolOutputTruncationMarker } from '@openAwork/shared';
import type { SessionTodo } from '../tools/todo-tools.js';
import { buildWorkflowRuntimeState } from '../session/workflow-runtime-state.js';

const SLIM_STRING_MAX = 800;
const SLIM_INPUT_MAX = 2000;
const SLIM_DIFF_MAX = 3000;

/**
 * 单个 tool 输出的 UTF-8 字节硬上限（64KB）。
 *
 * `slimOutputValue` 对 leaf 字符串的裁剪是「逐字段」的：每个字段各自截到
 * `SLIM_STRING_MAX`，**累加不设上限**。而 `isBatchShape` / `isBashShape` 两条
 * 分支为了保住前端卡片需要的对象结构（exit code、stdout/stderr 分栏、batch
 * 逐行状态），显式绕过了 `SLIM_OUTPUT_TOTAL_MAX` 的整体截断 —— 于是一个含超长
 * stdout 的 bash 结果、或含大量子结果的 batch，可以无界增长（实测单条 86KB）。
 *
 * 这里补一个与结构无关的总上界：先按 leaf 数摊预算，仍超限就逐次减半，直到
 * 落进上限；只有叶子极多、减到最小预算仍超限时才降级成截断字符串（结构丢失）。
 */
export const OUTPUT_HARD_CAP_BYTES = 64 * 1024;
/** leaf 字符串的最小预算，保证多叶子对象不会因摊薄而每个字段只剩几个字符。 */
const MIN_LEAF_BUDGET = 512;
/** 字节裁剪的最大迭代次数（每次预算减半）。 */
const MAX_CAP_ATTEMPTS = 4;

/**
 * 计算 UTF-8 字节数（无分配，避免为度量而构造 Buffer）。
 * 代理对按 4 字节计，跳过低位代理避免重复计数。
 */
function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i += 1;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function truncStr(value: string, max: number): string {
  if (value.length <= max) return value;
  // 标记格式由 `@openAwork/shared` 统一提供，前端按同一常量解析并渲染「已截断」徽标。
  return value.slice(0, max) + formatToolOutputTruncationMarker(value.length - max);
}

/** 按 UTF-8 字节预算截断（`truncStr` 是字符预算，多字节文本下会超出目标字节数）。 */
function truncStrToBytes(value: string, maxBytes: number): string {
  if (utf8ByteLength(value) <= maxBytes) return value;
  let bytes = 0;
  let end = 0;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    let width = 1;
    if (code >= 0xd800 && code <= 0xdbff) {
      width = 4;
      i += 1;
    } else if (code >= 0x800) {
      width = 3;
    } else if (code >= 0x80) {
      width = 2;
    }
    if (bytes + width > maxBytes) break;
    bytes += width;
    end = i + 1;
  }
  return value.slice(0, end) + `\n…[truncated, ${value.length - end} chars omitted]`;
}

function safeStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value) ?? null;
  } catch {
    return null;
  }
}

/** 统计「会被截断的长字符串」数量，用于把字节预算摊到各叶子上。 */
function countLongLeafStrings(value: unknown): number {
  if (typeof value === 'string') {
    return value.length > SLIM_STRING_MAX ? 1 : 0;
  }
  if (Array.isArray(value)) {
    return value.reduce<number>((sum, item) => sum + countLongLeafStrings(item), 0);
  }
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).reduce<number>(
      (sum, item) => sum + countLongLeafStrings(item),
      0,
    );
  }
  return 0;
}

/** 递归把所有字符串叶子按同一预算裁剪，**保持对象 / 数组结构不变**。 */
function clampLeafStrings(value: unknown, budget: number): unknown {
  if (typeof value === 'string') {
    return truncStrToBytes(value, budget);
  }
  if (Array.isArray(value)) {
    return value.map((item) => clampLeafStrings(item, budget));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = clampLeafStrings(item, budget);
    }
    return out;
  }
  return value;
}

/**
 * 给任意 tool 输出套上字节硬上限。
 *
 * 优先保持结构（batch / bash 卡片依赖对象形状）；只有叶子多得连最小预算都放不下时，
 * 才降级为截断字符串。序列化失败（循环引用等）时原样返回，不因度量失败而丢数据。
 */
function applyOutputByteLimit(value: unknown, maxBytes: number): unknown {
  const serialized = typeof value === 'string' ? value : safeStringify(value);
  if (serialized === null) {
    return value;
  }
  if (utf8ByteLength(serialized) <= maxBytes) {
    return value;
  }
  if (typeof value === 'string') {
    return truncStrToBytes(value, maxBytes);
  }

  const leaves = Math.max(1, countLongLeafStrings(value));
  let budget = Math.max(MIN_LEAF_BUDGET, Math.floor(maxBytes / leaves));
  for (let attempt = 0; attempt < MAX_CAP_ATTEMPTS; attempt += 1) {
    const clamped = clampLeafStrings(value, budget);
    const clampedSerialized = safeStringify(clamped);
    if (clampedSerialized !== null && utf8ByteLength(clampedSerialized) <= maxBytes) {
      return clamped;
    }
    if (budget <= MIN_LEAF_BUDGET) {
      break;
    }
    budget = Math.max(MIN_LEAF_BUDGET, Math.floor(budget / 2));
  }

  return truncStrToBytes(serialized, maxBytes);
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
  //
  // 但「逐字段截断」只约束单字段长度，**不含累加上限**：叶子一多（bash 的
  // stdout/stderr/diffs、batch 的大量子结果）总字节仍可无界。下面这层字节硬上限
  // 在保住结构的前提下兜住累加量，是本函数唯一的总体上界。
  if (isBatchShape || isBashShape) {
    return applyOutputByteLimit(slimmed, OUTPUT_HARD_CAP_BYTES);
  }
  const serialized = JSON.stringify(slimmed);
  if (serialized.length > SLIM_OUTPUT_TOTAL_MAX) {
    return truncStr(serialized, SLIM_OUTPUT_TOTAL_MAX);
  }
  return applyOutputByteLimit(slimmed, OUTPUT_HARD_CAP_BYTES);
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

/**
 * recovery 读模型的默认瘦身开关。
 *
 * 此前瘦身只在调用方传了 `messageLimit` 时生效（`hasTurnLimit` 三元），于是
 * 「没传 limit」的入口拿到的是未瘦身的完整内容：实测单会话 363 个 part /
 * 1535KB（含 86KB 的单条 bash 输出），在 attach 断线重连期间被反复拉取，直接把
 * 主线程打满。是否瘦身**不应**依赖调用方顺手传了哪个参数——漏传是常态而非例外。
 *
 * 因此改为默认生效；确需完整输出（例如把历史持久化到新会话）的调用方显式传
 * `slim: false`。完整转录通道是 `GET /sessions/:id`（本函数只作用于 `/recovery`）。
 */
export function slimMessagesForRecovery(messages: Message[], slim = true): Message[] {
  if (!slim) {
    return messages;
  }
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
  parentSessionId?: string | null;
  team_parent_session_id?: string | null;
  /** 团队会话语义层级（reception/pm1/pm2/executor/reviewer）。chat 会话为 null/缺失。 */
  role_layer?: string | null;
  /** 团队会话子状态机位置（L1.3）。 */
  substate?: string | null;
  /**
   * Session Recovery Enhancement: 会话元数据扩展字段 (2026-08-14)
   * 以下字段用于 Claude Code 兼容的会话恢复功能
   */
  agent_name?: string | null;
  agent_color?: string | null;
  agent_setting?: string | null;
  custom_title?: string | null;
  tag?: string | null;
  mode?: 'normal' | 'coordinator' | null;
  worktree_session?: string | null;
  pr_number?: number | null;
  pr_url?: string | null;
  pr_repository?: string | null;
}

export interface PublicSessionResponse extends SessionResponseLike {
  messages: Message[];
  runEvents: RunEvent[];
  todos: SessionTodo[];
  workflowRuntime: WorkflowRuntimeState;
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
    ...(session.parentSessionId !== undefined ? { parentSessionId: session.parentSessionId } : {}),
    ...(session.team_parent_session_id !== undefined
      ? { team_parent_session_id: session.team_parent_session_id }
      : {}),
    // 团队会话语义字段：透传给前端（reception 空态卡片 / 初始化清单依赖
    // role_layer === 'reception' 才渲染）。chat 会话缺失时为 null。
    ...(session.role_layer !== undefined ? { role_layer: session.role_layer } : {}),
    ...(session.substate !== undefined ? { substate: session.substate } : {}),
    // Session Recovery Enhancement: 会话元数据扩展字段
    ...(session.agent_name !== undefined ? { agent_name: session.agent_name } : {}),
    ...(session.agent_color !== undefined ? { agent_color: session.agent_color } : {}),
    ...(session.agent_setting !== undefined ? { agent_setting: session.agent_setting } : {}),
    ...(session.custom_title !== undefined ? { custom_title: session.custom_title } : {}),
    ...(session.tag !== undefined ? { tag: session.tag } : {}),
    ...(session.mode !== undefined ? { mode: session.mode } : {}),
    ...(session.worktree_session !== undefined
      ? { worktree_session: session.worktree_session }
      : {}),
    ...(session.pr_number !== undefined ? { pr_number: session.pr_number } : {}),
    ...(session.pr_url !== undefined ? { pr_url: session.pr_url } : {}),
    ...(session.pr_repository !== undefined ? { pr_repository: session.pr_repository } : {}),
    messages,
    runEvents,
    todos,
    workflowRuntime: buildWorkflowRuntimeState(session.metadata_json),
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
