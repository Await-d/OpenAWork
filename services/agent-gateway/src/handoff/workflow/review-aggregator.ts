/**
 * 260516-team-phase-d · T-05 / T-06 / T-07
 *
 * Review 聚合器：收集 e/f/g 回写结果 → 触发双重 review → 生成 report → 失败分流。
 *
 * 触发时机：watcher 检测到某个 d 层 handoff 的所有子 handoff 都到达终态时调用。
 *
 * 双重 review：
 *   1. Spec Review：对照 spec 检查实现是否覆盖所有验收场景
 *   2. Quality Review：检查代码质量 / 宪法合规 / 风险点
 *
 * 失败分流（D29 B3）：
 *   - 实现型失败（代码 bug / 测试不过）→ 重派给 e/f/g
 *   - 规划型失败（需求理解错误 / 架构不合理）→ 退回 c
 *   - escalation_round ≥ 2 → 升级给用户
 */

import { randomUUID } from 'node:crypto';
import { sqliteAll, sqliteGet, sqliteRun } from '../../infra/db.js';
import { type HandoffRecord } from '../store/handoff-store.js';
import { publishTeamEvent } from '../bus/team-events-bus.js';
import { deriveQualityReviewDisposition } from '../../team/team-failure-policy.js';

export interface ReviewInput {
  userId: string;
  pm2HandoffId: string;
  pm2SessionId: string;
  childHandoffs: HandoffRecord[];
  specContent: string;
  constitutionBody: string;
  callLlm: (system: string, user: string) => Promise<string>;
}

export interface ReviewReport {
  specReviewPassed: boolean;
  qualityReviewPassed: boolean;
  specIssues: string[];
  qualityIssues: string[];
  overallVerdict: 'pass' | 'implementation-failure' | 'planning-failure';
  reportMarkdown: string;
}

export type FailureDisposition =
  | { action: 'redispatch'; reason: string }
  | { action: 'return-to-c'; reason: string }
  | { action: 'escalate-to-user'; reason: string };

// ─── 双重 Review ────────────────────────────────────────────────────────────

async function runSpecReview(input: {
  specContent: string;
  childResults: string;
  callLlm: ReviewInput['callLlm'];
}): Promise<{ passed: boolean; issues: string[] }> {
  const system = `你是 Spec Review 审查员。对照 spec 中的验收场景，检查实现结果是否覆盖。

输出格式：
PASS（全部覆盖）
或
ISSUE: [未覆盖的验收场景描述]
ISSUE: [另一个]`;

  const user = `<spec>\n${input.specContent}\n</spec>\n\n<implementation-results>\n${input.childResults}\n</implementation-results>`;
  const result = await input.callLlm(system, user);
  const lines = result
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.some((l) => l === 'PASS') && !lines.some((l) => l.startsWith('ISSUE:'))) {
    return { passed: true, issues: [] };
  }
  const issues = lines
    .filter((l) => l.startsWith('ISSUE:'))
    .map((l) => l.replace(/^ISSUE:\s*/, ''));
  return { passed: issues.length === 0, issues };
}

async function runQualityReview(input: {
  constitutionBody: string;
  childResults: string;
  callLlm: ReviewInput['callLlm'];
}): Promise<{ passed: boolean; issues: string[] }> {
  const system = `你是 Quality Review 审查员。检查实现结果的代码质量和宪法合规性。

输出格式：
PASS
或
ISSUE: [质量问题描述]
ISSUE: [宪法违反描述]`;

  const user = `<constitution>\n${input.constitutionBody}\n</constitution>\n\n<implementation-results>\n${input.childResults}\n</implementation-results>`;
  const result = await input.callLlm(system, user);
  const lines = result
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.some((l) => l === 'PASS') && !lines.some((l) => l.startsWith('ISSUE:'))) {
    return { passed: true, issues: [] };
  }
  const issues = lines
    .filter((l) => l.startsWith('ISSUE:'))
    .map((l) => l.replace(/^ISSUE:\s*/, ''));
  return { passed: issues.length === 0, issues };
}

// ─── Report 生成 ────────────────────────────────────────────────────────────

