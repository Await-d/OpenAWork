import { sqliteAll, sqliteGet, sqliteRun } from '../../infra/db.js';
import { resolveAuxiliaryLlmConfig } from '../../provider/auxiliary-llm-config.js';
import { appendSessionMessageV2 } from '../../message/message-v2-adapter.js';
import { getTeamConstitution } from '../../team/team-constitution-store.js';
import { recordTeamRuntimeIncident } from '../../team/team-runtime-diagnostics-store.js';
import {
  completeRunningHandoffById,
  failRunningHandoffById,
  getHandoffById,
  mergeReviewDispositionIntoPayload,
  retryRunningHandoffById,
  type HandoffRecord,
} from '../store/handoff-store.js';
import { submitInboundMessage } from '../store/inbound-store.js';
import { setSubstate } from '../store/substate-store.js';
import { publishHandoffEvent } from '../bus/team-events-bus.js';
import {
  checkAllChildrenCompleted,
  determineFailureDisposition,
  runReviewAggregation,
} from '../workflow/review-aggregator.js';

const inFlightPm2QualityReviews = new Set<string>();
export const QUALITY_REVIEW_RETRY_INTERVAL_MS = 30 * 1000;

interface Pm2HandoffRow {
  id: string;
  payload_json: string;
  result_json: string | null;
  retry_count: number;
  state: string;
  to_session_id: string | null;
  user_id: string;
}

interface Pm2ResultJson {
  qualityReviewLastAttemptAt?: number;
  qualityReviewLastError?: string | null;
  qualityReviewPending?: boolean;
}

export interface Pm2QualityReviewCandidate {
  handoffId: string;
  lastError: string | null;
  lastAttemptAtMs: number | null;
  nextAttemptAtMs: number | null;
  readyNow: boolean;
  sessionId: string | null;
  userId: string;
}

export interface ReconcilePm2QualityReviewResult {
  status: 'completed' | 'failed' | 'noop' | 'reclaimed' | 'retryable-error';
}

export function shouldAttemptPm2QualityReview(
  resultJson: string | null | undefined,
  nowMs: number,
): boolean {
  const parsed = parsePm2ResultJson(resultJson);
  if (!parsed?.qualityReviewPending) {
    return false;
  }
  const lastAttemptAt = parsed.qualityReviewLastAttemptAt;
  if (typeof lastAttemptAt !== 'number') {
    return true;
  }
  return nowMs - lastAttemptAt >= QUALITY_REVIEW_RETRY_INTERVAL_MS;
}

export function listPm2HandoffsReadyForQualityReview(input: {
  nowMs?: number;
  sessionIds?: string[];
  userId?: string;
} = {}): Pm2QualityReviewCandidate[] {
  return listPm2HandoffsPendingQualityReview(input).filter((row) => row.readyNow);
}

export function listPm2HandoffsPendingQualityReview(input: {
  nowMs?: number;
  sessionIds?: string[];
  userId?: string;
} = {}): Pm2QualityReviewCandidate[] {
  const nowMs = input.nowMs ?? Date.now();
  const conditions = [`state = 'running'`, `to_role_layer = 'pm2'`];
  const params: Array<number | string> = [];

  if (input.userId) {
    conditions.push('user_id = ?');
    params.push(input.userId);
  }

  if (input.sessionIds && input.sessionIds.length > 0) {
    const placeholders = input.sessionIds.map(() => '?').join(', ');
    conditions.push(`(from_session_id IN (${placeholders}) OR to_session_id IN (${placeholders}))`);
    params.push(...input.sessionIds, ...input.sessionIds);
  }

  const rows = sqliteAll<{
    id: string;
    result_json: string | null;
    to_session_id: string | null;
    user_id: string;
  }>(
    `SELECT id, result_json, to_session_id, user_id
       FROM handoff_records
      WHERE ${conditions.join(' AND ')}`,
    params,
  );

  return rows
    .map((row) => {
      const parsed = parsePm2ResultJson(row.result_json);
      const lastAttemptAtMs =
        typeof parsed?.qualityReviewLastAttemptAt === 'number'
          ? parsed.qualityReviewLastAttemptAt
          : null;
      const readyNow = shouldAttemptPm2QualityReview(row.result_json, nowMs);
      const nextAttemptAtMs =
        readyNow || lastAttemptAtMs === null
          ? null
          : lastAttemptAtMs + QUALITY_REVIEW_RETRY_INTERVAL_MS;
      return {
        handoffId: row.id,
        lastAttemptAtMs,
        lastError: parsed?.qualityReviewLastError ?? null,
        nextAttemptAtMs,
        readyNow,
        sessionId: row.to_session_id,
        userId: row.user_id,
      };
    })
    .filter((row) => checkAllChildrenCompleted(row.handoffId).allDone)
    .map((row) => ({
      handoffId: row.handoffId,
      lastAttemptAtMs: row.lastAttemptAtMs,
      lastError: row.lastError,
      nextAttemptAtMs: row.nextAttemptAtMs,
      readyNow: row.readyNow,
      sessionId: row.sessionId,
      userId: row.userId,
    }));
}

