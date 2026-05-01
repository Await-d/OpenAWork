import { clampString } from './input-paths.js';

/**
 * Format a tool input field that happens to be an array. We deliberately
 * **never** stringify the array's first element verbatim — that is what
 * caused titles like `batch [{"tool":"bash","parameters":...` and
 * `todowrite [{"content":"...","status":"..."}]` to leak raw JSON into the
 * UI. Instead we summarise: well-known shapes (`tool_calls`, `todos`) get
 * domain-aware text, everything else collapses to `<key>×<count>`.
 */
export function summarizeArrayField(key: string, arr: unknown[]): string {
  if (arr.length === 0) return `${key}: ∅`;

  // batch.tool_calls / arbitrary calls arrays — list the inner tool names.
  if (key === 'tool_calls' || key === 'calls' || key === 'invocations') {
    const names: string[] = [];
    for (const item of arr) {
      if (item && typeof item === 'object') {
        const inner = (item as Record<string, unknown>).tool;
        if (typeof inner === 'string' && inner.trim()) names.push(inner.trim());
      }
    }
    if (names.length === 0) return `${arr.length} 个调用`;
    const unique: string[] = [];
    for (const n of names) if (!unique.includes(n)) unique.push(n);
    const head = unique.slice(0, 3).join(', ');
    const more = unique.length > 3 ? ` +${unique.length - 3}` : '';
    return `${arr.length} 个调用 · ${head}${more}`;
  }

  // todowrite.todos — count by status so the user sees "5 项 · 3待办/2完成".
  if (key === 'todos' && arr.every((it) => it && typeof it === 'object')) {
    let pending = 0;
    let inProgress = 0;
    let completed = 0;
    let cancelled = 0;
    for (const it of arr) {
      const s = (it as Record<string, unknown>).status;
      if (s === 'completed') completed += 1;
      else if (s === 'in_progress') inProgress += 1;
      else if (s === 'cancelled') cancelled += 1;
      else pending += 1;
    }
    const parts: string[] = [];
    if (pending) parts.push(`${pending}待办`);
    if (inProgress) parts.push(`${inProgress}进行中`);
    if (completed) parts.push(`${completed}完成`);
    if (cancelled) parts.push(`${cancelled}取消`);
    return parts.length ? `${arr.length} 项 · ${parts.join('/')}` : `${arr.length} 项`;
  }

  return `${key}×${arr.length}`;
}

/**
 * Format a plain-object value as `{key1, key2, key3}` rather than
 * stringifying it. Same rationale as summarizeArrayField: keep raw JSON
 * out of headers.
 */
export function summarizeObjectField(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined);
  if (keys.length === 0) return '{}';
  const head = keys.slice(0, 3).join(', ');
  const more = keys.length > 3 ? `, +${keys.length - 3}` : '';
  return `{${head}${more}}`;
}

/**
 * Build a human-readable inline summary from tool input parameters.
 * Tries common field names in priority order; arrays/objects are summarised
 * (never stringified) so unknown / MCP / skill tools can't dump raw JSON.
 */
export function buildGenericInputSummary(input: Record<string, unknown>, maxLen = 80): string {
  const priorityKeys = [
    'pattern',
    'query',
    'command',
    'url',
    'filePath',
    'file_path',
    'path',
    'file',
    'skillId',
    'toolName',
    'description',
    'name',
    'target',
    'message',
    'content',
    'text',
    'expression',
  ];
  const seen = new Set<string>();
  const parts: string[] = [];

  const formatValue = (key: string, val: unknown): string | null => {
    if (val === undefined || val === null || val === '') return null;
    if (typeof val === 'string') return clampString(val, 40);
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    if (Array.isArray(val)) return summarizeArrayField(key, val);
    if (typeof val === 'object') return summarizeObjectField(val as Record<string, unknown>);
    return null;
  };

  for (const key of priorityKeys) {
    if (!(key in input)) continue;
    seen.add(key);
    const display = formatValue(key, input[key]);
    if (!display) continue;
    parts.push(display);
    if (parts.join(' · ').length >= maxLen) break;
  }

  // Add remaining fields not covered above. Skip noise keys.
  const noiseKeys = new Set(['options', 'metadata', 'extra', '_batchProgress']);
  for (const [key, val] of Object.entries(input)) {
    if (seen.has(key) || noiseKeys.has(key)) continue;
    if (parts.join(' · ').length >= maxLen) break;
    const display = formatValue(key, val);
    if (!display) continue;
    parts.push(display);
  }

  const result = parts.join(' · ');
  return clampString(result, maxLen);
}

/**
 * Domain-aware title for the `todowrite` / `subtodowrite` family. Returns
 * undefined when the input doesn't look like the todo schema (e.g. malformed
 * tool call) so the caller can fall back to the generic summariser.
 */
export function summarizeTodoWriteInput(input: Record<string, unknown>): string | undefined {
  const todos = input.todos;
  if (!Array.isArray(todos)) return undefined;
  return summarizeArrayField('todos', todos);
}

/**
 * Domain-aware title for `batch`. Lists which tools are being batched.
 */
