const MAX_INLINE_CHARS = 8_192;
const PREVIEW_CHARS = 6_000;
import { buildToolOutputReferenceIdentity } from './tool-output-reference.js';

function normalizeEmbeddedMedia(value: string): string {
  return value.replace(
    /data:([^,;\s]+)[^,\s]*;base64,\s*[A-Za-z0-9+/_=-]+(?:[ \t\r\n]+[A-Za-z0-9+/_=-]+)*/gi,
    (_match, mime: string) => `[${mime} binary omitted from text; use the image attachment]`,
  );
}

/** Bound the model view, not the persisted tool result or its retrieval identity. */
export function projectToolOutput(toolCallId: string, output: string): string {
  const text = normalizeEmbeddedMedia(output);
  if (text.length <= MAX_INLINE_CHARS) return text;

  const reference = JSON.stringify({
    kind: 'tool_output_reference',
    ...buildToolOutputReferenceIdentity(toolCallId),
    retrievalTool: 'read_tool_output',
    storedChars: output.length,
  });
  return (
    text.slice(0, PREVIEW_CHARS) +
    '\n[输出已截断 — 此处仅为开头预览；使用 read_tool_output 按需读取会话中保存的结果。]\n' +
    reference
  ).slice(0, MAX_INLINE_CHARS);
}
