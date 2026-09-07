function normalizeEmbeddedMedia(value: string): string {
  return value.replace(
    /data:([^,;\s]+)[^,\s]*;base64,\s*[A-Za-z0-9+/_=-]+(?:[ \t\r\n]+[A-Za-z0-9+/_=-]+)*/gi,
    (_match, mime: string) => `[${mime} binary omitted from text; use the image attachment]`,
  );
}

/**
 * Build the normal model view without imposing a per-result text ceiling.
 * Binary data URIs remain excluded because attachments are projected through
 * the dedicated image path; old text results are reclaimed by microcompact.
 */
export function projectToolOutput(_toolCallId: string, output: string): string {
  return normalizeEmbeddedMedia(output);
}
