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
  /** 附件数量，供对话流内的待发气泡单独展示（`label` 把它揉进了摘要文本）。 */
  attachmentCount: number;
  id: string;
  label: string;
  requiresAttachmentRebind: boolean;
  /**
   * 完整原文（未截断、未折叠空白）。
   *
   * `label` 是给 composer 排队 chip 用的 42 字摘要，而对话流里的待发气泡与真正的
   * 用户气泡同处一条时间轴，必须显示全文，否则同一条消息在「待发」与「已发送」两个
   * 阶段显示的文本不一致，用户会以为内容被改过。
   */
  text: string;
  title: string;
}

/**
 * 待发条目的附件相关文案。
 *
 * composer 的排队 chip（拼成摘要串）与对话流的待发气泡（渲染成独立小标签）是同一批
 * 文案的两个出口，必须共用这一份，否则会出现「改了摘要忘了气泡」，两处说法不一致。
 */
export const QUEUED_ATTACHMENT_REBIND_LABEL = '需重新选择附件';

export function formatQueuedAttachmentCountLabel(count: number): string {
  return `${count} 个附件`;
}

export function summarizeQueuedComposerMessage(input: {
  attachmentItems: AttachmentItem[];
  requiresAttachmentRebind: boolean;
  text: string;
}): { label: string; title: string } {
  const normalizedText = input.text.trim().replace(/\s+/g, ' ');
  const attachmentLabel =
    input.attachmentItems.length > 0
      ? formatQueuedAttachmentCountLabel(input.attachmentItems.length)
      : '';
  const reattachLabel = input.requiresAttachmentRebind ? QUEUED_ATTACHMENT_REBIND_LABEL : '';
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
    attachmentCount: item.attachmentItems.length,
    id: item.id,
    label: summary.label,
    requiresAttachmentRebind: item.requiresAttachmentRebind,
    text: item.text,
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
