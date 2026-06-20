import type { UpstreamStreamSummary } from '@openAwork/shared';

export function formatChatUpstreamSummaryLabel(
  summary: UpstreamStreamSummary | null | undefined,
): string | null {
  if (!summary) return null;
  const suffix = summary.stalled
    ? ' / stalled'
    : summary.sawError
      ? ' / error'
      : summary.sawDone
        ? ' / done'
        : '';
  return `流摘要 文本 ${summary.textDeltaCount} / 思考 ${summary.reasoningDeltaCount} / 工具 ${summary.toolCallDeltaCount}${suffix}`;
}
