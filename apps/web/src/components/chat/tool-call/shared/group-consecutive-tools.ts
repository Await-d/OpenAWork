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

/** Minimum run length before we collapse into a group pill. */
export const GROUP_MIN_LEN = 2;

export type GroupOrSingle =
  | { kind: 'single'; call: AssistantTraceToolCall; index: number }
  | {
      kind: 'group';
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
 * Walk a tool-call sequence and replace runs of ≥`GROUP_MIN_LEN`
 * consecutive groupable, stable, same-tool calls with a single `group`
 * entry. Approval-pending or in-flight calls always render
 * individually so users see the active state without an extra click.
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
    const lower = cur.toolName.trim().toLowerCase();

    if (!GROUPABLE_TOOL_NAMES.has(lower) || !isStable(cur)) {
      result.push({ kind: 'single', call: cur, index: i });
      i += 1;
      continue;
    }

    let j = i + 1;
    while (j < toolCalls.length) {
      const next = toolCalls[j];
      if (!next) break;
      if (next.toolName.trim().toLowerCase() !== lower) break;
      if (!isStable(next)) break;
      j += 1;
    }

    const runLen = j - i;
    if (runLen >= GROUP_MIN_LEN) {
      result.push({
        kind: 'group',
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
