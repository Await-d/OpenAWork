/**
 * Team 执行/评审完成硬契约（submit protocol）。
 *
 * - executor 必须调用 submit_execution_result
 * - reviewer 通过升级后的 submit_review 提交结构化 items
 * - runner / review-aggregator 优先消费 result_json.protocol
 *
 * 兼容模式：
 *   OPENAWORK_TEAM_REQUIRE_SUBMIT_PROTOCOL=soft|hard
 *   soft（默认）：缺 protocol 记 degraded，仍可进 review
 *   hard：缺 protocol → execution-protocol-failure
 */

import { z } from 'zod';
import { normalizeComparablePath } from './dispatch-package.js';
export { normalizeExecutionResult } from './execution-result-normalization.js';
export type { NormalizedExecutionResult } from './execution-result-normalization.js';

export const SUBMIT_EXECUTION_RESULT_PROTOCOL = 'submit_execution_result' as const;
export const SUBMIT_REVIEW_REPORT_PROTOCOL = 'submit_review_report' as const;

export const checklistItemSchema = z.object({
  id: z.string().min(1).max(120),
  status: z.enum(['pass', 'fail', 'blocked']),
  evidence: z.string().min(1).max(2000),
});
export type ChecklistItem = z.infer<typeof checklistItemSchema>;

export const submitExecutionResultSchema = z
  .object({
    taskId: z.string().min(1).max(200).optional(),
    status: z.enum(['completed', 'blocked', 'failed']).optional(),
    content: z.string().max(4000).optional(),
    summary: z.string().max(4000).optional(),
    checklist: z.array(checklistItemSchema).max(100).optional(),
    changedFiles: z.array(z.string().min(1).max(500)).max(200).default([]),
    verification: z.array(z.string().min(1).max(500)).max(50).default([]),
    blockedReason: z.string().max(2000).optional(),
  })
  .superRefine((value, ctx) => {
    const hasBriefSummary =
      (typeof value.summary === 'string' && value.summary.trim().length > 0) ||
      (typeof value.content === 'string' && value.content.trim().length > 0);
    if (!hasBriefSummary) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '至少提供 summary 或 content 的简要总结',
      });
    }
  });

export type SubmitExecutionResultArgs = z.infer<typeof submitExecutionResultSchema>;
export type SubmitExecutionResultInput = z.input<typeof submitExecutionResultSchema>;

export const reviewItemSchema = z.object({
  id: z.string().min(1).max(120),
  status: z.enum(['pass', 'fail']),
  reason: z.string().max(2000).optional(),
  fileRefs: z.array(z.string().min(1).max(500)).max(50).optional(),
});

export const submitReviewReportSchema = z
  .object({
    taskId: z.string().min(1).max(200).optional(),
    // 兼容旧字段 decision；新字段 verdict 优先
    verdict: z.enum(['pass', 'fail']).optional(),
    decision: z.enum(['pass', 'fail', 'needs_revision']).optional(),
    items: z.array(reviewItemSchema).min(1).max(100).optional(),
    overallReason: z.string().max(2000).optional(),
    title: z.string().min(1).max(200).optional(),
    content: z.string().min(1).max(64000).optional(),
    teamWorkspaceId: z.string().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    const hasStructuredVerdict = Boolean(
      value.verdict || value.decision || (value.items && value.items.length > 0),
    );
    const hasBriefSummary =
      (typeof value.overallReason === 'string' && value.overallReason.trim().length > 0) ||
      (typeof value.content === 'string' && value.content.trim().length > 0);
    if (!hasStructuredVerdict && !hasBriefSummary) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '必须提供 verdict/decision/items，或至少提供 overallReason/content 的简要总结',
      });
    }
  });

export type SubmitReviewReportArgs = z.infer<typeof submitReviewReportSchema>;

export type SubmitProtocolMode = 'soft' | 'hard';

