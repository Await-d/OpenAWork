import type { HandoffRecord } from '@openAwork/web-client';

export interface LayerDialoguePreview {
  recommendedNextStep: string | null;
  recommendedRole: string | null;
  rewrittenIntent: string | null;
  sourceIntent: string | null;
  summary: string | null;
}

function normalizePreviewText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function extractLayerDialoguePreview(
  payload: unknown,
  fallbackSummary?: string | null,
): LayerDialoguePreview {
  const record =
    typeof payload === 'object' && payload !== null && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;

  return {
    recommendedNextStep: normalizePreviewText(record?.['recommendedNextStep']),
    recommendedRole: normalizePreviewText(record?.['recommendedRole']),
    rewrittenIntent: normalizePreviewText(record?.['rewrittenIntent']),
    sourceIntent: normalizePreviewText(record?.['sourceIntent']),
    summary:
      normalizePreviewText(record?.['summary']) ?? normalizePreviewText(fallbackSummary) ?? null,
  };
}

export function resolveIncomingDialoguePreview(input: {
  fallbackSummary?: string | null;
  focusHandoffId?: string | null;
  records: HandoffRecord[];
  targetSessionId: string | null;
}): LayerDialoguePreview | null {
  if (!input.targetSessionId) {
    return null;
  }

  const candidates = input.records.filter((record) => record.toSessionId === input.targetSessionId);
  const orderedCandidates = input.focusHandoffId
    ? [
        ...candidates.filter((record) => record.id === input.focusHandoffId),
        ...candidates.filter((record) => record.id !== input.focusHandoffId),
      ]
    : candidates;
  const preferred =
    orderedCandidates.sort((left, right) =>
      (right.completedAt ?? right.updatedAt).localeCompare(
        left.completedAt ?? left.updatedAt,
        'zh-CN',
      ),
    )[0] ?? null;
  if (!preferred) {
    return null;
  }

  const preview = extractLayerDialoguePreview(preferred.payload, input.fallbackSummary);
  const hasContent =
    preview.sourceIntent ||
    preview.rewrittenIntent ||
    preview.recommendedNextStep ||
    preview.recommendedRole ||
    preview.summary;
  return hasContent ? preview : null;
}
