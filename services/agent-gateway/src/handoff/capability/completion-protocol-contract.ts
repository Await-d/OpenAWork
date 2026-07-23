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

export const SUBMIT_EXECUTION_RESULT_PROTOCOL = 'submit_execution_result' as const;
export const SUBMIT_REVIEW_REPORT_PROTOCOL = 'submit_review_report' as const;

export const checklistItemSchema = z.object({
  id: z.string().min(1).max(120),
  status: z.enum(['pass', 'fail', 'blocked']),
  evidence: z.string().min(1).max(2000),
});

export const submitExecutionResultSchema = z.object({
  taskId: z.string().min(1).max(200),
  status: z.enum(['completed', 'blocked', 'failed']),
  changedFiles: z.array(z.string().min(1).max(500)).max(200).default([]),
  checklist: z.array(checklistItemSchema).min(1).max(100),
  summary: z.string().min(1).max(4000),
  verification: z.array(z.string().min(1).max(500)).max(50).default([]),
  blockedReason: z.string().max(2000).optional(),
});

export type SubmitExecutionResultArgs = z.infer<typeof submitExecutionResultSchema>;

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
    if (!value.verdict && !value.decision && !(value.items && value.items.length > 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '必须提供 verdict/decision 或 items',
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
      if (
        normalized === base ||
        normalized.startsWith(`${base}/`) ||
        base.endsWith(normalized) ||
        normalized.endsWith(base)
      ) {
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
  return 'pass';
}
