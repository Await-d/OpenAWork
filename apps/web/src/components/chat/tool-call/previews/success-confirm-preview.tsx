/* ── Success confirmation preview (workspace_create_directory etc.) ── */

import { naturalLanguageSummary } from '../shared/natural-language-summary.js';

export function SuccessConfirmPreview({
  toolName,
  output,
}: {
  toolName: string;
  output: Record<string, unknown>;
}) {
  // 确认型工具的输出形状各异：文件类给 `filePath` / `path`，会话重命名给新
  // `title`，会话移动给目标 `workingDirectory`——统一挑第一个可用的作为详情。
  const path =
    typeof output.filePath === 'string'
      ? output.filePath
      : typeof output.path === 'string'
        ? output.path
        : typeof output.title === 'string'
          ? output.title
          : typeof output.workingDirectory === 'string'
            ? output.workingDirectory
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
