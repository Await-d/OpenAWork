import { sqliteGet } from '../../infra/db.js';
import { checklistItemSchema, type ChecklistItem } from './completion-protocol-contract.js';
import { normalizeComparablePath } from './dispatch-package.js';
import { getSessionToolResultByCallId } from '../../message/message-v2-adapter.js';

export interface ExecutionVerificationContext {
  userId: string;
  sessionId: string;
  handoffId: string;
}

export function executionAttemptRequestId(
  handoffId: string,
  retryCount: number,
  failedRetryCount = 0,
): string {
  return `handoff:${handoffId}${retryCount > 0 ? `:r${retryCount}` : ''}${failedRetryCount > 0 ? `:f${failedRetryCount}` : ''}`;
}

export function verifyExecutionChecklist(
  context: ExecutionVerificationContext,
  checklist: ChecklistItem[],
): ChecklistItem[] {
  const handoff = sqliteGet<{
    retry_count: number;
    failed_retry_count: number;
    payload_json: string | null;
  }>(
    `SELECT retry_count, failed_retry_count, payload_json FROM handoff_records
     WHERE id = ? AND user_id = ? AND to_session_id = ? AND to_role_layer = 'executor'`,
    [context.handoffId, context.userId, context.sessionId],
  );
  const requestId = handoff
    ? executionAttemptRequestId(context.handoffId, handoff.retry_count, handoff.failed_retry_count)
    : null;
  let docs = false;
  try {
    docs = JSON.parse(handoff?.payload_json ?? '{}')?.taskProfile?.kind === 'docs';
  } catch {
    /* 无效派发信息不能豁免 */
  }
  return checklist.map((item) => {
    const refs = item.verificationRefs ?? [];
    const verified =
      item.status === 'pass' &&
      requestId !== null &&
      refs.length > 0 &&
      refs.every((ref) => {
        if (ref.toolCallId && ref.path && docs) {
          const row = sqliteGet<{ data: string }>(
            `SELECT p.data FROM part_v2 p JOIN message_v2 m ON m.id = p.message_id
           WHERE p.session_id = ? AND p.user_id = ? AND p.tool_call_id = ?
             AND json_valid(m.data) AND json_extract(m.data, '$.clientRequestId') IN (?, ?)
           ORDER BY p.time_created DESC LIMIT 1`,
            [context.sessionId, context.userId, ref.toolCallId, requestId, `${requestId}:retry`],
          );
          if (!row) return false;
          try {
            if (JSON.parse(row.data)?.state?.status !== 'completed') return false;
          } catch {
            return false;
          }
          const result = getSessionToolResultByCallId({
            sessionId: context.sessionId,
            userId: context.userId,
            toolCallId: ref.toolCallId,
          });
          if (!result || result.toolName !== 'read' || result.isError) return false;
          let output = result.output;
          if (typeof output === 'string') {
            try {
              output = JSON.parse(output);
            } catch {
              return false;
            }
          }
          if (typeof output !== 'object' || output === null) return false;
          const read = output as Record<string, unknown>;
          return (
            typeof read['path'] === 'string' &&
            typeof read['content'] === 'string' &&
            read['truncated'] === false &&
            read['byteLimitReached'] !== true &&
            normalizeComparablePath(read['path']) === normalizeComparablePath(ref.path)
          );
        }
        if (!ref.terminalId || !ref.command) return false;
        const terminal = sqliteGet<{
          command: string;
          status: string;
          exit_code: number | null;
          ended_at_ms: number | null;
        }>(
          `SELECT command, status, exit_code, ended_at_ms FROM session_terminals
         WHERE terminal_id = ? AND session_id = ? AND user_id = ?
           AND client_request_id IN (?, ?) AND tool_name IN ('bash', 'run_bash_in_background')`,
          [ref.terminalId, context.sessionId, context.userId, requestId, `${requestId}:retry`],
        );
        return (
          terminal?.command === ref.command &&
          terminal.status === 'exited' &&
          terminal.exit_code === 0 &&
          terminal.ended_at_ms !== null &&
          terminal.ended_at_ms <= Date.now()
        );
      });
    return { ...item, verified };
  });
}

export function executionVerificationCoverage(
  context: ExecutionVerificationContext,
  result: unknown,
): { total: number; verified: number } {
  if (typeof result !== 'object' || result === null) return { total: 0, verified: 0 };
  const raw = (result as Record<string, unknown>)['checklist'];
  if (!Array.isArray(raw) || raw.length > 100) return { total: 0, verified: 0 };
  const checklist: ChecklistItem[] = raw.map((item) => {
    const parsed = checklistItemSchema.safeParse(item);
    return parsed.success
      ? parsed.data
      : { id: 'invalid', status: 'blocked', evidence: '无效检查项' };
  });
  return {
    total: checklist.length,
    verified: verifyExecutionChecklist(context, checklist).filter((item) => item.verified).length,
  };
}
