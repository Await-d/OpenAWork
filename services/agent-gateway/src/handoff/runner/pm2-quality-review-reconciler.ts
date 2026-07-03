import { sqliteAll, sqliteGet, sqliteRun } from '../../infra/db.js';
import { buildSqlitePlaceholders, chunkSqliteBindValues } from '../../infra/sqlite-batch.js';
import type { ResolvedAuxiliaryLlmConfig } from '../../provider/auxiliary-llm-config.js';
import { appendSessionMessageV2 } from '../../message/message-v2-adapter.js';
import {
  buildAuxiliaryTeamInstructionPrefix,
  prependAuxiliaryTeamInstructionPrefix,
} from '../../team/team-auxiliary-instruction-stack.js';
import {
  extractComparablePathsFromText,
  normalizeComparablePath,
} from '../capability/dispatch-package.js';
import { getTeamConstitution } from '../../team/team-constitution-store.js';
import { recordTeamRuntimeIncident } from '../../team/team-runtime-diagnostics-store.js';
import {
  completeRunningHandoffById,
  failRunningHandoffById,
  getHandoffById,
  mergeReviewDispositionIntoPayload,
  retryRunningHandoffById,
} from '../store/handoff-store.js';
import type { HandoffRecord } from '../store/handoff-store.js';
import { submitInboundMessage } from '../store/inbound-store.js';
import { setSubstate } from '../store/substate-store.js';
import { publishHandoffEvent } from '../bus/team-events-bus.js';
import {
  checkAllChildrenCompleted,
  determineFailureDisposition,
  runReviewAggregation,
} from '../workflow/review-aggregator.js';
import type { ReviewReport } from '../workflow/review-aggregator.js';

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

interface RedispatchOwnershipGuardResult {
  eligible: boolean;
  reason?: string;
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

export function listPm2HandoffsReadyForQualityReview(
  input: {
    nowMs?: number;
    sessionIds?: string[];
    userId?: string;
  } = {},
): Pm2QualityReviewCandidate[] {
  return listPm2HandoffsPendingQualityReview(input).filter((row) => row.readyNow);
}

export function listPm2HandoffsPendingQualityReview(
  input: {
    nowMs?: number;
    sessionIds?: string[];
    userId?: string;
  } = {},
): Pm2QualityReviewCandidate[] {
  const nowMs = input.nowMs ?? Date.now();
  const conditions = [`state = 'running'`, `to_role_layer = 'pm2'`];
  const params: Array<number | string> = [];

  if (input.userId) {
    conditions.push('user_id = ?');
    params.push(input.userId);
  }

  if (input.sessionIds && input.sessionIds.length > 0) {
    const rowsById = new Map<
      string,
      {
        id: string;
        result_json: string | null;
        to_session_id: string | null;
        user_id: string;
      }
    >();
    for (const batchSessionIds of chunkSqliteBindValues(
      input.sessionIds,
      params.length,
      undefined,
      2,
    )) {
      const placeholders = buildSqlitePlaceholders(batchSessionIds.length, ', ');
      const rows = sqliteAll<{
        id: string;
        result_json: string | null;
        to_session_id: string | null;
        user_id: string;
      }>(
        `SELECT id, result_json, to_session_id, user_id
           FROM handoff_records
          WHERE ${[
            ...conditions,
            `(from_session_id IN (${placeholders}) OR to_session_id IN (${placeholders}))`,
          ].join(' AND ')}`,
        [...params, ...batchSessionIds, ...batchSessionIds],
      );
      for (const row of rows) {
        if (!rowsById.has(row.id)) {
          rowsById.set(row.id, row);
        }
      }
    }

    return Array.from(rowsById.values())
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
          lastError: parsed?.qualityReviewLastError ?? null,
          lastAttemptAtMs,
          nextAttemptAtMs,
          readyNow,
          sessionId: row.to_session_id,
          userId: row.user_id,
        };
      })
      .filter((row) => checkAllChildrenCompleted(row.handoffId).allDone)
      .sort(
        (left, right) =>
          (left.lastAttemptAtMs ?? 0) - (right.lastAttemptAtMs ?? 0) ||
          left.handoffId.localeCompare(right.handoffId),
      );
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