function generateReportMarkdown(report: Omit<ReviewReport, 'reportMarkdown'>): string {
  const lines: string[] = [
    '# Review Report',
    '',
    `**总体判定**：${report.overallVerdict === 'pass' ? '✅ 通过' : report.overallVerdict === 'implementation-failure' ? '❌ 实现型失败' : '❌ 规划型失败'}`,
    '',
    '## Spec Review',
    '',
    report.specReviewPassed ? '✅ 全部验收场景已覆盖' : '❌ 存在未覆盖的验收场景：',
    ...report.specIssues.map((i) => `- ${i}`),
    '',
    '## Quality Review',
    '',
    report.qualityReviewPassed ? '✅ 代码质量和宪法合规' : '❌ 存在质量/合规问题：',
    ...report.qualityIssues.map((i) => `- ${i}`),
  ];
  return lines.join('\n');
}

// ─── 失败分流（D29 B3） ─────────────────────────────────────────────────────

export function determineFailureDisposition(input: {
  report: ReviewReport;
  escalationRound: number;
}): FailureDisposition {
  const disposition = deriveQualityReviewDisposition({
    escalationRound: input.escalationRound,
    qualityIssues: input.report.qualityIssues,
    qualityReviewPassed: input.report.qualityReviewPassed,
    specIssues: input.report.specIssues,
    specReviewPassed: input.report.specReviewPassed,
  });
  return {
    action: disposition.action,
    reason: disposition.reason,
  };
}

// ─── 主流程 ─────────────────────────────────────────────────────────────────

export async function runReviewAggregation(input: ReviewInput): Promise<ReviewReport> {
  // 收集所有子 handoff 的结果
  const childResults = input.childHandoffs
    .map((h) => {
      const resultRow = sqliteGet<{ result_json: string | null }>(
        `SELECT result_json FROM handoff_records WHERE id = ?`,
        [h.id],
      );
      return `[${h.toRoleLayer}:${h.id}] ${resultRow?.result_json ?? '(无结果)'}`;
    })
    .join('\n\n');

  // 并行跑 spec review + quality review
  const [specResult, qualityResult] = await Promise.all([
    runSpecReview({
      specContent: input.specContent,
      childResults,
      callLlm: input.callLlm,
    }),
    runQualityReview({
      constitutionBody: input.constitutionBody,
      childResults,
      callLlm: input.callLlm,
    }),
  ]);

  // 判定总体结果
  let overallVerdict: ReviewReport['overallVerdict'] = 'pass';
  if (!specResult.passed) overallVerdict = 'planning-failure';
  else if (!qualityResult.passed) overallVerdict = 'implementation-failure';

  const reportData: Omit<ReviewReport, 'reportMarkdown'> = {
    specReviewPassed: specResult.passed,
    qualityReviewPassed: qualityResult.passed,
    specIssues: specResult.issues,
    qualityIssues: qualityResult.issues,
    overallVerdict,
  };

  const reportMarkdown = generateReportMarkdown(reportData);
  const report: ReviewReport = { ...reportData, reportMarkdown };

  // 写入 review_report artifact
  const reportArtifactId = randomUUID();
  sqliteRun(
    `INSERT INTO artifacts (id, session_id, user_id, type, title, content, version, phase)
     VALUES (?, ?, ?, 'markdown', 'Review Report', ?, 1, 'review')`,
    [reportArtifactId, input.pm2SessionId, input.userId, reportMarkdown],
  );

  // 写入 d 层 handoff 的 result_json
  sqliteRun(
    `UPDATE handoff_records SET result_json = ?, updated_at = datetime('now') WHERE id = ?`,
    [
      JSON.stringify({
        reviewReportArtifactId: reportArtifactId,
        overallVerdict: report.overallVerdict,
        specReviewPassed: report.specReviewPassed,
        qualityReviewPassed: report.qualityReviewPassed,
      }),
      input.pm2HandoffId,
    ],
  );

  // 推送事件
  publishTeamEvent({
    type: report.overallVerdict === 'pass' ? 'handoff.completed' : 'handoff.failed',
    taskId: input.pm2HandoffId,
    sessionId: input.pm2SessionId,
    layer: 'pm2',
    timestamp: Date.now(),
    payload: {
      overallVerdict: report.overallVerdict,
      reportArtifactId,
    },
    userId: input.userId,
  });

  return report;
}

