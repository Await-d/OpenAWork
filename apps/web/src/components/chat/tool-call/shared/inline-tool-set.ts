/**
 * Toolnames that render as the compact "InlineToolCall" pill (single
 * line + chevron) rather than the full BlockToolCall card. Anything
 * starting with `lsp_` is also treated as inline (terse output, often
 * one-liners).
 */
const INLINE_TOOLS = new Set([
  'read',
  'skill',
  'question',
  'askuserquestion',
  'todowrite',
  'todoread',
  'subtodowrite',
  'subtodoread',
  'enterplanmode',
  'exitplanmode',
  // Status-only tools: their output is a short success/error message,
  // so a one-line pill carries 100% of the useful information.
  'background_cancel',
  'session_info',
]);

export function isInlineTool(toolName: string): boolean {
  const normalized = toolName.trim().toLowerCase();
  if (INLINE_TOOLS.has(normalized)) return true;
  if (normalized.startsWith('lsp_')) return true;
  return false;
}