function collectChildTaskScopePaths(children: readonly (HandoffRecord | undefined)[]): Set<string> {
  const values = new Set<string>();
  for (const child of children) {
    if (!child) {
      continue;
    }
    const payload =
      typeof child.payload === 'object' && child.payload !== null && !Array.isArray(child.payload)
        ? (child.payload as Record<string, unknown>)
        : null;
    const resultJson =
      typeof child.resultJson === 'object' &&
      child.resultJson !== null &&
      !Array.isArray(child.resultJson)
        ? (child.resultJson as Record<string, unknown>)
        : null;
    const explicitOwnedPaths = Array.isArray(payload?.['ownedPaths'])
      ? payload['ownedPaths']
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
          .map((value) => normalizeComparablePath(value))
      : [];
    for (const path of explicitOwnedPaths) {
      values.add(path);
    }
    if (explicitOwnedPaths.length > 0) {
      continue;
    }

    const goal = typeof payload?.['goal'] === 'string' ? payload['goal'] : '';
    const taskTitle = typeof resultJson?.['taskTitle'] === 'string' ? resultJson['taskTitle'] : '';
    for (const text of [goal, taskTitle]) {
      for (const path of extractComparablePathsFromText(text)) {
        values.add(path);
      }
    }
  }
  return values;
}

/**
 * 自动回收只允许处理当前 PM2 这轮 handoff 子树显式覆盖的任务文件。
 *
 * 现有 runtime 没有“全局并发写文件归因”索引，所以这里采用保守守卫：
 * 只有当评审问题提到的文件路径能和当前子任务 scope 对上时，才允许
 * 自动回收（redispatch / return-to-c）。若问题只命中外部文件范围，则停止
 * 自动修正，改为人工介入。
 *
 * 这是 fail-safe 而非完美因果分析：
 * - 没有具体文件路径 → 不拦截（避免误伤正常自动回收）
 * - 同时提到 in-scope 与 out-of-scope 文件 → 不拦截（视为共享边界的模糊案例）
 * - 只提到 out-of-scope 文件 → 拦截，防止 PM2 去修别人链路里的问题
 */