/**
 * Parse a child handoff's `payload_json` without letting one corrupt row
 * throw the whole `children.map(...)` below. `checkAllChildrenCompleted` is
 * called on every watcher tick by `pm2-quality-review-reconciler`; an
 * unguarded `JSON.parse` on a single corrupt child payload (crash mid-write,
 * disk error, hand-edited DB) used to throw the entire mapping, which — even
 * with the per-candidate guard in `reconcilePendingPm2QualityReviews`
 * (§0.101) — left that pm2's review unable to ever aggregate (every reconcile
 * re-threw on the same row). Degrade the bad payload to null + warn instead.
 */
function parseChildPayloadJson(json: string | null | undefined): unknown {
  if (!json) {
    return null;
  }
  try {
    return JSON.parse(json);
  } catch (err) {
    console.warn(
      `[review-aggregator] 子 handoff payload_json 解析失败，降级为 null：${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}

/**
 * 检查某个 d 层 handoff 的所有子 handoff 是否都到达终态。
 * 由 watcher 周期性调用。
 */
export function checkAllChildrenCompleted(pm2HandoffId: string): {
  allDone: boolean;
  children: HandoffRecord[];
} {
  // 读取 d 层 handoff 的 result_json 中的 dispatchedHandoffIds
  const row = sqliteGet<{ result_json: string | null }>(
    `SELECT result_json FROM handoff_records WHERE id = ?`,
    [pm2HandoffId],
  );
  if (!row?.result_json) return { allDone: false, children: [] };

  let resultData: Record<string, unknown>;
  try {
    resultData = JSON.parse(row.result_json) as Record<string, unknown>;
  } catch (_err) {
    void _err;
    return { allDone: false, children: [] };
  }

  const childIds = resultData['dispatchedHandoffIds'] as string[] | undefined;
  if (!childIds || childIds.length === 0) return { allDone: false, children: [] };

  const children = sqliteAll<{
    id: string;
    user_id: string;
    from_session_id: string;
    from_role_layer: string;
    to_role_layer: string;
    to_session_id: string | null;
    payload_json: string;
    result_json: string | null;
    state: string;
    claim_token: string | null;
    claimed_at: string | null;
    started_at: string | null;
    completed_at: string | null;
    failure_reason: string | null;
    retry_count: number;
    idempotency_key: string | null;
    paused: number;
    paused_at: string | null;
    paused_by_user_id: string | null;
    pause_reason: string | null;
    created_at: string;
    updated_at: string;
  }>(`SELECT * FROM handoff_records WHERE id IN (${childIds.map(() => '?').join(',')})`, childIds);

  const terminalStates = new Set(['completed', 'failed', 'cancelled']);
  const allDone =
    children.length === childIds.length && children.every((c) => terminalStates.has(c.state));

  // Map to HandoffRecord shape
  const mapped: HandoffRecord[] = children.map((c) => ({
    id: c.id,
    userId: c.user_id,
    fromSessionId: c.from_session_id,
    fromRoleLayer: c.from_role_layer as HandoffRecord['fromRoleLayer'],
    toRoleLayer: c.to_role_layer as HandoffRecord['toRoleLayer'],
    toSessionId: c.to_session_id,
    payload: parseChildPayloadJson(c.payload_json),
    resultJson: parseChildPayloadJson(c.result_json),
    state: c.state as HandoffRecord['state'],
    claimToken: c.claim_token,
    claimedAt: c.claimed_at,
    startedAt: c.started_at,
    completedAt: c.completed_at,
    failureReason: c.failure_reason,
    retryCount: c.retry_count,
    idempotencyKey: c.idempotency_key,
    paused: c.paused === 1,
    pausedAt: c.paused_at,
    pausedByUserId: c.paused_by_user_id,
    pauseReason: c.pause_reason,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  }));

  return { allDone, children: mapped };
}