export function summarizeBatchInput(input: Record<string, unknown>): string | undefined {
  const calls = input.tool_calls ?? input.calls ?? input.invocations;
  if (!Array.isArray(calls)) return undefined;
  return summarizeArrayField('tool_calls', calls);
}

/**
 * Domain-aware title for `question` / `AskUserQuestion`. Pulls the first
 * question's header (preferred) or its question text. Returns undefined
 * when the input doesn't match the expected `{questions: [{header,question,…}]}`
 * schema so the caller can fall back to the generic summariser.
 */
export function summarizeQuestionInput(input: Record<string, unknown>): string | undefined {
  const questions = input.questions;
  if (!Array.isArray(questions) || questions.length === 0) return undefined;
  const first = questions[0];
  if (!first || typeof first !== 'object') return undefined;
  const rec = first as Record<string, unknown>;
  const header = typeof rec.header === 'string' && rec.header.trim() ? rec.header.trim() : '';
  const text = typeof rec.question === 'string' && rec.question.trim() ? rec.question.trim() : '';
  const more = questions.length > 1 ? ` (+${questions.length - 1})` : '';
  if (header && text && header !== text) {
    return `${header} · "${clampString(text, 50)}"${more}`;
  }
  if (header) return `${header}${more}`;
  if (text) return `"${clampString(text, 60)}"${more}`;
  return undefined;
}

/**
 * Domain-aware title for `ExitPlanMode`. Pulls the plan summary (markdown)
 * and clamps it to a one-line preview. Returns undefined when no plan is
 * present so the caller can render a neutral "退出计划模式" label.
 */
export function summarizeExitPlanModeInput(input: Record<string, unknown>): string | undefined {
  const plan = typeof input.plan === 'string' ? input.plan.trim() : '';
  if (!plan) return undefined;
  return `"${clampString(plan, 60)}"`;
}

/**
 * Resolve a background task identifier from the canonical alias triplet
 * `{taskId, task_id, runId}`. Returns the trimmed string or undefined when
 * none of the three fields carry a non-empty value.
 */
function readBackgroundTaskId(input: Record<string, unknown>): string | undefined {
  const t = input.taskId ?? input.task_id ?? input.runId;
  if (typeof t !== 'string') return undefined;
  const trimmed = t.trim();
  return trimmed || undefined;
}

/**
 * Domain-aware title for `background_cancel`. Returns "取消所有后台任务"
 * when `all:true`, `取消 <taskId>` when an id is present, or undefined when
 * the input matches no expected shape (caller renders the bare tool name).
 */
export function summarizeBackgroundCancelInput(input: Record<string, unknown>): string | undefined {
  if (input.all === true) return '取消所有后台任务';
  const tid = readBackgroundTaskId(input);
  return tid ? `取消 ${tid}` : undefined;
}

/**
 * Domain-aware title for `background_output`. Returns just the trimmed task
 * id or undefined when none is present.
 */
export function summarizeBackgroundOutputInput(input: Record<string, unknown>): string | undefined {
  return readBackgroundTaskId(input);
}

/**
 * Domain-aware title for `session_info`. Returns the trimmed `session_id`
 * or undefined when missing.
 */
export function summarizeSessionInfoInput(input: Record<string, unknown>): string | undefined {
  const sid = input.session_id;
  if (typeof sid !== 'string') return undefined;
  const trimmed = sid.trim();
  return trimmed || undefined;
}

/**
 * Domain-aware title for `skill_mcp`. The schema requires `mcp_name` and
 * exactly one of `{tool_name, resource_name, prompt_name}`; render as
 * `<mcp>.<child>` so users see which underlying op the skill is invoking.
 * Falls back to `?` for missing fields rather than dumping JSON.
 */
export function summarizeSkillMcpInput(input: Record<string, unknown>): string {
  const mcp =
    typeof input.mcp_name === 'string' && input.mcp_name.trim() ? input.mcp_name.trim() : '?';
  const child =
    typeof input.tool_name === 'string' && input.tool_name.trim()
      ? input.tool_name.trim()
      : typeof input.resource_name === 'string' && input.resource_name.trim()
        ? input.resource_name.trim()
        : typeof input.prompt_name === 'string' && input.prompt_name.trim()
          ? input.prompt_name.trim()
          : '?';
  return `${mcp}.${child}`;
}

/**
 * Domain-aware title for `mcp_call`. Format: `<serverId>.<toolName> · {arg,arg}`.
 */
export function summarizeMcpCallInput(input: Record<string, unknown>): string {
  const serverId =
    typeof input.serverId === 'string' && input.serverId.trim() ? input.serverId.trim() : '?';
  const toolName =
    typeof input.toolName === 'string' && input.toolName.trim() ? input.toolName.trim() : '?';
  const head = `${serverId}.${toolName}`;
  const rawArgs = input.arguments;
  if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
    const argSummary = summarizeObjectField(rawArgs as Record<string, unknown>);
    if (argSummary && argSummary !== '{}') return `${head} · ${argSummary}`;
  }
  return head;
}
