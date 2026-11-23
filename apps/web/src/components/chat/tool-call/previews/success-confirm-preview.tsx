/* ── Success confirmation preview (workspace_create_directory etc.) ── */

import { naturalLanguageSummary } from '../shared/natural-language-summary.js';

export function SuccessConfirmPreview({
  toolName,
  output,
}: {
  toolName: string;
  output: Record<string, unknown>;
}) {
  const detail = readConfirmDetail(output);
  return (
    <div className="tool-call-confirm">
      <span className="tool-call-confirm-glyph">✓</span>
      <span className="tool-call-confirm-text">
        {/* 中文动作 + 详情：不要直接透传英文工具名（与卡片标题同一口径）。 */}
        {naturalLanguageSummary(toolName, {})}
        {detail && <span className="tool-call-confirm-path"> · {detail}</span>}
      </span>
    </div>
  );
}

/**
 * 确认型工具的输出形状各异，统一挑第一个可用的作为详情：文件类给 `filePath` / `path`，
 * 会话重命名给新 `title`，会话移动给目标 `workingDirectory`，渠道发送给 `messageId`
 * ——最后这个 id 是「消息到底发出去没有」唯一可核对的凭据，确认行丢掉它就没法追溯。
 */
const CONFIRM_DETAIL_KEYS = ['filePath', 'path', 'title', 'workingDirectory', 'messageId'] as const;

function readConfirmDetail(output: Record<string, unknown>): string {
  for (const key of CONFIRM_DETAIL_KEYS) {
    const value = output[key];
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return '';
}
