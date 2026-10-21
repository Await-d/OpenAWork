import type { AttachmentItem } from '@openAwork/shared-ui';

/**
 * 待发队列条目的附件条目。
 *
 * 就是输入框的 `AttachmentItem` 加上一个可选的 `artifactId`：入队后附件会被上传到
 * 网关（磁盘型产物）作为**跨端副本**，id 回填到条目里；换设备水合时凭它把二进制
 * 拉回来，而不是只能提示「请重新选择附件」。字段可选——上传失败、旧条目没有它。
 */
export interface QueuedComposerAttachment extends AttachmentItem {
  artifactId?: string;
}

export interface PersistedQueuedComposerMessage {
  attachmentItems: QueuedComposerAttachment[];
  enqueuedAt: number;
  id: string;
  requiresAttachmentRebind: boolean;
  text: string;
}

export interface QueuedComposerMessage {
  attachmentItems: QueuedComposerAttachment[];
  files: File[];
  id: string;
  requiresAttachmentRebind: boolean;
  text: string;
}

export interface QueuedComposerPreview {
  id: string;
  label: string;
  requiresAttachmentRebind: boolean;
  title: string;
}

export function summarizeQueuedComposerMessage(input: {
  attachmentItems: AttachmentItem[];
  requiresAttachmentRebind: boolean;
  text: string;
}): { label: string; title: string } {
  const normalizedText = input.text.trim().replace(/\s+/g, ' ');
  const attachmentCount = input.attachmentItems.length;
  const attachmentLabel = attachmentCount > 0 ? `${attachmentCount} 个附件` : '';
  const reattachLabel = input.requiresAttachmentRebind ? '需重新选择附件' : '';
  const suffix = [attachmentLabel, reattachLabel].filter((item) => item.length > 0).join(' · ');

  if (normalizedText.length === 0) {
    const fallback = suffix || '空白消息';
    return { label: fallback, title: fallback };
  }

  const clippedText =
    normalizedText.length > 42 ? `${normalizedText.slice(0, 41).trimEnd()}…` : normalizedText;

  return {
    label: suffix ? `${clippedText} · ${suffix}` : clippedText,
    title: suffix ? `${normalizedText}\n${suffix}` : normalizedText,
  };
}

export function createQueuedComposerPreview(
  item: QueuedComposerMessage | PersistedQueuedComposerMessage,
): QueuedComposerPreview {
  const summary = summarizeQueuedComposerMessage({
    attachmentItems: item.attachmentItems,
    requiresAttachmentRebind: item.requiresAttachmentRebind,
    text: item.text,
  });

  return {
    id: item.id,
    label: summary.label,
    requiresAttachmentRebind: item.requiresAttachmentRebind,
    title: summary.title,
  };
}

export function hydrateQueuedComposerMessage(
  item: PersistedQueuedComposerMessage,
): QueuedComposerMessage {
  return {
    attachmentItems: item.attachmentItems.map((attachment) => ({ ...attachment })),
    files: [],
    id: item.id,
    requiresAttachmentRebind: item.requiresAttachmentRebind,
    text: item.text,
  };
}

export function toPersistedQueuedComposerMessage(
  item: QueuedComposerMessage,
): PersistedQueuedComposerMessage {
  return {
    attachmentItems: item.attachmentItems.map((attachment) => ({ ...attachment })),
    enqueuedAt: Date.now(),
    id: item.id,
    requiresAttachmentRebind: item.requiresAttachmentRebind,
    text: item.text,
  };
}