export function markPm2QualityReviewAttempt(handoffId: string, nowMs = Date.now()): void {
  mergePm2ResultJson(handoffId, {
    qualityReviewLastAttemptAt: nowMs,
    qualityReviewLastError: null,
    qualityReviewPending: true,
  });
}

export function markPm2QualityReviewRetryableFailure(
  handoffId: string,
  errorMessage: string,
  nowMs = Date.now(),
): void {
  mergePm2ResultJson(handoffId, {
    qualityReviewLastAttemptAt: nowMs,
    qualityReviewLastError: errorMessage,
    qualityReviewPending: true,
  });
}

export async function reconcilePm2QualityReview(input: {
  force?: boolean;
  nowMs?: number;
  pm2HandoffId: string;
  userId: string;
}): Promise<ReconcilePm2QualityReviewResult> {
  if (inFlightPm2QualityReviews.has(input.pm2HandoffId)) {
    return { status: 'noop' };
  }
  inFlightPm2QualityReviews.add(input.pm2HandoffId);
  try {
    const row = sqliteGet<Pm2HandoffRow>(
      `SELECT id, payload_json, result_json, retry_count, state, to_session_id, user_id
         FROM handoff_records
        WHERE id = ? AND user_id = ?
        LIMIT 1`,
      [input.pm2HandoffId, input.userId],
    );
    if (!row || row.state !== 'running' || !row.to_session_id) {
      return { status: 'noop' };
    }

    const nowMs = input.nowMs ?? Date.now();
    if (!input.force && !shouldAttemptPm2QualityReview(row.result_json, nowMs)) {
      return { status: 'noop' };
    }

    const { allDone, children } = checkAllChildrenCompleted(row.id);
    if (!allDone) {
      return { status: 'noop' };
    }

    markPm2QualityReviewAttempt(row.id, nowMs);
    const pm2SessionId = row.to_session_id;
    safeSetPm2Substate({
      sessionId: pm2SessionId,
      substate: 'reviewing',
      userId: input.userId,
      roleLayer: 'pm2',
    });

    const payload = parseJsonObject(row.payload_json);
    const resultJson = isRecord(payload?.['resultJson']) ? payload['resultJson'] : null;
    const teamWorkspaceId = typeof payload?.['teamWorkspaceId'] === 'string' ? payload['teamWorkspaceId'] : null;
    const specArtifactId =
      resultJson && typeof resultJson['specArtifactId'] === 'string'
        ? (resultJson['specArtifactId'] as string)
        : null;
    const specContent = specArtifactId
      ? (sqliteGet<{ content: string }>(`SELECT content FROM artifacts WHERE id = ?`, [
          specArtifactId,
        ])?.content ?? '')
      : '';
    const constitutionBody = teamWorkspaceId
      ? (getTeamConstitution({ teamWorkspaceId, userId: input.userId })?.body ?? '')
      : '';

    const llmConfig = await resolveAuxiliaryLlmConfig(input.userId);
    if (llmConfig) {
      const { requestWorkflowLlmCompletion } = await import('../../routes/workflow-llm.js');
      const callLlm = async (system: string, user: string): Promise<string> => {
        return requestWorkflowLlmCompletion({
          apiBaseUrl: llmConfig.apiBaseUrl,
          apiKey: llmConfig.apiKey,
          model: llmConfig.model,
          ...(llmConfig.providerType ? { providerType: llmConfig.providerType } : {}),
          ...(llmConfig.upstreamProtocol
            ? { upstreamProtocol: llmConfig.upstreamProtocol }
            : {}),
          prompt: `${system}\n\n---\n\n${user}`,
          temperature: 0.1,
        });
      };

      const report = await runReviewAggregation({
        userId: input.userId,
        pm2HandoffId: row.id,
        pm2SessionId,
        childHandoffs: children,
        specContent,
        constitutionBody,
        callLlm,
      });

      safeAppendPm2Message({
        sessionId: pm2SessionId,
        userId: input.userId,
        role: 'assistant',
        content: [{ type: 'text', text: report.reportMarkdown }],
      });

      if (report.overallVerdict === 'pass') {
        const didCompletePm2 = completeRunningHandoffById(row.id);
        if (didCompletePm2) {
          const updatedPm2 = getHandoffById(row.id);
          if (updatedPm2) {
            publishHandoffEvent({ type: 'handoff.completed', record: updatedPm2 });
          }
        }
        safeSetPm2Substate({
          sessionId: pm2SessionId,
          substate: 'completed',
          userId: input.userId,
          roleLayer: 'pm2',
        });
        return { status: 'completed' };
      }

      const disposition = determineFailureDisposition({
        escalationRound: row.retry_count ?? 0,
        report,
      });
      const payloadWithDisposition = mergeReviewDispositionIntoPayload(payload, {
        action: disposition.action,
        reason: disposition.reason,
        status: 'pending',
        updatedAtMs: nowMs,
      });
      writePm2PayloadJson(row.id, payloadWithDisposition);

      if (disposition.action === 'redispatch') {
        recordTeamRuntimeIncident({
          category: 'handoff_failure',
          code: 'handoff-quality-review-redispatch',
          context: {
            handoffId: row.id,
            escalationRound: row.retry_count ?? 0,
            toSessionId: pm2SessionId,
          },
          message: disposition.reason,
          severity: 'warning',
          timestamp: nowMs,
          userId: input.userId,
        });
        safeSetPm2Substate({
          sessionId: pm2SessionId,
          substate: 'dispatching',
          userId: input.userId,
          roleLayer: 'pm2',
        });
        safeAppendPm2Message({
          sessionId: pm2SessionId,
          userId: input.userId,
          role: 'assistant',
          content: [{ type: 'text', text: `⚠️ 实现型失败，准备重新派发。原因：${disposition.reason}` }],
        });
        const didRetryPm2 = retryRunningHandoffById(row.id);
        if (didRetryPm2) {
          const updatedPm2 = getHandoffById(row.id);
          if (updatedPm2) {
            publishHandoffEvent({ type: 'handoff.reclaimed', record: updatedPm2 });
          }
        }
        return { status: 'reclaimed' };
      }

      if (disposition.action === 'return-to-c') {
        recordTeamRuntimeIncident({
          category: 'handoff_failure',
          code: 'handoff-quality-review-return-to-c',
          context: {
            handoffId: row.id,
            escalationRound: row.retry_count ?? 0,
            toSessionId: pm2SessionId,
          },
          message: disposition.reason,
          severity: 'warning',
          timestamp: nowMs,
          userId: input.userId,
        });
        safeSetPm2Substate({
          sessionId: pm2SessionId,
          substate: 'escalating',
          userId: input.userId,
          roleLayer: 'pm2',
        });
        safeAppendPm2Message({
          sessionId: pm2SessionId,
          userId: input.userId,
          role: 'assistant',
          content: [{ type: 'text', text: `⚠️ 规划型失败，退回 PM1 重新规划。原因：${disposition.reason}` }],
        });
        submitEscalationToReception({
          payload: {
            pm2HandoffId: row.id,
            reason: disposition.reason,
            source: 'quality-review',
          },
          userId: input.userId,
          pm2HandoffId: row.id,
        });
        const didFailPm2 = failRunningHandoffById({
          handoffId: row.id,
          reason: disposition.reason,
        });
        if (didFailPm2) {
          const updatedPm2 = getHandoffById(row.id);
          if (updatedPm2) {
            publishHandoffEvent({
              type: 'handoff.failed',
              record: updatedPm2,
              payload: { reason: disposition.reason },
            });
          }
        }
        safeSetPm2Substate({
          sessionId: pm2SessionId,
          substate: 'failed',
          userId: input.userId,
          roleLayer: 'pm2',
        });
        return { status: 'failed' };
      }

      recordTeamRuntimeIncident({
        category: 'handoff_failure',
        code: 'handoff-quality-review-escalate-to-user',
        context: {
          handoffId: row.id,
          escalationRound: row.retry_count ?? 0,
          toSessionId: pm2SessionId,
        },
        message: disposition.reason,
        severity: 'error',
        timestamp: nowMs,
        userId: input.userId,
      });
      safeSetPm2Substate({
        sessionId: pm2SessionId,
        substate: 'failed',
        userId: input.userId,
        roleLayer: 'pm2',
      });
      safeAppendPm2Message({
        sessionId: pm2SessionId,
        userId: input.userId,
        role: 'assistant',
        content: [{ type: 'text', text: `🔴 多次重试仍未通过评审，需要用户介入。原因：${disposition.reason}` }],
      });
      submitEscalationToReception({
        payload: {
          escalationRound: row.retry_count ?? 0,
          pm2HandoffId: row.id,
          reason: disposition.reason,
          source: 'quality-review-escalation',
        },
        userId: input.userId,
        pm2HandoffId: row.id,
      });
      const didFailPm2 = failRunningHandoffById({
        handoffId: row.id,
        reason: disposition.reason,
      });
      if (didFailPm2) {
        const updatedPm2 = getHandoffById(row.id);
        if (updatedPm2) {
          publishHandoffEvent({
            type: 'handoff.failed',
            record: updatedPm2,
            payload: { reason: disposition.reason },
          });
        }
      }
      return { status: 'failed' };
    }

    const completed = children.filter((child) => child.state === 'completed').length;
    const failed = children.filter((child) => child.state === 'failed').length;
    const summary = [
      `## 质量评审总结（d.4 降级模式）`,
      '',
      `所有执行层任务已完成（无 LLM 配置，跳过 spec/quality review）：`,
      `- ✅ 成功：${completed}`,
      `- ❌ 失败：${failed}`,
    ].join('\n');
    safeAppendPm2Message({
      sessionId: pm2SessionId,
      userId: input.userId,
      role: 'assistant',
      content: [{ type: 'text', text: summary }],
    });

    if (failed > 0) {
      const reason = `quality-review-degraded-summary-failed:${failed}`;
      writePm2PayloadJson(
        row.id,
        mergeReviewDispositionIntoPayload(payload, {
          action: 'redispatch',
          reason,
          status: 'pending',
          updatedAtMs: nowMs,
        }),
      );
      const didFailPm2 = failRunningHandoffById({
        handoffId: row.id,
        reason,
      });
      if (didFailPm2) {
        const updatedPm2 = getHandoffById(row.id);
        if (updatedPm2) {
          publishHandoffEvent({
            type: 'handoff.failed',
            record: updatedPm2,
            payload: { reason },
          });
        }
      }
      safeSetPm2Substate({
        sessionId: pm2SessionId,
        substate: 'failed',
        userId: input.userId,
        roleLayer: 'pm2',
      });
      return { status: 'failed' };
    }

    const didCompletePm2 = completeRunningHandoffById(row.id);
    if (didCompletePm2) {
      const updatedPm2 = getHandoffById(row.id);
      if (updatedPm2) {
        publishHandoffEvent({ type: 'handoff.completed', record: updatedPm2 });
      }
    }
    safeSetPm2Substate({
      sessionId: pm2SessionId,
      substate: 'completed',
      userId: input.userId,
      roleLayer: 'pm2',
    });
    return { status: 'completed' };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    markPm2QualityReviewRetryableFailure(input.pm2HandoffId, reason, input.nowMs ?? Date.now());
    recordTeamRuntimeIncident({
      category: 'handoff_failure',
      code: 'handoff-quality-review-failed',
      context: {
        handoffId: input.pm2HandoffId,
      },
      message: reason,
      severity: 'warning',
      timestamp: input.nowMs ?? Date.now(),
      userId: input.userId,
    });
    const pm2SessionId = sqliteGet<{ to_session_id: string | null }>(
      `SELECT to_session_id FROM handoff_records WHERE id = ? LIMIT 1`,
      [input.pm2HandoffId],
    )?.to_session_id;
    if (pm2SessionId) {
      safeAppendPm2Message({
        sessionId: pm2SessionId,
        userId: input.userId,
        role: 'assistant',
        content: [{ type: 'text', text: `⚠️ Quality Review 执行失败，将稍后自动重试。原因：${reason}` }],
      });
    }
    return { status: 'retryable-error' };
  } finally {
    inFlightPm2QualityReviews.delete(input.pm2HandoffId);
  }
}