export function resolveSubmitProtocolMode(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): SubmitProtocolMode {
  const raw = (env['OPENAWORK_TEAM_REQUIRE_SUBMIT_PROTOCOL'] ?? 'soft').trim().toLowerCase();
  return raw === 'hard' ? 'hard' : 'soft';
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getResultProtocol(resultJson: unknown): string | null {
  if (!isRecord(resultJson)) return null;
  return typeof resultJson['protocol'] === 'string' ? resultJson['protocol'] : null;
}

export function extractFailedItemIds(resultJson: unknown): string[] {
  if (!isRecord(resultJson)) return [];
  const checklist = resultJson['checklist'];
  const items = resultJson['items'];
  const source = Array.isArray(checklist) ? checklist : Array.isArray(items) ? items : [];
  const failed: string[] = [];
  for (const row of source) {
    if (!isRecord(row)) continue;
    const id = typeof row['id'] === 'string' ? row['id'] : '';
    const status = typeof row['status'] === 'string' ? row['status'] : '';
    if (id && (status === 'fail' || status === 'blocked')) {
      failed.push(id);
    }
  }
  return failed;
}

const REVIEW_PASS_PHRASES = [
  /\bpass\b/i,
  /通过/,
  /已通过/,
  /总体通过/,
  /基本通过/,
  /没有问题/,
  /没问题/,
  /没啥问题/,
  /审核通过/,
  /检查通过/,
  /未发现问题/,
  /没有问题/,
  /没有明显问题/,
  /无问题/,
  /无明显问题/,
  /暂无问题/,
  /无异常/,
  /符合预期/,
  /可接受/,
] as const;

const REVIEW_FAIL_PHRASES = [
  /\bfail\b/i,
  /未通过/,
  /不通过/,
  /失败/,
  /存在问题/,
  /有问题/,
  /问题[：:]/,
  /需要修正/,
  /需修正/,
  /需要修改/,
  /需修改/,
  /需要重试/,
  /阻塞/,
  /风险/,
  /不符合/,
  /不能接受/,
  /request_retry/i,
  /escalate/i,
] as const;

export function inferReviewVerdictFromText(text: string): 'pass' | 'fail' | null {
  const normalized = text.trim();
  if (normalized.length === 0) {
    return null;
  }
  if (REVIEW_FAIL_PHRASES.some((pattern) => pattern.test(normalized))) {
    return 'fail';
  }
  if (REVIEW_PASS_PHRASES.some((pattern) => pattern.test(normalized))) {
    return 'pass';
  }
  return null;
}

/**
 * ownedPaths 校验：changedFiles 必须落在 ownedPaths 内（ownedPaths 为空则跳过）。
 * 返回越界路径列表。
 */
export function findOutOfScopePaths(input: {
  changedFiles: string[];
  ownedPaths: string[];
}): string[] {
  if (input.ownedPaths.length === 0) return [];
  const owned = new Set(input.ownedPaths.map((p) => normalizeComparablePath(p)));
  const out: string[] = [];
  for (const file of input.changedFiles) {
    const normalized = normalizeComparablePath(file);
    if (!normalized) continue;
    let ok = false;
    for (const base of owned) {
      if (normalized === base || normalized.startsWith(`${base}/`)) {
        ok = true;
        break;
      }
    }
    if (!ok) out.push(file);
  }
  return out;
}

export function normalizeReviewVerdict(
  args: SubmitReviewReportArgs,
): 'pass' | 'fail' | 'needs_revision' {
  if (args.verdict === 'pass' || args.verdict === 'fail') {
    return args.verdict;
  }
  if (args.decision) return args.decision;
  if (args.items && args.items.some((item) => item.status === 'fail')) {
    return 'fail';
  }
  const summaryText = [args.overallReason, args.content]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join('\n');
  const inferredVerdict = inferReviewVerdictFromText(summaryText);
  if (inferredVerdict) {
    return inferredVerdict;
  }
  return 'pass';
}
