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
import { buildSqlitePlaceholders, chunkSqliteBindValues } from '../../infra/sqlite-batch.js';
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
  overallVerdict:
    | 'pass'
    | 'implementation-failure'
    | 'planning-failure'
    | 'execution-protocol-failure';
  reportMarkdown: string;
}

interface ReviewReadinessResult {
  passed: boolean;
  issues: string[];
  childResults: string;
  /**
   * 当存在 failed/cancelled 子任务时，ready 不会 pass，但 verdict 应该是
   * `implementation-failure`（执行层任务本身失败）而非
   * `execution-protocol-failure`（交付协议未完成）。
   */
  hasFailedChildren: boolean;
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
  const verdictLabel: Record<ReviewReport['overallVerdict'], string> = {
    pass: '✅ 通过',
    'planning-failure': '❌ 规划型失败',
    'execution-protocol-failure': '❌ 执行协议失败',
    'implementation-failure': '❌ 实现型失败',
  };
  const lines: string[] = [
    '# Review Report',
    '',
    `**总体判定**：${verdictLabel[report.overallVerdict]}`,
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
    overallVerdict: input.report.overallVerdict,
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
  const readiness = buildReviewReadiness(input.childHandoffs);
  if (!readiness.passed) {
    // 区分两种失败场景：
    //   1. 子任务 state 为 failed/cancelled → implementation-failure（执行层任务本身失败）
    //   2. 子任务 state 为 completed 但缺 result_json/payload → execution-protocol-failure（交付协议未完成）
    const overallVerdict: ReviewReport['overallVerdict'] = readiness.hasFailedChildren
      ? 'implementation-failure'
      : 'execution-protocol-failure';

    const reportData: Omit<ReviewReport, 'reportMarkdown'> = {
      specReviewPassed: true,
      qualityReviewPassed: false,
      specIssues: [],
      qualityIssues: [
        ...readiness.issues,
        readiness.hasFailedChildren
          ? '存在子任务执行失败/取消，Quality Review 基于部分结果无法有效评审'
          : '评审前置条件未满足，已阻止空跑 Quality Review',
      ],
      overallVerdict,
    };
    const reportMarkdown = generateReportMarkdown(reportData);
    const report: ReviewReport = { ...reportData, reportMarkdown };
    persistReviewReport({
      pm2HandoffId: input.pm2HandoffId,
      pm2SessionId: input.pm2SessionId,
      report,
      userId: input.userId,
    });
    return report;
  }

  const childResults = readiness.childResults;

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

  persistReviewReport({
    pm2HandoffId: input.pm2HandoffId,
    pm2SessionId: input.pm2SessionId,
    report,
    userId: input.userId,
  });

  return report;
}

function persistReviewReport(input: {
  pm2HandoffId: string;
  pm2SessionId: string;
  report: ReviewReport;
  userId: string;
}): void {
  const reportArtifactId = randomUUID();
  sqliteRun(
    `INSERT INTO artifacts (id, session_id, user_id, type, title, content, version, phase)
     VALUES (?, ?, ?, 'markdown', 'Review Report', ?, 1, 'review')`,
    [reportArtifactId, input.pm2SessionId, input.userId, input.report.reportMarkdown],
  );

  sqliteRun(
    `UPDATE handoff_records SET result_json = ?, updated_at = datetime('now') WHERE id = ?`,
    [
      JSON.stringify({
        reviewReportArtifactId: reportArtifactId,
        overallVerdict: input.report.overallVerdict,
        specReviewPassed: input.report.specReviewPassed,
        qualityReviewPassed: input.report.qualityReviewPassed,
      }),
      input.pm2HandoffId,
    ],
  );

  publishTeamEvent({
    type: input.report.overallVerdict === 'pass' ? 'handoff.completed' : 'handoff.failed',
    taskId: input.pm2HandoffId,
    sessionId: input.pm2SessionId,
    layer: 'pm2',
    timestamp: Date.now(),
    payload: {
      overallVerdict: input.report.overallVerdict,
      reportArtifactId,
    },
    userId: input.userId,
  });
}

function buildReviewReadiness(childHandoffs: HandoffRecord[]): ReviewReadinessResult {
  const issues: string[] = [];
  let hasFailedChildren = false;
  const childResults = childHandoffs
    .map((h) => {
      const payload = isRecord(h.payload) ? h.payload : null;
      const goal = typeof payload?.['goal'] === 'string' ? payload['goal'].trim() : '';
      const taskMarkers = isRecord(payload?.['taskMarkers']) ? payload['taskMarkers'] : null;
      const taskId = typeof taskMarkers?.['taskId'] === 'string' ? taskMarkers['taskId'] : '';

      // 区分子 handoff 的终态：
      //   - failed / cancelled：执行层任务本身失败，不应要求 result_json，
      //     直接生成 implementation-failure issue 并标记 hasFailedChildren。
      //   - completed：正常完成，必须检查 result_json 是否存在。
      //   - 其他非终态：理论上 checkAllChildrenCompleted 已过滤，但防御性处理。
      if (h.state === 'failed' || h.state === 'cancelled') {
        hasFailedChildren = true;
        const failReason = h.failureReason
          ? `（失败原因：${h.failureReason}）`
          : h.state === 'cancelled'
            ? '（任务被取消）'
            : '';
        issues.push(
          `${h.id} 子任务执行${h.state === 'cancelled' ? '被取消' : '失败'}${failReason}，无法参与质量评审`,
        );

        return [
          `[${h.toRoleLayer}:${h.id}]`,
          `任务：${goal || '未命名任务'}`,
          `任务ID：${taskId || '缺失'}`,
          `状态：${h.state}`,
          `结果：(任务${h.state === 'cancelled' ? '被取消' : '失败'})`,
        ].join('\n');
      }

      // completed 或其他非终态：检查交付物。
      // 优先使用 HandoffRecord 上已解析的 resultJson（由 checkAllChildrenCompleted 填充），
      // 避免冗余 DB 查询；兜底再查 DB 以兼容直接构造的入参。
      const resultFromRecord = h.resultJson;
      let resultJson = '';
      if (resultFromRecord !== null && resultFromRecord !== undefined) {
        resultJson =
          typeof resultFromRecord === 'string'
            ? resultFromRecord
            : JSON.stringify(resultFromRecord);
      } else {
        const resultRow = sqliteGet<{ result_json: string | null }>(
          `SELECT result_json FROM handoff_records WHERE id = ?`,
          [h.id],
        );
        resultJson = resultRow?.result_json?.trim() ?? '';
      }

      if (!goal) {
        issues.push(`${h.id} 缺少任务标题，无法建立评审映射`);
      }
      if (!taskId) {
        issues.push(`${h.id} 缺少 taskId，无法追踪任务来源`);
      }
      if (!resultJson) {
        issues.push(
          `${h.id} 缺少执行结果 artifact/summary，Quality Review 无法取证（执行层未完成交付协议）`,
        );
      }

      return [
        `[${h.toRoleLayer}:${h.id}]`,
        `任务：${goal || '未命名任务'}`,
        `任务ID：${taskId || '缺失'}`,
        `结果：${resultJson || '(无结果)'}`,
      ].join('\n');
    })
    .join('\n\n');

  return {
    passed: issues.length === 0,
    issues,
    childResults,
    hasFailedChildren,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  if (!childIds || childIds.length === 0) {
    // 没有子任务需要等待——视为全部完成，让 quality review 能正常触发。
    // 否则 PM2 会永远卡在 running 状态（无子任务 → allDone 永远 false → 死锁）。
    return { allDone: true, children: [] };
  }

  const rowsById = new Map<
    string,
    {
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
    }
  >();
  for (const batchIds of chunkSqliteBindValues(childIds)) {
    const rows = sqliteAll<{
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
    }>(
      `SELECT * FROM handoff_records WHERE id IN (${buildSqlitePlaceholders(batchIds.length)})`,
      batchIds,
    );
    for (const row of rows) {
      if (!rowsById.has(row.id)) {
        rowsById.set(row.id, row);
      }
    }
  }
  const children = childIds
    .map((childId) => rowsById.get(childId) ?? null)
    .filter(
      (
        row,
      ): row is {
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
      } => row !== null,
    );

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
