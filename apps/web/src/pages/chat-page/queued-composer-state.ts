import type { AttachmentItem } from '@openAwork/shared-ui';

export interface PersistedQueuedComposerMessage {
  attachmentItems: AttachmentItem[];
  enqueuedAt: number;
  id: string;
  requiresAttachmentRebind: boolean;
  text: string;
}

export interface QueuedComposerMessage {
  attachmentItems: AttachmentItem[];
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
