/**
 * 提示词补丁应用纯函数（前端落地）。
 *
 * 与 agent-core 的 applyPatchPlan 语义一致：oldText→newText 局部替换，
 * 支持 occurrence 消歧、单条失败跳过不中断。类型对齐 web-client 的
 * PromptPatchOperation，避免前端引入 agent-core（该包含 Node 依赖）。
 */

import type { PromptPatchOperation } from '@openAwork/web-client';

export type { PromptPatchOperation };

export interface PatchApplyFailure {
  operation: PromptPatchOperation;
  reason: 'anchor_not_found' | 'anchor_ambiguous';
}

export interface PatchApplyResult {
  text: string;
  appliedCount: number;
  skipped: PatchApplyFailure[];
}

/** 定位 oldText 第 occurrence 次出现；未找到或不足时返回 null。 */
export function findPatchAnchor(text: string, oldText: string, occurrence = 1): number | null {
  if (oldText.length === 0) {
    return 0;
  }
  let index = text.indexOf(oldText);
  if (index === -1) {
    return null;
  }
  if (occurrence === 1) {
    return index;
  }
  for (let seen = 1; seen < occurrence; seen += 1) {
    index = text.indexOf(oldText, index + oldText.length);
    if (index === -1) {
      return null;
    }
  }
  return index;
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/** 应用单个补丁操作；失败返回 null 与原因。 */
export function applyPatch(
  text: string,
  operation: PromptPatchOperation,
): { result: string | null; failure: PatchApplyFailure | null } {
  const occurrence = operation.occurrence ?? 1;
  const anchor = findPatchAnchor(text, operation.oldText, occurrence);
  if (anchor === null) {
    const total = operation.oldText.length === 0 ? 0 : countOccurrences(text, operation.oldText);
    const reason: PatchApplyFailure['reason'] =
      total === 0 ? 'anchor_not_found' : 'anchor_ambiguous';
    return { result: null, failure: { operation, reason } };
  }
  const end = anchor + operation.oldText.length;
  const next = `${text.slice(0, anchor)}${operation.newText}${text.slice(end)}`;
  return { result: next, failure: null };
}

/** 顺序应用补丁组；单条失败跳过并记录，能落的尽量落地。 */
export function applyPatchPlan(
  text: string,
  patchPlan: readonly PromptPatchOperation[],
): PatchApplyResult {
  let current = text;
  let appliedCount = 0;
  const skipped: PatchApplyFailure[] = [];
  for (const operation of patchPlan) {
    const { result, failure } = applyPatch(current, operation);
    if (result === null && failure) {
      skipped.push(failure);
      continue;
    }
    current = result ?? current;
    appliedCount += 1;
  }
  return { text: current, appliedCount, skipped };
}
