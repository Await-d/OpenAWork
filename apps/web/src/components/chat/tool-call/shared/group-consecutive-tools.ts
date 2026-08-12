import type { AssistantTraceToolCall } from '@openAwork/shared';

/**
 * Tools eligible for "N 个 · a, b, c" group rendering. These produce
 * short, terse output that's well-summarised by their primary input
 * field, and they tend to come in runs (read 5 files, grep 3 patterns)
 * which dominate read-heavy sessions if rendered as 5 individual cards.
 *
 * Only finalized, non-approval-pending calls are eligible — see
 * `isStable` below. An in-flight or approval-pending call is always
 * surfaced individually so users can see / act on its state.
 *
 * Extended set covers write-shaped tools too: consecutive `edit`s on
 * a single file or a `write` burst when scaffolding a new module both
 * compress to a single pill. Long-output tools like `bash` are also
 * groupable because the pill itself only carries the command summary
 * — full output is one click away after expansion.
 *
 * MCP tools (mcp_* prefix, mcp_call, kind === 'mcp') and skill are
 * also groupable: agents often call several *different* MCP tools
 * back-to-back (e.g. sequential_thinking, then a filesystem read,
 * then another MCP tool), creating long repetitive rows that all
 * belong to the same "MCP 工具" bucket regardless of the specific
 * tool name. We group these by a shared `groupKey` — MCP calls are
 * grouped by kind alone, so a run of *different* mcp_* tools still
 * collapses into a single pill. Similarly, lsp_* tools, session_*
 * tools, and task_* tools often fire in repetitive bursts and are
 * grouped by their common prefix.
 */
export const GROUPABLE_TOOL_NAMES: ReadonlySet<string> = new Set([
  'read',
  'grep',
  'glob',
  'bash',
  'edit',
  'multiedit',
  'write',
  'list',
]);

/**
 * Resolve the "group key" used to decide whether two consecutive calls
 * belong to the same run. Most tools group by their exact name (so a
 * run of `read` calls doesn't merge with a run of `grep` calls), but
 * MCP / lsp / session / task tools group by a coarser bucket so that
 * e.g. `mcp_sequential_thinking` followed by `mcp_filesystem_read`
 * still collapses into a single "调用了 N 次 MCP 工具" pill.
 *
 * Returns `undefined` when the tool is not groupable at all.
 */
export function resolveGroupKey(
  toolName: string,
  kind?: AssistantTraceToolCall['kind'],
): string | undefined {
  const lower = toolName.trim().toLowerCase();

  // MCP calls (by kind, or by name convention) all bucket together,
  // regardless of which specific MCP tool was invoked.
  if (kind === 'mcp' || lower === 'mcp' || lower === 'mcp_call' || lower.startsWith('mcp_')) {
    return 'mcp';
  }
  if (kind === 'skill' || lower === 'skill' || lower === 'skill_mcp') {
    return 'skill';
  }
  if (lower.startsWith('lsp_')) {
    return 'lsp';
  }
  if (lower.startsWith('session_')) {
    return 'session';
  }
  if (lower.startsWith('task_')) {
    return 'task';
  }
  if (lower === 'todoread' || lower === 'subtodoread' || lower === 'todowrite' || lower === 'subtodowrite') {
    return 'todo';
  }
  if (lower === 'websearch' || lower === 'webfetch' || lower === 'google_search') {
    return 'web';
  }
  if (GROUPABLE_TOOL_NAMES.has(lower)) {
    return lower;
  }
  return undefined;
}

/** Minimum run length before we collapse into a group pill. */
export const GROUP_MIN_LEN = 2;

export type GroupOrSingle =
  | { kind: 'single'; call: AssistantTraceToolCall; index: number }
  | {
      kind: 'group';
      /** The group key used to merge this run (e.g. 'mcp', 'read', 'lsp'). */
      groupKey: string;
      /** The toolName of the first call in the run — kept for callers that
       *  still want a representative name (e.g. non-MCP groups). */
      toolName: string;
      calls: AssistantTraceToolCall[];
      startIndex: number;
    };

function isStable(c: AssistantTraceToolCall): boolean {
  const status = c.status ?? 'completed';
  if (status === 'running' || status === 'paused') return false;
  if (c.pendingPermissionRequestId) return false;
  return true;
}

/**
 * Walk a tool-call sequence and replace runs of >=`GROUP_MIN_LEN`
 * consecutive groupable, stable calls sharing the same group key with
 * a single `group` entry. Approval-pending or in-flight calls always
 * render individually so users can see / act on its state.
 *
 * The function is pure and tolerates undefined entries (returned by
 * `Array.prototype.slice` on sparse arrays) so the caller can pass
 * `payload.toolCalls` directly without filtering first.
 */
export function groupConsecutiveTools(
  toolCalls: readonly AssistantTraceToolCall[],
): GroupOrSingle[] {
  const result: GroupOrSingle[] = [];
  let i = 0;
  while (i < toolCalls.length) {
    const cur = toolCalls[i];
    if (!cur) {
      i += 1;
      continue;
    }
    const key = resolveGroupKey(cur.toolName, cur.kind);

    if (key === undefined || !isStable(cur)) {
      result.push({ kind: 'single', call: cur, index: i });
      i += 1;
      continue;
    }

    let j = i + 1;
    while (j < toolCalls.length) {
      const next = toolCalls[j];
      if (!next) break;
      if (resolveGroupKey(next.toolName, next.kind) !== key) break;
      if (!isStable(next)) break;
      j += 1;
    }

    const runLen = j - i;
    if (runLen >= GROUP_MIN_LEN) {
      result.push({
        kind: 'group',
        groupKey: key,
        toolName: cur.toolName,
        calls: toolCalls.slice(i, j),
        startIndex: i,
      });
      i = j;
    } else {
      result.push({ kind: 'single', call: cur, index: i });
      i += 1;
    }
  }
  return result;
}