function submitEscalationToReception(input: {
  payload: Record<string, unknown>;
  userId: string;
  pm2HandoffId: string;
}): void {
  const pm2Context = sqliteGet<{ from_session_id: string; to_session_id: string | null }>(
    `SELECT from_session_id, to_session_id FROM handoff_records WHERE id = ? LIMIT 1`,
    [input.pm2HandoffId],
  );
  const receptionSession = sqliteGet<{ from_session_id: string }>(
    `SELECT from_session_id FROM handoff_records
       WHERE to_role_layer = 'pm1' AND to_session_id = (
         SELECT from_session_id FROM handoff_records WHERE id = ?
       ) LIMIT 1`,
    [input.pm2HandoffId],
  );
  if (!receptionSession) {
    return;
  }
  submitInboundMessage({
    userId: input.userId,
    toSessionId: receptionSession.from_session_id,
    fromRoleLayer: 'pm2',
    messageType: 'escalation_request',
    payload: {
      ...input.payload,
      ...(pm2Context?.to_session_id ? { fromSessionId: pm2Context.to_session_id } : {}),
      ...(pm2Context?.from_session_id ? { pm1SessionId: pm2Context.from_session_id } : {}),
      pm2HandoffId: input.pm2HandoffId,
    },
  });
}

function mergePm2ResultJson(handoffId: string, patch: Record<string, unknown>): void {
  const row = sqliteGet<{ result_json: string | null }>(
    `SELECT result_json FROM handoff_records WHERE id = ? LIMIT 1`,
    [handoffId],
  );
  const current = parsePm2ResultJson(row?.result_json);
  sqliteRun(
    `UPDATE handoff_records
        SET result_json = ?,
            updated_at = datetime('now')
      WHERE id = ?`,
    [JSON.stringify({ ...current, ...patch }), handoffId],
  );
}

function writePm2PayloadJson(handoffId: string, payload: unknown): void {
  sqliteRun(
    `UPDATE handoff_records
        SET payload_json = ?,
            updated_at = datetime('now')
      WHERE id = ?`,
    [JSON.stringify(payload ?? {}), handoffId],
  );
}

function parsePm2ResultJson(resultJson: string | null | undefined): Pm2ResultJson | null {
  if (!resultJson) {
    return null;
  }
  try {
    const parsed = JSON.parse(resultJson) as unknown;
    return isRecord(parsed) ? (parsed as Pm2ResultJson) : null;
  } catch {
    return null;
  }
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeAppendPm2Message(input: Parameters<typeof appendSessionMessageV2>[0]): void {
  try {
    appendSessionMessageV2(input);
  } catch (err) {
    console.warn(
      `[pm2-quality-review] appendSessionMessageV2 失败：${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function safeSetPm2Substate(input: Parameters<typeof setSubstate>[0]): void {
  try {
    setSubstate(input);
  } catch (err) {
    console.warn(
      `[pm2-quality-review] setSubstate 失败：${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