function assessAutoRemediationOwnershipScope(input: {
  children: readonly ReturnType<typeof getHandoffById>[];
  report: ReviewReport;
}): RedispatchOwnershipGuardResult {
  if (input.report.overallVerdict === 'pass') {
    return { eligible: true };
  }

  const scopedPaths = collectChildTaskScopePaths(input.children);
  if (scopedPaths.size === 0) {
    return { eligible: true };
  }

  const mentionedPaths = Array.from(
    new Set(
      [...input.report.specIssues, ...input.report.qualityIssues].flatMap((issue) =>
        extractComparablePathsFromText(issue),
      ),
    ),
  );
  if (mentionedPaths.length === 0) {
    return { eligible: true };
  }

  const inScope = mentionedPaths.filter((path) => scopedPaths.has(path));
  const outOfScope = mentionedPaths.filter((path) => !scopedPaths.has(path));
  if (outOfScope.length === 0 || inScope.length > 0) {
    return { eligible: true };
  }

  return {
    eligible: false,
    reason: `质量评审命中了当前 PM2 派发范围外的文件（${outOfScope
      .slice(0, 3)
      .join('、')}），已停止自动修正，需人工确认是否属于其它角色或并发修改导致。`,
  };
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
    // 即使没有 qualityReviewPending 标记（PM2 runner 可能在设置它之前就崩溃了），
    // 也检查子任务是否全部完成。如果全部终态，直接触发 quality review，
    // 避免 PM2 永远卡在 running 状态。
    if (!input.force && !shouldAttemptPm2QualityReview(row.result_json, nowMs)) {
      // 检查 PM2 是否已退回 PM1（result_json 中无 dispatchedHandoffIds 且
      // qualityReviewPending=false）——这种情况不应触发质量评审。
      // PM2 runner 在退回 PM1 时设置了 qualityReviewPending: false，
      // 且没有创建任何子 handoff，所以 result_json 中没有 dispatchedHandoffIds。
      let parsedResult: Record<string, unknown> | null = null;
      try {
        parsedResult = row.result_json
          ? (JSON.parse(row.result_json) as Record<string, unknown>)
          : null;
      } catch {
        /* ignore */
      }
      const dispatchedHandoffIds = parsedResult?.['dispatchedHandoffIds'];
      const hasDispatched = Array.isArray(dispatchedHandoffIds) && dispatchedHandoffIds.length > 0;
      if (!hasDispatched) {
        // PM2 没有派发任何子任务——可能是退回 PM1 的路径，
        // 或者 PM2 runner 还没执行到派发步骤。跳过质量评审。
        return { status: 'noop' };
      }

      // 二次检查：子任务是否全部完成
      const quickCheck = checkAllChildrenCompleted(row.id);
      if (!quickCheck.allDone) {
        return { status: 'noop' };
      }
      // 子任务全部完成但没有 qualityReviewPending 标记 → 降级触发
    }

    const { allDone, children } = checkAllChildrenCompleted(row.id);
    if (!allDone) {
      return { status: 'noop' };
    }
    // 没有子任务（PM2 退回了 PM1，没有派发 executor/reviewer）→ 不触发质量评审
    if (children.length === 0) {
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
    const teamWorkspaceId =
      typeof payload?.['teamWorkspaceId'] === 'string' ? payload['teamWorkspaceId'] : null;
    const specArtifactId =
      resultJson && typeof resultJson['specArtifactId'] === 'string'
        ? resultJson['specArtifactId']
        : null;
    const specContent = specArtifactId
      ? (sqliteGet<{ content: string }>(`SELECT content FROM artifacts WHERE id = ?`, [
          specArtifactId,
        ])?.content ?? '')
      : '';
    const constitutionBody = teamWorkspaceId
      ? (getTeamConstitution({ teamWorkspaceId, userId: input.userId })?.body ?? '')
      : '';

    const llmConfigs = await resolveQualityReviewLlmConfigs(input.userId);
    if (llmConfigs.length > 0) {
      const { requestWorkflowLlmCompletion } = await import('../../routes/workflow-llm.js');
      const instructionPrefix = await buildAuxiliaryTeamInstructionPrefix({
        userId: input.userId,
        sessionId: pm2SessionId,
        teamWorkspaceId,
        roleLayer: 'pm2',
      });
      const callLlm = async (system: string, user: string): Promise<string> => {
        const candidateErrors: string[] = [];
        let index = 0;
        for (const llmConfig of llmConfigs) {
          index += 1;
          try {
            return await requestWorkflowLlmCompletion({
              apiBaseUrl: llmConfig.apiBaseUrl,
              apiKey: llmConfig.apiKey,
              model: llmConfig.model,
              ...(llmConfig.providerType ? { providerType: llmConfig.providerType } : {}),
              ...(llmConfig.upstreamProtocol
                ? { upstreamProtocol: llmConfig.upstreamProtocol }
                : {}),
              prompt: `${prependAuxiliaryTeamInstructionPrefix({
                instructionPrefix,
                prompt: system,
              })}\n\n---\n\n${user}`,
              temperature: 0.1,
              usageContext: {
                userId: input.userId,
                sessionId: pm2SessionId,
                layer: 'pm2',
                ...(typeof llmConfig.inputPricePerMillion === 'number'
                  ? { inputPricePerMillion: llmConfig.inputPricePerMillion }
                  : {}),
                ...(typeof llmConfig.outputPricePerMillion === 'number'
                  ? { outputPricePerMillion: llmConfig.outputPricePerMillion }
                  : {}),
              },
            });
          } catch (err) {
            const reason = errorToMessage(err);
            candidateErrors.push(`候选 ${index}: ${reason}`);
            if (index < llmConfigs.length) {
              console.warn(
                `[pm2-quality-review] 辅助 LLM 候选 ${index} 调用失败，尝试下一个：${reason}`,
              );
            }
          }
        }
        throw new Error(buildAllCandidatesFailedMessage(candidateErrors));
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

        // 向 reception session 回写最终完成消息，让用户在 reception 对话流中
        // 看到团队任务已全部完成。链路：pm2.from_session_id → pm1 session →
        // pm1 handoff.from_session_id → reception session。
        try {
          const pm1SessionId = sqliteGet<{ from_session_id: string }>(
            `SELECT from_session_id FROM handoff_records WHERE id = ? LIMIT 1`,
            [row.id],
          )?.from_session_id;
          if (pm1SessionId) {
            const receptionSessionId = sqliteGet<{ from_session_id: string }>(
              `SELECT from_session_id FROM handoff_records
               WHERE to_role_layer = 'pm1' AND to_session_id = ?
               ORDER BY created_at DESC LIMIT 1`,
              [pm1SessionId],
            )?.from_session_id;
            if (receptionSessionId) {
              appendSessionMessageV2({
                sessionId: receptionSessionId,
                userId: input.userId,
                role: 'assistant',
                agentId: 'interaction-agent',
                content: [
                  {
                    type: 'text',
                    text: '✅ 团队任务已全部完成！所有子任务均已通过质量评审。你可以查看各层级的对话记录和产出物。',
                  },
                ],
                clientRequestId: `pm2:${row.id}:team-completed`,
              });
            }
          }
        } catch (receptionErr) {
          console.warn(
            `[pm2-quality-review] 向 reception 回写完成消息失败：${receptionErr instanceof Error ? receptionErr.message : String(receptionErr)}`,
          );
        }

        return { status: 'completed' };
      }

      const disposition = determineFailureDisposition({
        escalationRound: row.retry_count ?? 0,
        report,
      });
      const ownershipGuard =
        disposition.action === 'redispatch' || disposition.action === 'return-to-c'
          ? assessAutoRemediationOwnershipScope({ children, report })
          : { eligible: true };
      const effectiveDisposition = !ownershipGuard.eligible
        ? {
            action: 'escalate-to-user' as const,
            reason: ownershipGuard.reason ?? disposition.reason,
          }
        : disposition;
      const payloadWithDisposition = mergeReviewDispositionIntoPayload(payload, {
        action: effectiveDisposition.action,
        reason: effectiveDisposition.reason,
        status: 'pending',
        updatedAtMs: nowMs,
      });
      writePm2PayloadJson(row.id, payloadWithDisposition);

      if (effectiveDisposition.action === 'redispatch') {
        recordTeamRuntimeIncident({
          category: 'handoff_failure',
          code: 'handoff-quality-review-redispatch',
          context: {
            handoffId: row.id,
            escalationRound: row.retry_count ?? 0,
            toSessionId: pm2SessionId,
          },
          message: effectiveDisposition.reason,
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
          content: [
            {
              type: 'text',
              text: `⚠️ 实现型失败，准备重新派发。原因：${effectiveDisposition.reason}`,
            },
          ],
        });

        // 向 reception session 写消息让用户知道执行层在自动重试
        try {
          const pm1SessionId = sqliteGet<{ from_session_id: string }>(
            `SELECT from_session_id FROM handoff_records WHERE id = ? LIMIT 1`,
            [row.id],
          )?.from_session_id;
          if (pm1SessionId) {
            const receptionSessionId = sqliteGet<{ from_session_id: string }>(
              `SELECT from_session_id FROM handoff_records
               WHERE to_role_layer = 'pm1' AND to_session_id = ?
               ORDER BY created_at DESC LIMIT 1`,
              [pm1SessionId],
            )?.from_session_id;
            if (receptionSessionId) {
              appendSessionMessageV2({
                sessionId: receptionSessionId,
                userId: input.userId,
                role: 'assistant',
                agentId: 'interaction-agent',
                content: [
                  {
                    type: 'text',
                    text: [
                      `🔄 执行层部分任务失败，PM2 正在自动重新派发（第 ${(row.retry_count ?? 0) + 1} 轮）…`,
                      '',
                      '**失败原因**：',
                      effectiveDisposition.reason,
                      '',
                      'PM2 将重新派发执行任务，让 executor/reviewer 重新执行。',
                    ].join('\n'),
                  },
                ],
                clientRequestId: `pm2:${row.id}:redispatch-notice`,
              });
            }
          }
        } catch {
          /* best-effort */
        }

        const didRetryPm2 = retryRunningHandoffById(row.id);
        if (didRetryPm2) {
          const updatedPm2 = getHandoffById(row.id);
          if (updatedPm2) {
            publishHandoffEvent({ type: 'handoff.reclaimed', record: updatedPm2 });
          }
        }
        return { status: 'reclaimed' };
      }

      if (effectiveDisposition.action === 'return-to-c') {
        recordTeamRuntimeIncident({
          category: 'handoff_failure',
          code: 'handoff-quality-review-return-to-c',
          context: {
            handoffId: row.id,
            escalationRound: row.retry_count ?? 0,
            toSessionId: pm2SessionId,
          },
          message: effectiveDisposition.reason,
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

        // 构建质量反馈摘要：把评审报告中的具体问题整理成 PM1 能理解的反馈
        const qualityFeedback = [
          `## 质量评审反馈（第 ${row.retry_count ?? 0} 轮）`,
          '',
          `**退回原因**：${effectiveDisposition.reason}`,
          '',
          `**Spec Review 问题**：`,
          ...(report.specIssues.length > 0
            ? report.specIssues.map((issue, idx) => `${idx + 1}. ${issue}`)
            : ['- 无具体问题']),
          '',
          `**Quality Review 问题**：`,
          ...(report.qualityIssues.length > 0
            ? report.qualityIssues.map((issue, idx) => `${idx + 1}. ${issue}`)
            : ['- 无具体问题']),
          '',
          `**PM1 需要根据以上反馈修正 spec/plan/tasks，重点解决评审中指出的问题。**`,
        ].join('\n');

        safeAppendPm2Message({
          sessionId: pm2SessionId,
          userId: input.userId,
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: `⚠️ 规划型失败，自动退回 PM1 重新规划。\n\n${qualityFeedback}`,
            },
          ],
        });
        submitEscalationToReception({
          payload: {
            pm2HandoffId: row.id,
            reason: effectiveDisposition.reason,
            source: 'quality-review',
          },
          userId: input.userId,
          pm2HandoffId: row.id,
        });
        const didFailPm2 = failRunningHandoffById({
          handoffId: row.id,
          reason: effectiveDisposition.reason,
        });
        if (didFailPm2) {
          const updatedPm2 = getHandoffById(row.id);
          if (updatedPm2) {
            publishHandoffEvent({
              type: 'handoff.failed',
              record: updatedPm2,
              payload: { reason: effectiveDisposition.reason },
            });
          }
        }
        safeSetPm2Substate({
          sessionId: pm2SessionId,
          substate: 'escalating',
          userId: input.userId,
          roleLayer: 'pm2',
        });

        // 自动创建新的 reception→PM1 handoff，带上质量反馈让 PM1 重新规划。
        // 查找原始的 reception session 和 sourceIntent：
        // PM2 handoff.from_session_id = PM1 session
        // PM1 handoff.from_session_id = reception session
        try {
          const pm1SessionId = sqliteGet<{ from_session_id: string }>(
            `SELECT from_session_id FROM handoff_records WHERE id = ? LIMIT 1`,
            [row.id],
          )?.from_session_id;
          if (pm1SessionId) {
            const receptionHandoff = sqliteGet<{ from_session_id: string; payload_json: string }>(
              `SELECT from_session_id, payload_json FROM handoff_records
                WHERE to_role_layer = 'pm1' AND to_session_id = ?
                ORDER BY created_at DESC LIMIT 1`,
              [pm1SessionId],
            );
            if (receptionHandoff?.from_session_id) {
              const receptionSessionId = receptionHandoff.from_session_id;
              const originalPayload = parseJsonObject(receptionHandoff.payload_json);
              const sourceIntent =
                typeof originalPayload?.['sourceIntent'] === 'string'
                  ? originalPayload['sourceIntent']
                  : '未提供意图';
              const teamWorkspaceId =
                typeof originalPayload?.['teamWorkspaceId'] === 'string'
                  ? originalPayload['teamWorkspaceId']
                  : null;

              const { createHandoff } = await import('../store/handoff-store.js');
              const newPm1Handoff = createHandoff({
                userId: input.userId,
                fromSessionId: receptionSessionId,
                fromRoleLayer: 'reception',
                toRoleLayer: 'pm1',
                idempotencyKey: `quality-feedback:pm1-replan:${row.id}`,
                payload: {
                  sourceIntent,
                  rewrittenIntent: `【质量评审退回重新规划】${sourceIntent}\n\n---\n\n${qualityFeedback}`,
                  recommendedRole: 'planner',
                  recommendedNextStep:
                    '根据质量评审反馈修正 spec/plan/tasks，重点解决评审中指出的问题。',
                  teamWorkspaceId,
                  isQualityFeedback: true,
                  qualityFeedback,
                  previousPm2HandoffId: row.id,
                  escalationRound: (row.retry_count ?? 0) + 1,
                },
              });
              publishHandoffEvent({ type: 'handoff.created', record: newPm1Handoff });

              // 向 reception session 写消息让用户知道团队在自动修正，并附带具体反馈
              try {
                appendSessionMessageV2({
                  sessionId: receptionSessionId,
                  userId: input.userId,
                  role: 'assistant',
                  agentId: 'interaction-agent',
                  content: [
                    {
                      type: 'text',
                      text: [
                        `🔄 质量评审发现规划问题，已自动退回 PM1 重新规划（第 ${(row.retry_count ?? 0) + 1} 轮）。`,
                        '',
                        '**评审反馈**：',
                        qualityFeedback,
                        '',
                        'PM1 将根据以上反馈修正方案后重新提交给 PM2 审查。',
                      ].join('\n'),
                    },
                  ],
                  clientRequestId: `pm2:${row.id}:auto-return-to-c`,
                });
              } catch {
                /* best-effort */
              }
            }
          }
        } catch (replanErr) {
          console.warn(
            `[pm2-quality-review] 自动退回 PM1 重新规划失败：${replanErr instanceof Error ? replanErr.message : String(replanErr)}`,
          );
        }

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
        message: effectiveDisposition.reason,
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
        content: [
          {
            type: 'text',
            text: `🔴 多次自动修正仍未通过评审，需要用户介入。\n\n**退回原因**：${effectiveDisposition.reason}\n\n**Spec Review 问题**：\n${report.specIssues.length > 0 ? report.specIssues.map((s, i) => `${i + 1}. ${s}`).join('\n') : '无'}\n\n**Quality Review 问题**：\n${report.qualityIssues.length > 0 ? report.qualityIssues.map((s, i) => `${i + 1}. ${s}`).join('\n') : '无'}`,
          },
        ],
      });
      // 向 reception 写详细的问题反馈，让用户能看到具体的评审问题而非只看到"需要介入"
      try {
        const pm1SessionId = sqliteGet<{ from_session_id: string }>(
          `SELECT from_session_id FROM handoff_records WHERE id = ? LIMIT 1`,
          [row.id],
        )?.from_session_id;
        if (pm1SessionId) {
          const receptionSessionId = sqliteGet<{ from_session_id: string }>(
            `SELECT from_session_id FROM handoff_records
             WHERE to_role_layer = 'pm1' AND to_session_id = ?
             ORDER BY created_at DESC LIMIT 1`,
            [pm1SessionId],
          )?.from_session_id;
          if (receptionSessionId) {
            appendSessionMessageV2({
              sessionId: receptionSessionId,
              userId: input.userId,
              role: 'assistant',
              agentId: 'interaction-agent',
              content: [
                {
                  type: 'text',
                  text: [
                    `🔴 团队已自动修正 ${row.retry_count ?? 0} 轮仍未通过质量评审，需要你的帮助。`,
                    '',
                    `**具体问题**：`,
                    `**退回原因**：${effectiveDisposition.reason}`,
                    report.specIssues.length > 0
                      ? `**Spec 问题**：\n${report.specIssues.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
                      : '',
                    report.qualityIssues.length > 0
                      ? `**质量问题**：\n${report.qualityIssues.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
                      : '',
                    '',
                    '你可以：调整需求描述后重新发起，或直接告诉团队如何修正这些问题。',
                  ]
                    .filter(Boolean)
                    .join('\n'),
                },
              ],
              clientRequestId: `pm2:${row.id}:escalate-to-user`,
            });
          }
        }
      } catch {
        /* best-effort */
      }
      submitEscalationToReception({
        payload: {
          escalationRound: row.retry_count ?? 0,
          pm2HandoffId: row.id,
          reason: effectiveDisposition.reason,
          source: 'quality-review-escalation',
        },
        userId: input.userId,
        pm2HandoffId: row.id,
      });
      const didFailPm2 = failRunningHandoffById({
        handoffId: row.id,
        reason: effectiveDisposition.reason,
      });
      if (didFailPm2) {
        const updatedPm2 = getHandoffById(row.id);
        if (updatedPm2) {
          publishHandoffEvent({
            type: 'handoff.failed',
            record: updatedPm2,
            payload: { reason: effectiveDisposition.reason },
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
      // 不直接 failed 停止，改为重试 PM2（让 executor 重新执行失败的任务）。
      // 检查重试次数，超过上限才 failed。
      const currentRetryCount = row.retry_count ?? 0;
      if (currentRetryCount >= 4) {
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
      // 重试 PM2
      safeSetPm2Substate({
        sessionId: pm2SessionId,
        substate: 'dispatching',
        userId: input.userId,
        roleLayer: 'pm2',
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
        content: [
          { type: 'text', text: `⚠️ Quality Review 执行失败，将稍后自动重试。原因：${reason}` },
        ],
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

async function resolveQualityReviewLlmConfigs(
  userId: string,
): Promise<ResolvedAuxiliaryLlmConfig[]> {
  const auxiliaryLlmConfig = await import('../../provider/auxiliary-llm-config.js');
  if (typeof auxiliaryLlmConfig.resolveAuxiliaryLlmConfigCandidates === 'function') {
    return auxiliaryLlmConfig.resolveAuxiliaryLlmConfigCandidates(userId);
  }
  const single = await auxiliaryLlmConfig.resolveAuxiliaryLlmConfig(userId);
  return single ? [single] : [];
}

function errorToMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function buildAllCandidatesFailedMessage(candidateErrors: string[]): string {
  if (candidateErrors.length === 0) {
    return '辅助 LLM 候选为空';
  }
  if (candidateErrors.length === 1) {
    return candidateErrors[0]?.replace(/^候选 1: /, '') ?? '辅助 LLM 调用失败';
  }
  return `所有辅助 LLM 候选均失败：${candidateErrors.join('；')}`;
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
