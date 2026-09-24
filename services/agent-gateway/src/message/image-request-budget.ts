/**
 * Request-level inline image budget.
 *
 * Aligned with opencode v2.0.15 (`packages/core/src/session/model-request.ts`
 * `boundImages`): when the total inline image payload of one request exceeds
 * the trigger, remove the OLDEST images until the remaining payload fits the
 * target, and leave a notice in the message so the model does not claim to
 * remember removed contents. Remote / provider-referenced images carry no
 * local payload and never count toward the budget.
 *
 * 对齐说明：参考库是 25 MiB 触发 / 15 MiB 目标，且按「从最早开始」淘汰；
 * 本模块保持同一语义，只把载荷口径限定为 `data:` 内联图片（与
 * `native-message-bridge` 的 `{ type: 'media', data: imageUrl }` 渲染一致）。
 */

import type { UnifiedMessage } from './message-to-model-messages.js';

export const IMAGE_BUDGET_TRIGGER_BYTES_DEFAULT = 25 * 1024 * 1024;
export const IMAGE_BUDGET_TARGET_BYTES_DEFAULT = 15 * 1024 * 1024;

/**
 * 移除提示：与参考库 `IMAGE_REMOVED` 同义（不得让模型凭记忆断言图片内容）。
 */
export const IMAGE_REMOVED_NOTICE =
  '[为控制请求体积，较早的图片已移除，当前不可见；不要凭记忆断言其内容。如确需，请重新获取或让用户重新上传。]';

export interface ImageBudgetResult {
  readonly messages: UnifiedMessage[];
  readonly removedCount: number;
  readonly removedBytes: number;
}

function resolveEnvBytes(name: string, fallback: number): number {
  const raw = globalThis.process?.env?.[name];
  if (raw === undefined || raw === null || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
}

export function resolveImageBudget(): { triggerBytes: number; targetBytes: number } {
  const triggerBytes = resolveEnvBytes(
    'OPENAWORK_IMAGE_BUDGET_TRIGGER_BYTES',
    IMAGE_BUDGET_TRIGGER_BYTES_DEFAULT,
  );
  const targetBytes = resolveEnvBytes(
    'OPENAWORK_IMAGE_BUDGET_TARGET_BYTES',
    IMAGE_BUDGET_TARGET_BYTES_DEFAULT,
  );
  // 非正数视为禁用；target 不得高于 trigger。
  if (triggerBytes <= 0 || targetBytes <= 0) return { triggerBytes: 0, targetBytes: 0 };
  return { triggerBytes, targetBytes: Math.min(targetBytes, triggerBytes) };
}

/**
 * Bytes of the local inline payload an image contributes.
 *
 * Only `data:` URLs carry a local payload on the wire; `imageUrl` pointing at
 * a gateway/remote URL and `artifactId`/`fileId`-only images resolve later or
 * not at all, so they contribute 0 (same rule as the reference implementation).
 */
export function inlineImagePayloadBytes(imageUrl: string | undefined): number {
  if (typeof imageUrl !== 'string' || imageUrl.length === 0) return 0;
  if (!imageUrl.toLowerCase().startsWith('data:')) return 0;
  const comma = imageUrl.indexOf(',');
  if (comma < 0) return 0;
  const payloadChars = imageUrl.length - comma - 1;
  return Math.floor((payloadChars * 3) / 4);
}

/**
 * Apply the inline image budget to the model-visible message list.
 *
 * Pure: never mutates the input; removed messages are replaced with copies.
 * Returns the original list untouched when under the trigger or disabled.
 */
export function boundInlineImages(
  messages: UnifiedMessage[],
  options?: { triggerBytes?: number; targetBytes?: number },
): ImageBudgetResult {
  const resolved = resolveImageBudget();
  const triggerBytes = options?.triggerBytes ?? resolved.triggerBytes;
  const targetBytes = options?.targetBytes ?? resolved.targetBytes;
  if (triggerBytes <= 0 || targetBytes <= 0) {
    return { messages, removedCount: 0, removedBytes: 0 };
  }

  let totalBytes = 0;
  for (const message of messages) {
    if (message.role !== 'user') continue;
    for (const image of message.images ?? []) {
      totalBytes += inlineImagePayloadBytes(image.imageUrl);
    }
  }
  if (totalBytes <= triggerBytes) {
    return { messages, removedCount: 0, removedBytes: 0 };
  }

  let removedBytes = 0;
  let removedCount = 0;
  const next = messages.map((message) => {
    if (message.role !== 'user' || !message.images || message.images.length === 0) {
      return message;
    }
    let changed = false;
    const keptImages = message.images.filter((image) => {
      // 已降到目标以下：保留其余（与参考库的 `imageBytes - removed > target` 同语义）。
      if (totalBytes - removedBytes <= targetBytes) return true;
      const bytes = inlineImagePayloadBytes(image.imageUrl);
      if (bytes === 0) return true;
      removedBytes += bytes;
      removedCount += 1;
      changed = true;
      return false;
    });
    if (!changed) return message;
    return {
      ...message,
      content:
        message.content.length > 0
          ? `${message.content}\n\n${IMAGE_REMOVED_NOTICE}`
          : IMAGE_REMOVED_NOTICE,
      images: keptImages,
    };
  });

  return { messages: next, removedCount, removedBytes };
}
