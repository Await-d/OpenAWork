/* ── Success confirmation preview (workspace_create_directory etc.) ── */

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
        {toolName}
        {path && <span className="tool-call-confirm-path"> · {path}</span>}
      </span>
    </div>
  );
}
