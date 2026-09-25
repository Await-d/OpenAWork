/* ── Success confirmation preview (workspace_create_directory etc.) ── */

import { naturalLanguageSummary } from '../shared/natural-language-summary.js';

export function SuccessConfirmPreview({
  toolName,
  output,
}: {
  toolName: string;
  output: Record<string, unknown>;
}) {
  const path =
    typeof output.filePath === 'string'
      ? output.filePath
      : typeof output.path === 'string'
        ? output.path
        : '';
  return (
    <div className="tool-call-confirm">
      <span className="tool-call-confirm-glyph">✓</span>
      <span className="tool-call-confirm-text">
        {/* 中文动作 + 路径：不要直接透传英文工具名（与卡片标题同一口径）。 */}
        {naturalLanguageSummary(toolName, {})}
        {path && <span className="tool-call-confirm-path"> · {path}</span>}
      </span>
    </div>
  );
}
