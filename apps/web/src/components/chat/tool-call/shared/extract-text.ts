/**
 * Pull a human-readable text payload out of a tool output. Most OpenAWork
 * built-in tools return `{output: "<rendered text>", ...}` (todoread, skill,
 * lsp_*, etc.); some return `{content: "<text>"}` (workspace_read_file).
 * We surface that text so users see the formatted message instead of an
 * envelope full of structural noise.
 */
export function extractTextFromOutput(
  output: unknown,
): { text: string; isMarkdown: boolean } | null {
  if (typeof output === 'string') {
    return { text: output, isMarkdown: false };
  }
  if (!output || typeof output !== 'object' || Array.isArray(output)) return null;
  const record = output as Record<string, unknown>;
  for (const key of ['output', 'content', 'text', 'message', 'result'] as const) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.length > 0) {
      const format = record.format;
      const isMarkdown = format === 'markdown';
      return { text: candidate, isMarkdown };
    }
  }
  return null;
}
