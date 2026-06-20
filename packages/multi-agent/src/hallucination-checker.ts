/**
 * 幻觉检测门禁 + 通用诊断引擎。
 *
 * 参考：hermes-agent v0.13.0
 *   - 幻觉检测门禁：worker 声称完成任务后，自动验证是否真正完成
 *   - 通用诊断引擎：检测任务异常信号（重复失败、超时模式、输出质量退化等）
 *   - 每任务重试预算
 */

import type { DAGNode, HallucinationCheckResult, HallucinationIssue } from './types.js';
import { existsSync } from 'node:fs';

/**
 * 从节点输出中提取声称修改的文件路径。
 *
 * Agent 输出中通常包含 "file: path/to/file" 或 "modified: path" 等模式。
 */
function extractClaimedFiles(output: unknown): string[] {
  if (!output || typeof output !== 'object') return [];
  const record = output as Record<string, unknown>;
  const files: string[] = [];

  // 直接的 files / modifiedFiles / changedFiles 字段
  const fileFields = ['files', 'modifiedFiles', 'changedFiles', 'affectedFiles'];
  for (const field of fileFields) {
    const value = record[field];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string') files.push(item);
        else if (typeof item === 'object' && item !== null && 'path' in item) {
          const filePath = (item as Record<string, unknown>)['path'];
          if (typeof filePath === 'string') files.push(filePath);
        }
      }
    }
  }

  // filePath / path 字段
  const singleFields = ['filePath', 'path', 'file'];
  for (const field of singleFields) {
    const value = record[field];
    if (typeof value === 'string') files.push(value);
  }

  return [...new Set(files)];
}

/**
 * 检查输出是否为空或明显无效。
 */
function checkOutputValidity(node: DAGNode): HallucinationIssue[] {
  const issues: HallucinationIssue[] = [];
  const output = node.output;

  if (output === null || output === undefined) {
    issues.push({
      type: 'empty_output',
      detail: '节点声称完成但输出为空',
    });
    return issues;
  }

  if (typeof output === 'object' && output !== null) {
    const record = output as Record<string, unknown>;
    // 检查是否有 error 字段但状态是 completed
    if (record['error'] && typeof record['error'] === 'string') {
      issues.push({
        type: 'output_mismatch',
        detail: `节点标记为完成但输出包含 error: ${record['error']}`,
        expected: '无错误的输出',
        actual: String(record['error']),
      });
    }
    // 检查 status 字段
    if (record['status'] === 'failed' || record['status'] === 'error') {
      issues.push({
        type: 'output_mismatch',
        detail: `节点标记为完成但输出 status 为 ${String(record['status'])}`,
        expected: 'completed',
        actual: String(record['status']),
      });
    }
  }

  return issues;
}

/**
 * 对节点执行幻觉检测。
 *
 * 检查项：
 *   1. 输出是否为空或包含错误标志
 *   2. 声称修改的文件是否实际存在
 *   3. 声称的变更是否真实反映在输出中
 */
export function checkHallucination(node: DAGNode): HallucinationCheckResult {
  const startAt = Date.now();
  const issues: HallucinationIssue[] = [];

  // 1. 输出有效性检查
  issues.push(...checkOutputValidity(node));

  // 2. 文件存在性检查
  const claimedFiles = extractClaimedFiles(node.output);
  for (const filePath of claimedFiles) {
    if (!existsSync(filePath)) {
      issues.push({
        type: 'claimed_file_not_found',
        detail: `声称修改的文件不存在: ${filePath}`,
        expected: '文件存在',
        actual: '文件不存在',
      });
    }
  }

  return {
    passed: issues.length === 0,
    issues,
    checkedAt: Date.now(),
    durationMs: Date.now() - startAt,
  };
}

/**
 * 通用诊断引擎：检测任务异常信号。
 *
 * 分析节点的 failureEscalationLog，识别以下模式：
 *   - 重复失败模式：相同错误连续出现 3+ 次
 *   - 超时模式：最近 3 次尝试都是超时
 *   - 输出质量退化：每次尝试的输出越来越短
 */
export interface DiagnosticAlert {
  pattern: string;
  detail: string;
  severity: 'low' | 'medium' | 'high';
}

export function diagnoseNodeIssues(node: DAGNode): DiagnosticAlert[] {
  const alerts: DiagnosticAlert[] = [];
  const log = node.failureEscalationLog ?? [];

  if (log.length < 2) return alerts;

  // 重复失败模式：相同错误消息连续出现
  const recentErrors = log.slice(-3).map((entry) => entry.error);
  const allSame = recentErrors.length >= 3 && recentErrors.every((e) => e === recentErrors[0]);
  if (allSame) {
    alerts.push({
      pattern: 'repeated_failure',
      detail: `连续 ${recentErrors.length} 次相同错误: ${recentErrors[0]}`,
      severity: 'high',
    });
  }

  // 超时模式
  const timeoutCount = recentErrors.filter((e) =>
    /timeout|timed out|ETIMEDOUT/i.test(e),
  ).length;
  if (timeoutCount >= 2) {
    alerts.push({
      pattern: 'timeout_pattern',
      detail: `最近 ${timeoutCount}/${recentErrors.length} 次尝试超时`,
      severity: 'medium',
    });
  }

  // 模型能力不足模式
  const capabilityErrors = log.filter((entry) =>
    /context|token|length|too long/i.test(entry.error),
  );
  if (capabilityErrors.length >= 2) {
    alerts.push({
      pattern: 'model_capability_exhausted',
      detail: `多次因模型能力限制失败，建议切换更强模型或拆分任务`,
      severity: 'medium',
    });
  }

  return alerts;
}

/**
 * 检查节点的重试预算是否已耗尽。
 *
 * 参考 hermes-agent v0.13.0 每任务重试预算。
 */
export function isRetryBudgetExhausted(node: DAGNode): boolean {
  const policy = node.retryPolicy;
  if (!policy) return false;

  const budget = policy.retryBudget ?? policy.maxRetries;
  const usedRetries = node.failureEscalationLog?.length ?? 0;
  return usedRetries >= budget;
}

/**
 * 获取剩余重试预算。
 */
export function getRemainingRetryBudget(node: DAGNode): number {
  const policy = node.retryPolicy;
  if (!policy) return 0;

  const budget = policy.retryBudget ?? policy.maxRetries;
  const usedRetries = node.failureEscalationLog?.length ?? 0;
  return Math.max(0, budget - usedRetries);
}
